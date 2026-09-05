import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const AUTHORING_STAGES = ["prd", "team", "skills"] as const;
export type AuthoringStage = typeof AUTHORING_STAGES[number];
export type AuthoringModels = Partial<Record<AuthoringStage, string>>;
export interface AuthoringConfig { version: 1; models: AuthoringModels }
export interface AuthoringOptions { models?: AuthoringModels }
export type ModelSource = "invocation" | "environment" | "project" | "inherit";
export interface AuthoringModelSelection { requestedModel?: string; source: ModelSource }

export function authoringConfigPath(repo: string): string {
  return path.join(repo, "docs", "authoring-config.json");
}

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
  return { version: 1, models };
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
