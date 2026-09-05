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
}
export interface AuthoringState { version: 1; stages: Partial<Record<AuthoringStage, AuthoringStageState>> }
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
      if (file.split(path.sep).includes("agents") && file.endsWith(".md")) {
        hash.update(content.toString("utf8").replace(/^(---\r?\n)([\s\S]*?)(\r?\n---)/, (_match, start: string, metadata: string, end: string) =>
          start + metadata.split(/\r?\n/).filter((line) => !/^model(?:Fallback)?:/.test(line)).join("\n") + end));
      } else hash.update(content);
      hash.update("\0");
    }
  }
  return hash.digest("hex");
}

export function stageInputFingerprint(repo: string, stage: AuthoringStage, harnessRoot: string): string {
  const prd = ["docs/PRD.md", "docs/product-vision.md", "docs/features"];
  const inputs = stage === "prd" ? ["docs/IDEA.md"] : stage === "team" ? prd
    : [...prd, path.join(harnessRoot, "agents"), "docs/SKILL-CANDIDATES.json"];
  return fingerprintFiles(repo, inputs, harnessRoot);
}

export function authoringStageIsCurrent(repo: string, stage: AuthoringStage, harnessRoot: string): boolean {
  const state = readAuthoringState(repo).stages[stage];
  return state?.status === "complete" && state.inputFingerprint === stageInputFingerprint(repo, stage, harnessRoot) &&
    state.outputs.every((file) => fs.existsSync(path.join(repo, file))) &&
    (!state.outputFingerprint || state.outputFingerprint === fingerprintFiles(repo, state.outputs));
}

/** Legacy projects without an active authoring transaction retain their build path. */
export function authoringReadiness(repo: string, harnessRoot: string): { ready: boolean; reason?: string; nextStage?: AuthoringStage } {
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
