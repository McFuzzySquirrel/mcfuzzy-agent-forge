import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import type { AuditEvent, TaskRecord, TaskUsage, WorkflowState } from "./types.ts";
import type { ExecutionManifest, ManifestPhase, PhaseRecord, TaskSelection } from "./types.ts";
import { broadcastAudit } from "./viz/bus.ts";

// ─── State file helpers ───────────────────────────────────────────────────────

export function loadState(statePath: string): WorkflowState | null {
  if (!existsSync(statePath)) return null;
  return JSON.parse(readFileSync(statePath, "utf8")) as WorkflowState;
}

export function saveState(statePath: string, state: WorkflowState): void {
  mkdirSync(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", flag: "wx", flush: true });
    renameSync(temporaryPath, statePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function phaseContractFingerprint(phase: ManifestPhase): string {
  return JSON.stringify({
    completionPolicy: phase.completionPolicy ?? "task-only",
    dependencies: phase.dependencies,
    requiredOutputs: phase.requiredOutputs ?? [],
    validationCommands: phase.validationCommands ?? [],
    tasks: phase.tasks.map((task) => ({
      id: task.id,
      required: task.required !== false,
      expectedOutputs: task.expectedOutputs,
    })),
  });
}

function initialPhaseRecord(phase: ManifestPhase, status: PhaseRecord["status"] = "pending"): PhaseRecord {
  return {
    phaseId: phase.id,
    status,
    contractFingerprint: phaseContractFingerprint(phase),
    updatedAt: new Date().toISOString(),
  };
}

export function initState(
  manifest: ExecutionManifest,
  manifestPath: string,
  harnessName: string,
): WorkflowState {
  const now = new Date().toISOString();
  const tasks: Record<string, TaskRecord> = {};
  const phases: Record<string, PhaseRecord> = {};

  for (const phase of manifest.phases) {
    phases[phase.id] = initialPhaseRecord(phase);
    for (const task of phase.tasks) {
      tasks[task.id] = {
        taskId: task.id,
        status: "pending",
        ownerAgent: task.ownerAgent,
        attempt: 0,
        outputFiles: [],
      };
    }
  }

  return {
    runId: randomUUID(),
    startedAt: now,
    lastUpdatedAt: now,
    manifestPath,
    manifestVersion: manifest.version,
    harness: harnessName,
    status: "running",
    currentPhase: manifest.phases[0]?.id,
    tasks,
    phases,
    blockers: [],
    auditLog: [],
    sessions: {},
  };
}

/** Preserve persisted task records by stable ID while adopting a new manifest. */
export function reconcileState(state: WorkflowState, manifest: ExecutionManifest): WorkflowState {
  const nextTasks: Record<string, TaskRecord> = {};
  const nextPhases: Record<string, PhaseRecord> = {};
  for (const phase of manifest.phases) {
    for (const task of phase.tasks) {
      nextTasks[task.id] = state.tasks[task.id] ?? {
        taskId: task.id, status: "pending", ownerAgent: task.ownerAgent, attempt: 0, outputFiles: [],
      };
      if (state.tasks[task.id]) nextTasks[task.id] = { ...state.tasks[task.id], ownerAgent: task.ownerAgent };
    }
    const previous = state.phases?.[phase.id];
    const fingerprint = phaseContractFingerprint(phase);
    nextPhases[phase.id] = previous?.contractFingerprint === fingerprint
      ? previous
      : initialPhaseRecord(phase);
  }
  const added = Object.keys(nextTasks).filter((id) => !state.tasks[id]);
  const removed = Object.keys(state.tasks).filter((id) => !nextTasks[id]);
  const phaseRecordsChanged = Object.keys(nextPhases).length !== Object.keys(state.phases ?? {}).length
    || Object.entries(nextPhases).some(([id, phase]) => phase !== state.phases?.[id]);
  const changed = new Set(manifest.reconciliation?.changedTaskIds ?? []);
  if (added.length === 0 && removed.length === 0 && changed.size === 0 && !phaseRecordsChanged && state.manifestVersion === manifest.version) return state;
  return {
    ...state,
    manifestVersion: manifest.version,
    tasks: nextTasks,
    phases: nextPhases,
    blockers: [...state.blockers,
      ...(added.length ? [`Manifest reconciliation added ${added.length} pending task(s): ${added.join(", ")}`] : []),
      ...(removed.length ? [`Manifest reconciliation removed ${removed.length} task(s): ${removed.join(", ")}`] : []),
      ...(changed.size ? [`Manifest reconciliation changed ${changed.size} existing task(s): ${[...changed].join(", ")}`] : [])],
    lastUpdatedAt: new Date().toISOString(),
  };
}

// ─── Record-level transitions ─────────────────────────────────────────────────
//
// The engine is the single writer of `WorkflowState`. A task never derives a
// whole new state from the snapshot it was handed (that loses updates when
// several tasks run concurrently); it owns one `TaskRecord` and the engine
// splices that record into the authoritative state.

export function startRecord(record: TaskRecord): TaskRecord {
  return {
    ...record,
    status: "running",
    startedAt: new Date().toISOString(),
    attempt: record.attempt + 1,
  };
}

export function completeRecord(
  record: TaskRecord,
  outputFiles: string[],
  agentOutput: string,
  artifactId?: string,
  inputArtifactIds?: string[],
  validationLimitations?: string[],
): TaskRecord {
  return {
    ...record,
    status: "complete",
    completedAt: new Date().toISOString(),
    outputFiles,
    agentOutput,
    errorMessage: undefined,
    failureKind: undefined,
    validationLimitations: validationLimitations?.length ? [...validationLimitations] : undefined,
    ...(artifactId !== undefined ? { artifactId } : {}),
    ...(inputArtifactIds !== undefined ? { inputArtifactIds } : {}),
  };
}

export function failRecord(record: TaskRecord, errorMessage: string): TaskRecord {
  return { ...record, status: "failed", completedAt: new Date().toISOString(), errorMessage };
}

/**
 * Sums two usage reports into one cumulative record.
 *
 * A retried task may consume tokens on every attempt, so the task record keeps
 * the total. `source` stays "harness" while any attempt reported real numbers;
 * a later "unavailable" attempt never erases the earlier counts.
 */
export function mergeUsage(previous: TaskUsage | undefined, next: TaskUsage | undefined): TaskUsage | undefined {
  if (!previous && !next) return undefined;
  if (!next) return previous;
  if (!previous) return next;
  const add = (a?: number, b?: number): number | undefined => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));
  return {
    inputTokens: add(previous.inputTokens, next.inputTokens),
    outputTokens: add(previous.outputTokens, next.outputTokens),
    cacheReadTokens: add(previous.cacheReadTokens, next.cacheReadTokens),
    cacheWriteTokens: add(previous.cacheWriteTokens, next.cacheWriteTokens),
    reasoningTokens: add(previous.reasoningTokens, next.reasoningTokens),
    costUsd: add(previous.costUsd, next.costUsd),
    credits: add(previous.credits, next.credits),
    source: previous.source === "harness" || next.source === "harness" ? "harness" : "unavailable",
    note: next.note ?? previous.note,
  };
}

export function withTaskRecord(state: WorkflowState, record: TaskRecord): WorkflowState {
  return { ...state, lastUpdatedAt: new Date().toISOString(), tasks: { ...state.tasks, [record.taskId]: record } };
}

export function markTaskStarted(state: WorkflowState, taskId: string): WorkflowState {
  const task = state.tasks[taskId];
  if (!task) throw new Error(`Unknown task: ${taskId}`);
  return withTaskRecord(state, startRecord(task));
}

export function markTaskComplete(
  state: WorkflowState,
  taskId: string,
  outputFiles: string[],
  agentOutput: string,
  artifactId?: string,
  inputArtifactIds?: string[],
  validationLimitations?: string[],
): WorkflowState {
  const task = state.tasks[taskId];
  if (!task) throw new Error(`Unknown task: ${taskId}`);
  return withTaskRecord(state, completeRecord(task, outputFiles, agentOutput, artifactId, inputArtifactIds, validationLimitations));
}

export function markTaskFailed(
  state: WorkflowState,
  taskId: string,
  errorMessage: string,
): WorkflowState {
  const task = state.tasks[taskId];
  if (!task) throw new Error(`Unknown task: ${taskId}`);
  return withTaskRecord(state, failRecord(task, errorMessage));
}

export function markTaskSkipped(state: WorkflowState, taskId: string): WorkflowState {
  const task = state.tasks[taskId];
  if (!task) throw new Error(`Unknown task: ${taskId}`);

  return {
    ...state,
    lastUpdatedAt: new Date().toISOString(),
    tasks: {
      ...state.tasks,
      [taskId]: { ...task, status: "skipped" },
    },
  };
}

export function setCurrentPhase(state: WorkflowState, phaseId: string): WorkflowState {
  return { ...state, currentPhase: phaseId, lastUpdatedAt: new Date().toISOString() };
}

export function setSelection(state: WorkflowState, selection: TaskSelection | undefined): WorkflowState {
  return { ...state, selection, lastUpdatedAt: new Date().toISOString() };
}

export function appendAuditEvent(state: WorkflowState, event: AuditEvent): WorkflowState {
  return {
    ...state,
    auditLog: [...state.auditLog, event],
  };
}

// ─── PROGRESS.md sync ─────────────────────────────────────────────────────────

export function syncProgressMd(
  progressPath: string,
  state: WorkflowState,
  manifest: ExecutionManifest,
): void {
  mkdirSync(dirname(progressPath), { recursive: true });
  const now = new Date().toISOString();

  const scoped = state.selection?.mode === "manual" && state.selection.taskIds.length > 0
    ? new Set(state.selection.taskIds)
    : null;
  const inScope = (taskId: string) => !scoped || scoped.has(taskId);

  const completedLines: string[] = [];
  for (const phase of manifest.phases) {
    for (const task of phase.tasks) {
      if (!inScope(task.id)) continue;
      const record = state.tasks[task.id];
      if (record?.status === "complete") {
        const agentTag = task.ownerAgent ? ` (@${task.ownerAgent})` : "";
        completedLines.push(`- [x] Phase ${phase.id}, Task ${task.id}: ${task.title}${agentTag}`);
        if (record.outputFiles.length > 0) {
          completedLines.push(`  - Files: ${record.outputFiles.join(", ")}`);
        }
      }
    }
  }

  // Every in-flight task is listed: a parallel wave runs more than one at a
  // time, and a first-match-only summary would hide all but one of them.
  const runningEntries = Object.values(state.tasks).filter((t) => t.status === "running");
  const currentLines: string[] = [];
  for (const entry of runningEntries) {
    const phaseId = findPhaseForTask(manifest, entry.taskId);
    const task = findTask(manifest, entry.taskId);
    if (task && phaseId && inScope(task.id)) {
      currentLines.push(`- [ ] Phase ${phaseId}, Task ${task.id}: ${task.title}${task.ownerAgent ? ` (@${task.ownerAgent})` : ""}`);
      currentLines.push("  - Status: In progress");
    }
  }
  if (runningEntries.length === 0) {
    currentLines.push(...(state.status === "complete" ? ["- [x] All workflow tasks completed"] : ["- None currently running"]));
  }

  const remainingPhases = manifest.phases.filter((phase) =>
    phase.tasks.some((task) => {
      if (!inScope(task.id)) return false;
      const record = state.tasks[task.id];
      return record?.status === "pending" || record?.status === "running";
    }),
  );

  const remainingLines = remainingPhases.length > 0
    ? remainingPhases.map((phase) => `- [ ] Phase ${phase.id}: ${phase.title}`)
    : ["- [x] No remaining phases"];

  const blockerLines = state.blockers.length > 0
    ? state.blockers.map((b) => `- ${b}`)
    : ["- None"];

  // Surface nonblocking "not run" checks so a Complete run cannot silently hide
  // untested integration boundaries (e.g. mocked-only external services).
  const gapLines: string[] = [];
  for (const phase of manifest.phases) {
    for (const task of phase.tasks) {
      if (!inScope(task.id)) continue;
      const record = state.tasks[task.id];
      if (record?.status !== "complete") continue;
      for (const limitation of record.validationLimitations ?? []) gapLines.push(`- Task ${task.id}: ${limitation}`);
    }
  }

  const statusLabel = state.status === "complete" ? "Complete"
    : state.status === "paused" ? "Paused"
    : state.status === "failed" ? "Failed"
    : "In Progress";

  const lines = [
    "# Project Progress",
    "",
    "## Current State",
    `**Phase**: ${state.currentPhase ?? "Not Started"}`,
    `**Status**: ${statusLabel}`,
    ...(gapLines.length > 0 ? [`**Validation Gaps**: ${gapLines.length} unverified check(s) - see "Validation Gaps"`] : []),
    `**Last Updated**: ${now}`,
    `**Run ID**: ${state.runId}`,
    `**Harness**: ${state.harness}`,
    `**Execution Mode**: ${state.selection?.mode ?? "auto"}`,
    ...(state.selection?.mode === "manual"
      ? [`**Selected Tasks**: ${state.selection.taskIds.join(", ") || "none"}`]
      : []),
    "",
    "## Completed Tasks",
    ...(completedLines.length > 0 ? completedLines : ["- None"]),
    "",
    "## Current Task",
    ...currentLines,
    "",
    "## Remaining",
    ...remainingLines,
    "",
    "## Blockers",
    ...blockerLines,
    "",
    "## Validation Gaps",
    ...(gapLines.length > 0 ? gapLines : ["- None reported"]),
    "",
    "## Notes",
    `- Workflow engine run ${state.runId}`,
    `- Harness: ${state.harness}`,
    "",
  ];

  writeFileSync(progressPath, lines.join("\n"), "utf8");
}

// ─── Audit log helpers ────────────────────────────────────────────────────────

export function writeAuditEvent(auditPath: string, event: AuditEvent): void {
  mkdirSync(dirname(auditPath), { recursive: true });
  appendFileSync(auditPath, `${JSON.stringify(event)}\n`, "utf8");
  // Broadcast the same event to the live visualization server (no-op unless a
  // dashboard is running in this process).
  broadcastAudit(event);
}

// ─── Manifest traversal helpers ──────────────────────────────────────────────

export function findPhaseForTask(manifest: ExecutionManifest, taskId: string): string | undefined {
  for (const phase of manifest.phases) {
    if (phase.tasks.some((t) => t.id === taskId)) return phase.id;
  }
  return undefined;
}

export function findTask(manifest: ExecutionManifest, taskId: string) {
  for (const phase of manifest.phases) {
    const task = phase.tasks.find((t) => t.id === taskId);
    if (task) return task;
  }
  return undefined;
}

export function statePath(repoRoot: string): string {
  return join(repoRoot, "docs", "WORKFLOW-STATE.json");
}

export function auditPath(repoRoot: string): string {
  return join(repoRoot, "docs", "EXECUTION-AUDIT.jsonl");
}
