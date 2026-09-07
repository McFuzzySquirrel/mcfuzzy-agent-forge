import fs from "node:fs";
import path from "node:path";
import { runCommand } from "./format.ts";
import { writeAuthoringJson, selectAuthoringModel, type AuthoringModels, type AuthoringStage, type ModelSource, type RunnerSource } from "./authoring-config.ts";

export type AuthoringRunner = "copilot" | "opencode" | "claude" | "stub";
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
  runnerSource?: RunnerSource;
  requestedModel?: string;
  effectiveModel?: string;
  inventoryVerifiedAt?: string;
  argv?: string[];
  skill?: string;
}
export interface InventoryProbeResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type InventoryProbe = (runner: AuthoringRunner, args: string[], repo: string) => Promise<InventoryProbeResult>;
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

const RUNNER_PROVIDERS: Record<AuthoringRunner, string[]> = {
  copilot: ["copilot_cli", "copilot_subscription"],
  opencode: ["opencode_cli"],
  claude: ["claude_cli"],
  stub: ["stub"],
};

export function inventoryForRunner(inventory: AuthoringInventory, runner: AuthoringRunner): AuthoringInventoryModel[] {
  const providers = RUNNER_PROVIDERS[runner];
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

function parseCopilotMetadataOutput(text: string): string[] {
  const clean = text.replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g, "");
  const tableLines = clean.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const modelListStart = tableLines.findIndex((line) => /^available models(?: include)?:\s*$/i.test(line));
  if (modelListStart >= 0) {
    const ids: string[] = [];
    for (const line of tableLines.slice(modelListStart + 1)) {
      if (/^use `\/model\b/i.test(line)) break;
      const match = line.match(/^[-*]\s+(?:`([^`]+)`|(.+?))(?:\s+\*\*\(current\)\*\*)?$/i);
      const label = (match?.[1] ?? match?.[2])?.trim();
      if (!label) continue;
      // Some CLI versions render friendly names rather than IDs. Convert those
      // labels to the slug accepted by --model (for example, "GPT-5.6 Luna").
      const id = label.toLowerCase().replace(/\([^)]*\)/g, "").trim()
        .replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
      if (id && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(id) && !ids.includes(id)) ids.push(id);
    }
    if (ids.length) return ids;
  }
  const splitTableRow = (line: string): string[] | undefined => {
    if (!/[|│┃]/.test(line)) return undefined;
    return line.split(/[|│┃]/).map((cell) => cell.trim());
  };
  const headerIndex = tableLines.findIndex((line) => {
    const cells = splitTableRow(line);
    return cells?.some((cell) => cell.toLowerCase() === "model") ?? false;
  });
  if (headerIndex >= 0) {
    const headers = splitTableRow(tableLines[headerIndex]) ?? [];
    const modelColumn = headers.findIndex((header) => header.toLowerCase() === "model");
    const ids: string[] = [];
    for (const line of tableLines.slice(headerIndex + 1)) {
      const cells = splitTableRow(line);
      if (!cells || cells.length <= modelColumn || cells.every((cell) => !/[a-z0-9]/i.test(cell))) continue;
      const id = cells[modelColumn]?.replace(/^['"`]|['"`]$/g, "").trim();
      if (!id || /^(?:model|name)$/i.test(id) || /\b(?:unavailable|disabled|not supported)\b/i.test(line)) continue;
      if (/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(id) && !ids.includes(id)) ids.push(id);
    }
    if (ids.length) return ids;
  }

  try {
    const value: unknown = JSON.parse(clean);
    if (record(value) && Array.isArray(value.models)) {
      const ids = value.models.flatMap((model) => {
        if (!record(model)) return [];
        const id = typeof model.id === "string" ? model.id : typeof model.name === "string" ? model.name : "";
        return id ? [id] : [];
      });
      return parseModelInventoryOutput(ids.join("\n"), "copilot");
    }
  } catch {
    // Copilot help is text in current releases; JSON metadata is accepted when exposed.
  }

  // `/model list names only` intentionally omits headings and returns one ID
  // per line. Keep this fallback strict so surrounding CLI diagnostics are not
  // mistaken for model names.
  const namesOnly = parseModelInventoryOutput(clean, "copilot");
  if (namesOnly.length) return namesOnly;

  const lines = clean.split(/\r?\n/);
  const start = lines.findIndex((line) => /^\s*(?:available\s+)?models?\s*:?\s*$/i.test(line));
  if (start < 0) return [];
  const end = lines.slice(start + 1).findIndex((line) => /^\s*[A-Za-z][A-Za-z ]{2,}:\s*$/.test(line));
  const section = lines.slice(start + 1, end < 0 ? undefined : start + 1 + end).join("\n");
  return parseModelInventoryOutput(section, "copilot");
}

/** Claude Code has no models subcommand; its built-in /model command reports the accepted names without a generative call. */
export function parseClaudeModelOutput(text: string): string[] {
  let envelope: unknown;
  try {
    envelope = JSON.parse(text.trim()) as unknown;
  } catch {
    const last = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) ?? "";
    try {
      envelope = JSON.parse(last) as unknown;
    } catch {
      envelope = undefined;
    }
  }
  if (!record(envelope)) throw new Error("claude model discovery returned no JSON result envelope.");
  if (envelope.is_error === true) throw new Error(`claude model discovery failed: ${String(envelope.result ?? "unknown error")}`);
  // Whitespace runs collapse to single spaces so a list wrapped across lines is not truncated.
  const result = (typeof envelope.result === "string" ? envelope.result : "").replace(/\s+/g, " ");
  const marker = "Available:";
  // Every occurrence is tried in order: an earlier incidental "Available:" in
  // the prose must not shadow the real alias list further along.
  for (let start = result.indexOf(marker); start >= 0; start = result.indexOf(marker, start + marker.length)) {
    const sentence = result.slice(start + marker.length)
      .split(", or a full model ID")[0]!
      .split(/\.(?:\s|$)/)[0]!;
    const ids: string[] = [];
    for (const raw of sentence.split(",")) {
      // "default" and "best" resolve differently per account, so they are never stable choices.
      const entry = raw.trim();
      if (!entry || entry === "default" || entry === "best") continue;
      if (!/^[a-z0-9][a-z0-9.\-]*(?:\[[0-9a-z]+\])?$/i.test(entry)) continue;
      if (!ids.includes(entry)) ids.push(entry);
    }
    if (ids.length > 0) return ids;
  }
  return [];
}

const PROBE_ARGS: Record<Exclude<AuthoringRunner, "stub">, string[]> = {
  copilot: ["-p", "/model list names only"],
  opencode: ["models"],
  // --bare skips hooks, plugin sync and auto-memory, which a metadata probe has no use for.
  claude: ["-p", "/model", "--bare", "--output-format", "json"],
};

const defaultProbe: InventoryProbe = (runner, args, repo) => runCommand(runner, args, { cwd: repo, capture: true });

/** Uses runner metadata only; Copilot's model list prompt does not make a generative call. */
export async function refreshAuthoringInventory(repo: string, runner: AuthoringRunner, probe: InventoryProbe = defaultProbe): Promise<AuthoringInventory> {
  if (runner === "stub") return readAuthoringInventory(repo);
  const args = PROBE_ARGS[runner];
  const result = await probe(runner, args, repo);
  if (result.code !== 0) throw new Error(`${runner} model discovery failed (${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
  const ids = runner === "copilot" ? parseCopilotMetadataOutput(`${result.stdout}\n${result.stderr}`)
    : runner === "claude" ? parseClaudeModelOutput(result.stdout)
    : parseModelInventoryOutput(result.stdout, runner);
  if (!ids.length) throw new Error(`${runner} model discovery returned no unambiguous model IDs. Verify docs/research/model-inventory.json from a trusted runner inventory or select inherit.`);
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
  const claudeQualified = /^anthropic\/[^/]+$/.test(requested);
  // Claude inventory IDs carry no provider segment, so only an explicit anthropic/ prefix is stripped.
  const matching = () => compatible.find((model) => model.id === requested ||
    (runner === "copilot" && (!requested.includes("/") || copilotQualified) &&
      model.id.split("/").at(-1) === requested.split("/").at(-1)) ||
    (runner === "claude" && claudeQualified && model.id === requested.split("/").at(-1)));
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
  const effectiveModel = runner === "copilot" || runner === "claude" ? model.id.split("/").at(-1) : model.id;
  return { runner, ...selection, effectiveModel, inventoryVerifiedAt: model.last_verified };
}

export function authoringArgv(invocation: AuthoringInvocation, repo: string, message: string, extra: string[] = []): string[] {
  if (extra.some((arg) => arg === "--model" || arg.startsWith("--model=") || /^-m/.test(arg))) {
    throw new Error("Conflicting extra model argument: use --prd-model, --team-model, or --skills-model.");
  }
  const model = invocation.effectiveModel ? ["--model", invocation.effectiveModel] : [];
  switch (invocation.runner) {
    case "copilot":
      return ["-p", message, "--yolo", ...model, ...extra];
    case "claude":
      return ["-p", message, "--permission-mode", "bypassPermissions", ...model, ...extra];
    default:
      // opencode, and stub which never reaches a real spawn.
      return ["run", "--auto", "--dir", repo, ...model, ...extra, message];
  }
}
