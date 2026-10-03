import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { writeAuthoringJson } from "./authoring-config.ts";

// ─── Re-derivation progress ───────────────────────────────────────────────────
//
// Re-deriving the team and project skills is a multi-step chain run as one
// background job. The Console polls it, and a browser that reloads mid-run must
// resume the step machine rather than show an undifferentiated spinner, so the
// chain's progress is persisted next to the authoring state it produces.
//
// The file is deliberately separate from `docs/authoring-state.json`: that file
// records the *result* of each authoring stage and is written by the stage
// runners themselves, whereas this records the progress of the chain that runs
// them. Deleting this file loses nothing but the progress display.

/**
 * Chain step order. `team` derives agents from the PRD, `skills` derives
 * project skills from the generated team, and `manifest` compiles the build.
 *
 * There is deliberately no `prd` step: ADR-060 makes requirements authoring
 * interactive, so the chain starts at the first derivation and refuses to run
 * without a committed PRD.
 */
export const REDERIVE_STEPS = ["team", "skills", "manifest"] as const;

export type RederiveStepId = (typeof REDERIVE_STEPS)[number];
export type RederiveStepStatus = "pending" | "running" | "complete" | "failed";

export interface RederiveStep {
  id: RederiveStepId;
  label: string;
  status: RederiveStepStatus;
  /** Progress or failure detail for the UI; never required. */
  message?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface RederiveState {
  version: 1;
  runId: string;
  startedAt: string;
  updatedAt: string;
  steps: RederiveStep[];
}

const STEP_LABELS: Record<RederiveStepId, string> = {
  team: "Agent team",
  skills: "Project skills",
  manifest: "Execution manifest",
};

const STEP_STATUSES: RederiveStepStatus[] = ["pending", "running", "complete", "failed"];

export const rederiveStatePath = (repo: string): string => path.join(repo, "docs", "rederive-state.json");

/** A fresh chain, all steps pending. Used by `startRederive` and by tests. */
export function newRederiveState(runId: string = randomUUID()): RederiveState {
  const now = new Date().toISOString();
  return {
    version: 1,
    runId,
    startedAt: now,
    updatedAt: now,
    steps: REDERIVE_STEPS.map((id) => ({ id, label: STEP_LABELS[id], status: "pending" })),
  };
}

/**
 * Reads the chain's progress. A missing file means "never run", which is not an
 * error. A malformed file throws rather than being silently reset: losing the
 * progress of a running chain would leave the UI claiming a stale stage is fine
 * to re-derive while it is being regenerated.
 */
export function readRederiveState(repo: string): RederiveState | null {
  const file = rederiveStatePath(repo);
  if (!fs.existsSync(file)) return null;
  const value = JSON.parse(fs.readFileSync(file, "utf8")) as RederiveState;
  if (!value || typeof value !== "object" || value.version !== 1 || typeof value.runId !== "string" ||
      !Array.isArray(value.steps) || value.steps.length !== REDERIVE_STEPS.length) {
    throw new Error("Invalid re-derivation state: expected {version:1,runId,steps[] of the three chain steps}.");
  }
  const seen = new Set<string>();
  for (const step of value.steps) {
    if (!step || typeof step !== "object" || !REDERIVE_STEPS.includes(step.id as RederiveStepId) ||
        seen.has(step.id) || !STEP_STATUSES.includes(step.status)) {
      throw new Error("Invalid re-derivation step.");
    }
    seen.add(step.id);
  }
  for (const id of REDERIVE_STEPS) {
    if (!seen.has(id)) throw new Error(`Invalid re-derivation state: missing step '${id}'.`);
  }
  return value;
}

export function writeRederiveState(repo: string, state: RederiveState): void {
  writeAuthoringJson(rederiveStatePath(repo), { ...state, updatedAt: new Date().toISOString() });
}

export function startRederive(repo: string, runId?: string): RederiveState {
  const state = newRederiveState(runId);
  writeRederiveState(repo, state);
  return state;
}

export function clearRederiveState(repo: string): void {
  fs.rmSync(rederiveStatePath(repo), { force: true });
}

/**
 * Marks a step running and returns every later step to pending, so a chain
 * restarted from a failure re-derives its whole tail instead of leaving stale
 * "complete" marks that no longer describe the team on disk.
 */
export function startRederiveStep(repo: string, id: RederiveStepId, message?: string): RederiveState {
  const state = readRederiveState(repo) ?? startRederive(repo);
  const index = state.steps.findIndex((step) => step.id === id);
  if (index < 0) throw new Error(`Unknown re-derivation step '${id}'.`);
  state.steps = state.steps.map((step, position) => {
    if (position === index) {
      return { ...step, status: "running", startedAt: new Date().toISOString(), ...(message ? { message } : {}) };
    }
    if (position > index) return { id: step.id, label: step.label, status: "pending" };
    return step;
  });
  writeRederiveState(repo, state);
  return state;
}

export function completeRederiveStep(repo: string, id: RederiveStepId, message?: string): RederiveState {
  const state = readRederiveState(repo) ?? startRederive(repo);
  const index = state.steps.findIndex((step) => step.id === id);
  if (index < 0) throw new Error(`Unknown re-derivation step '${id}'.`);
  state.steps = state.steps.map((step, position) => (position === index
    ? { ...step, status: "complete", finishedAt: new Date().toISOString(), ...(message ? { message } : {}) }
    : step));
  writeRederiveState(repo, state);
  return state;
}

export function failRederiveStep(repo: string, id: RederiveStepId, message: string): RederiveState {
  const state = readRederiveState(repo) ?? startRederive(repo);
  const index = state.steps.findIndex((step) => step.id === id);
  if (index < 0) throw new Error(`Unknown re-derivation step '${id}'.`);
  state.steps = state.steps.map((step, position) => (position === index
    ? { ...step, status: "failed", finishedAt: new Date().toISOString(), message }
    : step));
  writeRederiveState(repo, state);
  return state;
}

export interface RederiveProgress {
  runId: string;
  /** True while any step is running. */
  active: boolean;
  /** The step to show as the current one: running, else the first unfinished. */
  currentStep: RederiveStepId | null;
  /** Steps after the first failure, which the UI offers to retry from. */
  failedStep: RederiveStepId | null;
  complete: boolean;
  steps: RederiveStep[];
}

/** Projects the chain's progress for the Console; a never-run chain reads as idle. */
export function rederiveProgress(repo: string): RederiveProgress {
  const state = readRederiveState(repo);
  if (!state) {
    return { runId: "", active: false, currentStep: null, failedStep: null, complete: false, steps: [] };
  }
  const failed = state.steps.find((step) => step.status === "failed");
  const running = state.steps.find((step) => step.status === "running");
  const pending = state.steps.find((step) => step.status === "pending");
  return {
    runId: state.runId,
    active: Boolean(running),
    currentStep: running?.id ?? pending?.id ?? null,
    failedStep: failed?.id ?? null,
    complete: state.steps.every((step) => step.status === "complete"),
    steps: state.steps,
  };
}