import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { AUTHORING_STAGES, writeAuthoringJson, type AuthoringStage } from "./authoring-config.ts";
import type { AuthoringInvocation } from "./authoring-inventory.ts";

export interface SkillCandidate {
  name: string;
  description: string;
  consumers: string[];
  action: "reuse" | "extend" | "create" | "omit";
  reason: string;
}
export interface SkillCandidates { version: 1; candidates: SkillCandidate[] }
export interface AuthoringStageState {
  status: "pending" | "running" | "complete" | "failed";
  inputFingerprint: string;
  outputs: string[];
  outputFingerprint?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  invocation?: AuthoringInvocation;
  noSkillsRequired?: boolean;
  /** Skills-stage candidates with `action: "reuse"`, satisfied outside this repo. */
  reusedSkills?: string[];
}
export interface FeatureIncrementHandoff {
  featureFingerprints: Record<string, string>;
  createdAt: string;
}
export interface AuthoringState {
  version: 1;
  stages: Partial<Record<AuthoringStage, AuthoringStageState>>;
  featureIncrementHandoff?: FeatureIncrementHandoff;
}
export const authoringStatePath = (repo: string) => path.join(repo, "docs", "authoring-state.json");

export function readAuthoringState(repo: string): AuthoringState {
  const file = authoringStatePath(repo);
  if (!fs.existsSync(file)) return { version: 1, stages: {} };
  const value = JSON.parse(fs.readFileSync(file, "utf8")) as AuthoringState;
  if (value.version !== 1 || !value.stages || typeof value.stages !== "object" || Array.isArray(value.stages)) {
    throw new Error("Invalid authoring state: expected version 1 and stages object.");
  }
  for (const [name, stage] of Object.entries(value.stages)) {
    if (!AUTHORING_STAGES.includes(name as AuthoringStage) || !stage || !["pending", "running", "complete", "failed"].includes(stage.status) ||
        typeof stage.inputFingerprint !== "string" || !Array.isArray(stage.outputs) ||
        stage.outputs.some((output) => typeof output !== "string" || path.isAbsolute(output) ||
          output.split(/[/\\]/).includes(".."))) throw new Error("Invalid authoring stage state.");
  }
  return value;
}

export function saveAuthoringStage(repo: string, stage: AuthoringStage, value: AuthoringStageState): void {
  const state = readAuthoringState(repo);
  state.stages[stage] = value;
  writeAuthoringJson(authoringStatePath(repo), state);
}

export function recordAuthoringStageSuccess(repo: string, stage: AuthoringStage, outputs: string[], harnessRoot: string): void {
  const prior = readAuthoringState(repo).stages[stage];
  saveAuthoringStage(repo, stage, {
    status: "complete",
    inputFingerprint: stageInputFingerprint(repo, stage, harnessRoot),
    outputs,
    outputFingerprint: fingerprintFiles(repo, outputs),
    completedAt: new Date().toISOString(),
    ...(prior?.invocation ? { invocation: prior.invocation } : {}),
  });
}

function featureDocumentFingerprints(repo: string): Record<string, string> {
  const directory = path.join(repo, "docs", "features");
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return {};
  return Object.fromEntries(fs.readdirSync(directory).filter((name) => name.endsWith(".md"))
    .filter((name) => fs.statSync(path.join(directory, name)).isFile())
    .sort()
    .map((name) => [name, createHash("sha256").update(fs.readFileSync(path.join(directory, name))).digest("hex")]));
}

export function recordFeatureIncrementHandoff(repo: string): void {
  const state = readAuthoringState(repo);
  state.featureIncrementHandoff = {
    featureFingerprints: featureDocumentFingerprints(repo),
    createdAt: new Date().toISOString(),
  };
  writeAuthoringJson(authoringStatePath(repo), state);
}

export function featureIncrementHandoffHasChange(repo: string): boolean {
  const baseline = readAuthoringState(repo).featureIncrementHandoff?.featureFingerprints;
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) return false;
  const current = featureDocumentFingerprints(repo);
  return Object.entries(current).some(([name, fingerprint]) => baseline[name] !== fingerprint);
}

export function clearFeatureIncrementHandoff(repo: string): void {
  const state = readAuthoringState(repo);
  if (!state.featureIncrementHandoff) return;
  delete state.featureIncrementHandoff;
  writeAuthoringJson(authoringStatePath(repo), state);
}

export function readSkillCandidates(repo: string): SkillCandidates | null {
  const file = path.join(repo, "docs", "SKILL-CANDIDATES.json");
  if (!fs.existsSync(file)) return null;
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 ||
      !("candidates" in value) || !Array.isArray(value.candidates)) throw new Error("Invalid SKILL-CANDIDATES.json: expected {version:1,candidates:[]}.");
  const candidates: SkillCandidate[] = [];
  const names = new Set<string>();
  for (const candidate of value.candidates) {
    if (!candidate || typeof candidate !== "object" ||
        typeof candidate.name !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.name) ||
        typeof candidate.description !== "string" || !candidate.description.trim() ||
        typeof candidate.reason !== "string" || !candidate.reason.trim() ||
        !["reuse", "extend", "create", "omit"].includes(candidate.action) ||
        !Array.isArray(candidate.consumers) || candidate.consumers.some((name: unknown) => typeof name !== "string" || !name.trim()) ||
        names.has(candidate.name)) throw new Error("Invalid or duplicate project skill candidate.");
    names.add(candidate.name);
    candidates.push(candidate);
  }
  return { version: 1, candidates };
}

function listFiles(repo: string, relative: string): string[] {
  const full = path.join(repo, relative);
  if (!fs.existsSync(full)) return [];
  if (fs.lstatSync(full).isSymbolicLink()) return [];
  if (fs.statSync(full).isFile()) return [relative];
  const ignored = new Set([".git", "node_modules", "dist", "build", "coverage", ".cache", ".turbo", ".next"]);
  return fs.readdirSync(full).filter((name) => !ignored.has(name)).sort()
    .flatMap((name) => listFiles(repo, path.join(relative, name)));
}

export function fingerprintFiles(repo: string, inputs: string[], extra = ""): string {
  const hash = createHash("sha256");
  hash.update(extra);
  for (const input of inputs) {
    hash.update(`\0input:${input}\0`);
    for (const file of listFiles(repo, input)) {
      hash.update(file);
      hash.update("\0");
      const content = fs.readFileSync(path.join(repo, file));
      // Execution-only frontmatter overrides must not invalidate authoring readiness.
      if (file.split(/[\\/]/).includes("agents") && file.endsWith(".md")) {
        hash.update(content.toString("utf8").replace(/^(---\r?\n)([\s\S]*?)(\r?\n---)/, (_match, start: string, metadata: string, end: string) =>
          start + metadata.split(/\r?\n/).filter((line) => !/^model(?:Fallback)?:/.test(line)).join("\n") + end));
      } else hash.update(content);
      hash.update("\0");
    }
  }
  return hash.digest("hex");
}

/**
 * Repository-relative inputs a stage derives from. Shared by the fingerprint and
 * by `explainStaleness` so the files a stage is judged against and the files
 * named as the cause of its staleness can never disagree.
 */
export function stageInputPaths(stage: AuthoringStage, harnessRoot: string): string[] {
  const prd = ["docs/PRD.md", "docs/features"];
  return stage === "prd" ? ["docs/IDEA.md", "docs/requirements-source.md"] : stage === "team" ? prd
    : [...prd, path.join(harnessRoot, "agents"), "docs/SKILL-CANDIDATES.json"];
}

export function stageInputFingerprint(repo: string, stage: AuthoringStage, harnessRoot: string): string {
  return fingerprintFiles(repo, stageInputPaths(stage, harnessRoot), harnessRoot);
}

export function authoringStageIsCurrent(repo: string, stage: AuthoringStage, harnessRoot: string): boolean {
  const state = readAuthoringState(repo).stages[stage];
  return state?.status === "complete" && state.inputFingerprint === stageInputFingerprint(repo, stage, harnessRoot) &&
    state.outputs.every((file) => fs.existsSync(path.join(repo, file))) &&
    (!state.outputFingerprint || state.outputFingerprint === fingerprintFiles(repo, state.outputs));
}

// ─── Staleness explanation ────────────────────────────────────────────────────
//
// The Console used to learn only that authoring was "not ready" plus one
// free-text blocker, so a user who edited the PRD had to guess which stage had
// gone stale and re-derive it by hand. These helpers name the cause instead.
//
// The reason is *derived* on every read rather than recorded when the stage ran:
// a stored reason would be missing for every stage authored before this existed,
// and would itself go stale. `staleInputs` are found by comparing each input
// file's mtime against the stage's own `completedAt`, so the named files are
// always a subset of the files the fingerprint that drove the staleness decision
// actually covers.

/** How many changed inputs to name before summarising the rest as a count. */
const MAX_NAMED_INPUTS = 6;

export interface StaleInput { path: string; modifiedAt: string }

export interface StalenessExplanation {
  stale: boolean;
  reason: string;
  staleInputs: StaleInput[];
}

/**
 * Repository-relative paths are display identifiers, not filesystem paths.
 *
 * `listFiles` joins children with `path.join`, so a walked path arrives as
 * `docs\features\auth.md` on Windows. That string is what the Console prints and
 * what a reader copies into a git command, so separators are normalised where a
 * path becomes text — otherwise one sentence mixes `docs/PRD.md` (a literal input)
 * with `docs\features\auth.md` (a walked one).
 *
 * Deliberately *not* applied inside `listFiles` or `fingerprintFiles`: those
 * strings are hashed, so changing them would invalidate every recorded
 * fingerprint on Windows and make unchanged projects look stale.
 */
function displayPath(relative: string): string {
  return relative.replace(/\\/g, "/");
}

function modifiedAt(repo: string, relative: string): string | null {
  const full = path.join(repo, relative);
  try {
    return new Date(fs.statSync(full).mtimeMs).toISOString();
  } catch {
    return null;
  }
}

/** Input files written after `after`, newest first, capped for display. */
function changedInputsSince(repo: string, stage: AuthoringStage, harnessRoot: string, after: string): StaleInput[] {
  const threshold = Date.parse(after);
  if (Number.isNaN(threshold)) return [];
  const seen = new Set<string>();
  const changed: StaleInput[] = [];
  for (const input of stageInputPaths(stage, harnessRoot)) {
    for (const file of listFiles(repo, input)) {
      if (seen.has(file)) continue;
      seen.add(file);
      const at = modifiedAt(repo, file);
      if (at && Date.parse(at) > threshold) changed.push({ path: displayPath(file), modifiedAt: at });
    }
  }
  return changed.sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt));
}

function listNames(values: string[], cap = 3): string {
  const shown = values.slice(0, cap).join(", ");
  return values.length > cap ? `${shown} and ${values.length - cap} more` : shown;
}

/**
 * Why a recorded stage no longer matches its repository, in plain language.
 * A stage with no record, or one that has not completed, is never "stale" — it
 * is simply untracked or in flight, which the UI reports separately.
 */
export function explainStaleness(repo: string, stage: AuthoringStage, harnessRoot: string): StalenessExplanation {
  const state = readAuthoringState(repo).stages[stage];
  if (!state || state.status !== "complete") return { stale: false, reason: "", staleInputs: [] };

  const missing = state.outputs.filter((file) => !fs.existsSync(path.join(repo, file)));
  if (missing.length > 0) {
    return { stale: true, reason: `Generated output removed from disk: ${listNames(missing)}`, staleInputs: [] };
  }

  const inputsChanged = state.inputFingerprint !== stageInputFingerprint(repo, stage, harnessRoot);
  if (inputsChanged) {
    const changed = changedInputsSince(repo, stage, harnessRoot, state.completedAt ?? new Date(0).toISOString());
    const named = changed.slice(0, MAX_NAMED_INPUTS).map((entry) => entry.path);
    // Joined directly rather than through `listNames`, which would apply its own
    // cap on top of ours and read "and 3 more and 1 more".
    const remainder = changed.length - named.length;
    const detail = remainder > 0 ? `${named.join(", ")} and ${remainder} more` : named.join(", ");
    return {
      stale: true,
      staleInputs: changed.slice(0, MAX_NAMED_INPUTS),
      reason: detail
        ? `Inputs changed after this stage completed: ${detail}`
        : `Inputs changed after this stage completed${state.completedAt ? ` (${state.completedAt})` : ""}.`,
    };
  }

  if (state.outputFingerprint && state.outputFingerprint !== fingerprintFiles(repo, state.outputs)) {
    return {
      stale: true,
      staleInputs: [],
      reason: `Generated outputs were edited or regenerated after this stage completed${state.completedAt ? ` (${state.completedAt})` : ""}.`,
    };
  }

  return { stale: false, reason: "", staleInputs: [] };
}

export interface AuthoringStageDetail {
  stage: AuthoringStage;
  /** Recorded status, or "untracked" when this Console never authored the stage. */
  status: "untracked" | "pending" | "running" | "complete" | "failed";
  /** True only when a recorded, completed stage no longer matches its inputs. */
  stale: boolean;
  /** Plain-language cause of staleness, or why the stage cannot run. Empty when current. */
  reason: string;
  /** Inputs written after the stage completed, newest first. */
  staleInputs: StaleInput[];
  outputs: string[];
  completedAt?: string;
}

/** Per-stage authoring detail for the Console, for every stage in order. */
export function authoringStageDetails(repo: string, harnessRoot: string): AuthoringStageDetail[] {
  const state = readAuthoringState(repo).stages;
  return AUTHORING_STAGES.map((stage) => {
    const recorded = state[stage];
    if (!recorded) return { stage, status: "untracked", stale: false, reason: "", staleInputs: [], outputs: [] };
    const explanation = explainStaleness(repo, stage, harnessRoot);
    return {
      stage,
      status: recorded.status,
      stale: explanation.stale,
      reason: recorded.status === "complete"
        ? explanation.reason
        : recorded.error ?? `This stage has not completed (status: ${recorded.status}).`,
      staleInputs: explanation.staleInputs,
      outputs: recorded.outputs,
      ...(recorded.completedAt ? { completedAt: recorded.completedAt } : {}),
    };
  });
}

export function authoringReadiness(repo: string, harnessRoot: string): { ready: boolean; reason?: string; nextStage?: AuthoringStage } {
  const features = path.join(repo, "docs/features");
  if (!fs.existsSync(path.join(repo, "docs/PRD.md")) || !fs.existsSync(features) || !fs.statSync(features).isDirectory() || !fs.readdirSync(features).some((file) => file.endsWith(".md"))) {
    return { ready: false, nextStage: "prd", reason: "Every solution requires docs/PRD.md + docs/features/*.md; run draft-prd to author or convert source requirements." };
  }
  const state = readAuthoringState(repo);
  if (state.stages.prd && state.stages.prd.status !== "complete") {
    return { ready: false, nextStage: "prd", reason: "PRD authoring is incomplete; retry the failed PRD stage before building." };
  }
  if (!state.stages.team && !state.stages.skills && !readSkillCandidates(repo)) return { ready: true };
  if (state.stages.team && !authoringStageIsCurrent(repo, "team", harnessRoot)) {
    return { ready: false, nextStage: "team", reason: "Team authoring is incomplete or its PRD inputs changed; run draft-team." };
  }
  if (!authoringStageIsCurrent(repo, "skills", harnessRoot)) {
    return { ready: false, nextStage: "skills", reason: "Project skills are incomplete or their inputs changed; run draft-skills." };
  }
  return { ready: true };
}
