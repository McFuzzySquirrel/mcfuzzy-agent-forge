import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { authoringRunnerForHarness, harnessCliForHarness } from "./console/dashboard/harness-rules.ts";

export const AUTHORING_STAGES = ["prd", "team", "skills"] as const;
export type AuthoringStage = typeof AUTHORING_STAGES[number];
export type AuthoringModels = Partial<Record<AuthoringStage, string>>;
export const AUTHORING_RUNNER_CHOICES = ["copilot", "opencode", "claude"] as const;
export type AuthoringRunnerChoice = typeof AUTHORING_RUNNER_CHOICES[number];
export interface AuthoringConfig { version: 1; models: AuthoringModels; runner?: AuthoringRunnerChoice }
export interface AuthoringOptions { models?: AuthoringModels; runner?: string }
export type ModelSource = "invocation" | "environment" | "project" | "inherit";
export type RunnerSource = ModelSource;
export interface AuthoringModelSelection { requestedModel?: string; source: ModelSource }
/** `stub` is the test-only offline runner; it is reachable from FORGE_RUN_WITH alone. */
export interface AuthoringRunnerSelection { runner: AuthoringRunnerChoice | "stub"; source: RunnerSource }

function isRunnerChoice(value: string): value is AuthoringRunnerChoice {
  return (AUTHORING_RUNNER_CHOICES as readonly string[]).includes(value);
}

export function authoringConfigPath(repo: string): string {
  return path.join(repo, "docs", "authoring-config.json");
}

const RUNNER_CONFIG_ERROR = "Invalid authoring runner: use copilot, opencode, claude, or inherit.";

export function validateAuthoringConfig(value: unknown): AuthoringConfig {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 ||
      !("models" in value) || !value.models || typeof value.models !== "object" || Array.isArray(value.models)) {
    throw new Error("Invalid authoring config: expected {version:1,models:{prd?,team?,skills?}}.");
  }
  const models: AuthoringModels = {};
  for (const [stage, model] of Object.entries(value.models)) {
    if (!AUTHORING_STAGES.includes(stage as AuthoringStage)) throw new Error(`Unknown authoring stage: ${stage}`);
    if (typeof model !== "string" || !model.trim() || /[\s\0]/.test(model.trim())) {
      throw new Error(`Invalid ${stage} authoring model: use a model ID or omit the setting to inherit.`);
    }
    if (model.trim() !== "inherit") models[stage as AuthoringStage] = model.trim();
  }
  let runner: AuthoringRunnerChoice | undefined;
  if ("runner" in value) {
    const requested = (value as { runner: unknown }).runner;
    if (typeof requested !== "string") throw new Error(RUNNER_CONFIG_ERROR);
    const trimmed = requested.trim();
    if (trimmed !== "inherit") {
      if (!isRunnerChoice(trimmed)) throw new Error(RUNNER_CONFIG_ERROR);
      runner = trimmed;
    }
  }
  return { version: 1, models, ...(runner ? { runner } : {}) };
}

export function loadAuthoringConfig(repo: string): AuthoringConfig {
  const file = authoringConfigPath(repo);
  return fs.existsSync(file) ? validateAuthoringConfig(JSON.parse(fs.readFileSync(file, "utf8"))) : { version: 1, models: {} };
}

export function writeAuthoringJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

/** Full replacement; omitted keys restore runner inheritance. */
export function saveAuthoringConfig(repo: string, config: AuthoringConfig): AuthoringConfig {
  const validated = validateAuthoringConfig(config);
  writeAuthoringJson(authoringConfigPath(repo), validated);
  return validated;
}

export function selectAuthoringModel(
  repo: string, stage: AuthoringStage, overrides: AuthoringModels = {}, env: NodeJS.ProcessEnv = process.env,
): AuthoringModelSelection {
  const saved = loadAuthoringConfig(repo);
  const candidates: Array<[string | undefined, ModelSource]> = [
    [overrides[stage], "invocation"],
    [env[`FORGE_${stage.toUpperCase()}_MODEL`], "environment"],
    [saved.models[stage], "project"],
  ];
  for (const [value, source] of candidates) {
    if (value === undefined) continue;
    if (!value.trim() || value.trim() === "inherit") return { source: "inherit" };
    if (/[\s\0]/.test(value.trim())) throw new Error(`Invalid ${stage} authoring model ID.`);
    return { requestedModel: value.trim(), source };
  }
  return { source: "inherit" };
}

/**
 * Authoring runner for a repo, first defined wins: the invocation override, then
 * FORGE_RUN_WITH, then the persisted project choice, then the harness rule. An
 * empty or "inherit" value at any level falls straight through to the harness
 * rule, exactly as `selectAuthoringModel` does for a stage model.
 */
/**
 * True when `cmd` is reachable on the PATH carried by `env`. The launcher has an
 * equivalent probe over its own state; inheritance is resolved here because both
 * the launcher and the Console go through selectAuthoringRunner.
 */
function commandOnPath(env: NodeJS.ProcessEnv, cmd: string): boolean {
  const pathVar = env.PATH ?? env.Path ?? "";
  const isWin = process.platform === "win32";
  const exts = isWin ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of pathVar.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      try {
        fs.accessSync(path.join(dir, cmd + ext));
        return true;
      } catch {
        // continue
      }
    }
  }
  return false;
}

export function selectAuthoringRunner(
  repo: string,
  harness: string | null | undefined,
  overrides: AuthoringOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): AuthoringRunnerSelection {
  const saved = repo ? loadAuthoringConfig(repo) : { version: 1 as const, models: {} };
  const candidates: Array<[string | undefined, RunnerSource, boolean]> = [
    [overrides.runner, "invocation", false],
    [env.FORGE_RUN_WITH, "environment", true],
    [saved.runner, "project", false],
  ];
  for (const [value, source, allowStub] of candidates) {
    if (value === undefined) continue;
    const runner = value.trim();
    if (!runner || runner === "inherit") break;
    if (allowStub && runner === "stub") return { runner: "stub", source };
    if (!isRunnerChoice(runner)) {
      throw new Error(`Unsupported authoring runner: ${runner}. Use copilot, opencode, claude, or inherit.`);
    }
    return { runner, source };
  }
  // Only inheritance consults the machine. A Claude harness inherits the opencode
  // runner, so on a box with Claude Code but no OpenCode that default cannot run;
  // fall back to the harness's own CLI. When neither is installed the result is
  // unchanged so the spawn error still names the runner the operator configured.
  // The inherited !== native guard keeps every other harness off the filesystem.
  // It is a cost optimisation, not a correctness control: wherever it short
  // circuits the rest of the condition is self-contradictory, so dropping it
  // changes only whether a probe runs, never what this returns. No test can catch
  // its loss, so keep it when moving this rule.
  const inherited = authoringRunnerForHarness(harness);
  const native = harnessCliForHarness(harness).cli;
  if (inherited !== native && !commandOnPath(env, inherited) && commandOnPath(env, native)) {
    return { runner: native, source: "inherit" };
  }
  return { runner: inherited, source: "inherit" };
}
