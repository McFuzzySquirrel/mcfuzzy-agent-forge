import fs from "node:fs";
import path from "node:path";
import { runCommand } from "./format.ts";
import { writeAuthoringJson, selectAuthoringModel, type AuthoringModels, type AuthoringStage, type ModelSource } from "./authoring-config.ts";

export type AuthoringRunner = "copilot" | "opencode" | "stub";
export interface AuthoringInventoryModel {
  id: string;
  provider: string;
  last_verified?: string;
  capabilities?: Record<string, unknown>;
}
export interface AuthoringInventory { models: AuthoringInventoryModel[]; last_verified?: string }
export interface AuthoringInvocation {
  runner: AuthoringRunner;
  source: ModelSource;
  requestedModel?: string;
  effectiveModel?: string;
  inventoryVerifiedAt?: string;
  argv?: string[];
  skill?: string;
}
export type InventoryProbe = (runner: AuthoringRunner, args: string[], repo: string) => Promise<{ code: number; stdout: string; stderr: string }>;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const inventoryPath = (repo: string) => path.join(repo, "docs", "research", "model-inventory.json");
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function readRawInventory(repo: string): Record<string, unknown> {
  const file = inventoryPath(repo);
  if (!fs.existsSync(file)) return {};
  const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!record(value)) throw new Error("Invalid model inventory: expected an object.");
  return value;
}

export function readAuthoringInventory(repo: string): AuthoringInventory {
  const raw = readRawInventory(repo);
  const last_verified = typeof raw.last_verified === "string" ? raw.last_verified : undefined;
  const models: AuthoringInventoryModel[] = [];
  for (const [provider, section] of Object.entries(raw)) {
    if (!record(section) || section.available === false || !Array.isArray(section.models)) continue;
    const verified = Object.hasOwn(section, "last_verified")
      ? typeof section.last_verified === "string" ? section.last_verified : undefined
      : last_verified;
    for (const item of section.models) {
      if (!record(item) || item.excluded || item.available === false) continue;
      const id = typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : "";
      if (!id.trim()) continue;
      const capabilities = record(item.capabilities) ? { ...item.capabilities } : {};
      if (item.tool_calling === false) capabilities.tool_calling = false;
      models.push({ id: id.trim(), provider, last_verified: verified, capabilities });
    }
  }
  return { models, last_verified };
}

export function inventoryForRunner(inventory: AuthoringInventory, runner: AuthoringRunner): AuthoringInventoryModel[] {
  const providers = runner === "copilot" ? ["copilot_cli", "copilot_subscription"] : runner === "opencode" ? ["opencode_cli"] : ["stub"];
  return inventory.models.filter((model) => providers.includes(model.provider));
}

/** Accept unambiguous IDs only; diagnostics/headings are never model availability. */
export function parseModelInventoryOutput(text: string, runner: AuthoringRunner): string[] {
  const ids = new Set<string>();
  for (const line of text.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/)) {
    if (/\b(?:unavailable|disabled|not supported)\b/i.test(line)) continue;
    let cleaned = line.trim();
    if (cleaned.startsWith("|")) cleaned = cleaned.split("|")[1]?.trim() ?? "";
    cleaned = cleaned.replace(/^[-*]\s+|^\d+[.)]\s+/, "")
      .replace(/^(?:OpenAI|Anthropic|Google|Copilot)\s*(?::| -)\s*/i, "")
      .replace(/\s+(?:\([^()]*\)|\[[^\]]*\])\s*$/, "")
      .replace(/^['"`]|['"`]$/g, "");
    const match = cleaned.match(/^([a-zA-Z0-9][a-zA-Z0-9._:/-]*)$/);
    const id = match?.[1];
    if (!id || !/[./\d-]/.test(id) || /^(?:https?:|version|copilot-cli)/i.test(id)) continue;
    if (runner === "opencode" && !id.includes("/")) continue;
    ids.add(id);
  }
  return [...ids];
}

const defaultProbe: InventoryProbe = (runner, args, repo) => runCommand(runner, args, { cwd: repo, capture: true });

/** Only runs inventory commands, never a generation prompt. Preserves unrelated provider sections. */
export async function refreshAuthoringInventory(repo: string, runner: AuthoringRunner, probe: InventoryProbe = defaultProbe): Promise<AuthoringInventory> {
  if (runner === "stub") return readAuthoringInventory(repo);
  const args = runner === "opencode" ? ["models"] : ["-p", "/model list"];
  const result = await probe(runner, args, repo);
  if (result.code !== 0) throw new Error(`${runner} model discovery failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
  const ids = parseModelInventoryOutput(result.stdout, runner);
  if (!ids.length) throw new Error(`${runner} model discovery returned no unambiguous model IDs. Refresh docs/research/model-inventory.json from the runner's model picker.`);
  const raw = readRawInventory(repo);
  const prior = readAuthoringInventory(repo);
  const now = new Date().toISOString();
  // Freeze legacy providers' old freshness before advancing the root timestamp.
  for (const section of Object.values(raw)) {
    if (record(section) && Array.isArray(section.models) && section.last_verified === undefined) section.last_verified = raw.last_verified ?? null;
  }
  raw[`${runner}_cli`] = {
    available: true, last_verified: now,
    models: ids.map((id) => ({ id, ...(prior.models.find((model) => model.provider === `${runner}_cli` && model.id === id)?.capabilities
      ? { capabilities: prior.models.find((model) => model.provider === `${runner}_cli` && model.id === id)!.capabilities } : {}) })),
    diagnostics: { command: [runner, ...args], exitCode: result.code, raw_output: result.stdout, stderr: result.stderr },
  };
  raw.last_verified = now;
  writeAuthoringJson(inventoryPath(repo), raw);
  return readAuthoringInventory(repo);
}

function fresh(value: string | undefined): boolean {
  const age = Date.now() - Date.parse(value ?? "");
  return Number.isFinite(age) && age >= -60_000 && age < MAX_AGE_MS;
}

export async function resolveAuthoringModel(
  repo: string, stage: AuthoringStage, runner: AuthoringRunner,
  overrides: AuthoringModels = {}, env: NodeJS.ProcessEnv = process.env, probe?: InventoryProbe,
): Promise<AuthoringInvocation> {
  const selection = selectAuthoringModel(repo, stage, overrides, env);
  if (!selection.requestedModel) return { runner, ...selection };
  let inventory = readAuthoringInventory(repo);
  let compatible = inventoryForRunner(inventory, runner);
  const requested = selection.requestedModel;
  const copilotQualified = /^(?:anthropic|openai|google|github-copilot|copilot)\/[^/]+$/.test(requested);
  const matching = () => compatible.find((model) => model.id === requested ||
    (runner === "copilot" && (!requested.includes("/") || copilotQualified) &&
      model.id.split("/").at(-1) === requested.split("/").at(-1)));
  if (!matching() || !fresh(matching()?.last_verified)) {
    inventory = await refreshAuthoringInventory(repo, runner, probe);
    compatible = inventoryForRunner(inventory, runner);
  }
  const model = matching();
  if (!model || !fresh(model.last_verified)) {
    throw new Error(`Explicit ${stage} model "${selection.requestedModel}" is unavailable or unverified for ${runner}; refresh inventory, choose a compatible model, or select inherit.`);
  }
  if (model.capabilities?.tool_calling === false || model.capabilities?.tools === false) {
    throw new Error(`Explicit ${stage} model "${selection.requestedModel}" does not support required authoring tools.`);
  }
  return { runner, ...selection, effectiveModel: runner === "copilot" ? model.id.split("/").at(-1) : model.id, inventoryVerifiedAt: model.last_verified };
}

export function authoringArgv(invocation: AuthoringInvocation, repo: string, message: string, extra: string[] = []): string[] {
  if (extra.some((arg) => arg === "--model" || arg.startsWith("--model=") || /^-m/.test(arg))) {
    throw new Error("Conflicting extra model argument: use --prd-model, --team-model, or --skills-model.");
  }
  const model = invocation.effectiveModel ? ["--model", invocation.effectiveModel] : [];
  return invocation.runner === "copilot"
    ? ["-p", message, "--yolo", ...model, ...extra]
    : ["run", "--auto", "--dir", repo, ...model, ...extra, message];
}
