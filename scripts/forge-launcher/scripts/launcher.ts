import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrap, repositoryLogFile } from "./bootstrap.ts";
import { upsertProject } from "./console/paths.ts";
import { command, fail, header, info, link, ok, out, printLogTail, runCommand, runLogged, runWithHeartbeat, spawnDetached, step, warn } from "./format.ts";
import { detectRepoRoot, expandPath, resolveInputFile } from "./paths.ts";
import { prompt, promptMultiline, promptPath, promptPathLoop, promptSelect, promptYesNo, prompts } from "./prompts.ts";
import { launchCliInTerminal } from "./terminal.ts";
import { loadEngineConfig, saveEngineConfig } from "./engine-config.ts";
import { engineRunCli } from "./engine-run.ts";

const nodeRequire = createRequire(import.meta.url);

/**
 * Entry point for re-invoking the CLI (detached engine start). Resolves to the
 * compiled `cli.js` when running from `dist/` and the TypeScript source when
 * running via tsx, so the detached child always starts.
 */
const IS_SOURCE = import.meta.url.endsWith(".ts");
const CLI_ENTRY = fileURLToPath(new URL(IS_SOURCE ? "./cli.ts" : "./cli.js", import.meta.url));

/** Node preload args that bootstrap the tsx loader for a TypeScript CLI entry. */
function cliNodePrefix(): string[] {
  return IS_SOURCE ? ["--import", nodeRequire.resolve("tsx")] : [];
}

/** Builds the detached `forge-launcher engine-run` invocation for the given engine args. */
export function engineDetachedCommand(engineArgs: string[]): { cmd: string; args: string[] } {
  return { cmd: process.execPath, args: [...cliNodePrefix(), CLI_ENTRY, ...engineArgs] };
}

export interface LauncherOptions {
  nonInteractive?: boolean;
  headless?: boolean;
  draft?: boolean;
  dryRun?: boolean;
}

type HarnessName = "github" | "opencode" | "claude" | "agents";

export function defaultEngineHarness(harness: HarnessName): string {
  return harness === "github" ? "copilot" : "opencode";
}

interface LauncherState {
  harness: HarnessName;
  harnessLabel: string;
  repoDir: string;
  remoteCreated: boolean;
  ghAvailable: boolean;
  copilotAvailable: boolean;
  opencodeAvailable: boolean;
  claudeAvailable: boolean;
  prdAdded: boolean;
  researchAdded: boolean;
  engineStarted: boolean;
  engineConfig: {
    harness: string;
    granularity: string;
    concurrency: string;
    taskTimeoutMs: string;
    maxRetries: string;
    viz: boolean;
    vizPort: string;
    keepAlive: boolean;
    attach: string;
    autoCommit: boolean;
    executionMode: "auto" | "manual";
    selectionScope?: "single" | "range" | "list";
    selectedTaskIds: string[];
  };
}

const state: LauncherState = {
  harness: "agents",
  harnessLabel: "Generic .agents",
  repoDir: "",
  remoteCreated: false,
  ghAvailable: false,
  copilotAvailable: false,
  opencodeAvailable: false,
  claudeAvailable: false,
  prdAdded: false,
  researchAdded: false,
  engineStarted: false,
  engineConfig: {
    harness: process.env.FORGE_ENGINE_HARNESS ?? "opencode",
    granularity: process.env.FORGE_ENGINE_GRANULARITY ?? "",
    concurrency: process.env.FORGE_ENGINE_CONCURRENCY ?? "",
    taskTimeoutMs: process.env.FORGE_ENGINE_TASK_TIMEOUT_MS ?? "",
    maxRetries: process.env.FORGE_ENGINE_MAX_RETRIES ?? "",
    viz: envFlag("FORGE_ENGINE_VIZ"),
    vizPort: process.env.FORGE_ENGINE_VIZ_PORT ?? "",
    keepAlive: envFlag("FORGE_ENGINE_ATTACH"),
    attach: process.env.FORGE_ENGINE_ATTACH_URL ?? "",
    autoCommit: process.env.FORGE_ENGINE_AUTO_COMMIT !== "0",
    executionMode: "auto",
    selectionScope: undefined,
    selectedTaskIds: [],
  },
};

/** Single tee-log for all long-running step output during this launcher run. */
function runLogFile(repoDir = state.repoDir): string {
  return repositoryLogFile(repoDir);
}

/** Append a machine-readable authoring lifecycle record to the same stream as
 * process output. Consumers must ignore ordinary lines, preserving plain log
 * streaming for terminals and older Console clients. */
function authoringEvent(type: string, data: Record<string, unknown> = {}): void {
  const record = { type, timestamp: new Date().toISOString(), ...data };
  fs.mkdirSync(path.dirname(runLogFile()), { recursive: true });
  const encoded = `${JSON.stringify(record)}\n`;
  // Keep the human/process log and its FORGE_EVENT compatibility prefix, while
  // giving consumers a lossless structured stream that does not need log parsing.
  fs.appendFileSync(runLogFile(), `FORGE_EVENT ${encoded}`, "utf8");
  fs.appendFileSync(path.join(path.dirname(runLogFile()), "AUTHORING-EVENTS.jsonl"), encoded, "utf8");
}

function runLoggedStep(
  label: string,
  cmd: string,
  args: string[],
  opts: { cwd?: string; dryRun?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  const logFile = runLogFile();
  return runWithHeartbeat(
    label,
    async () => {
      const res = await runLogged(cmd, args, { cwd: opts.cwd, logFile, env: opts.env });
      if (res.code !== 0) printLogTail(logFile);
      return res.code;
    },
    { dryRun: opts.dryRun },
  );
}

function envFlag(name: string): boolean {
  return process.env[name] === "1";
}

/** Returns the env flag when the variable is set, else undefined (unset). */
function envFlagOrUndefined(name: string): boolean | undefined {
  return process.env[name] !== undefined ? process.env[name] === "1" : undefined;
}

function hasPrd(): boolean {
  return (
    state.prdAdded ||
    fs.existsSync(path.join(state.repoDir, "docs", "PRD.md")) ||
    fs.existsSync(path.join(state.repoDir, "docs", "product-vision.md"))
  );
}

function harnessAgentsDir(): string {
  return path.join(state.repoDir, harnessRootDir(), "agents");
}

function harnessSkillsDir(): string {
  return path.join(state.repoDir, harnessRootDir(), "skills");
}

function harnessRootDir(): string {
  switch (state.harness) {
    case "github": return ".github";
    case "claude": return ".claude";
    case "opencode": return ".opencode";
    default: return ".agents";
  }
}

function skillPathFor(skillName: string): string {
  return path.join(state.repoDir, harnessRootDir(), "skills", skillName, "SKILL.md");
}

/** Locates the bootstrapped forge-workflow-engine package dir (any harness root). */
function findEngineDir(repoDir: string): string | null {
  for (const root of [".agents", ".opencode", ".claude", ".github"]) {
    const candidate = path.join(repoDir, root, "skills", "forge-workflow-engine");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findAdapterDir(repoDir: string): string | null {
  for (const root of [".agents", ".opencode", ".claude", ".github"]) {
    const candidate = path.join(repoDir, root, "skills", "forge-execution-adapter");
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function debugMode(): boolean {
  return process.env.FORGE_LAUNCHER_DEBUG === "1";
}

function hasGeneratedTeam(): boolean {
  const agentsDir = harnessAgentsDir();
  if (!fs.existsSync(agentsDir)) return false;
  const excluded = new Set(["forge-team-builder.md", "project-orchestrator.md", "workflow-orchestrator.md"]);
  return fs
    .readdirSync(agentsDir)
    .filter((f) => f.endsWith(".md") && !excluded.has(f)).length > 0;
}

const FORGE_TEMPLATE_AGENTS = new Set(["forge-team-builder.md", "project-orchestrator.md", "workflow-orchestrator.md"]);
const FEATURE_INCREMENT_ALLOWED_OUTPUTS = new Set([
  "docs/EXECUTION-MANIFEST.json",
  "docs/agent-responsibility-matrix.md",
]);

/**
 * Filesystem snapshot used by feature-increment team generation.  This is
 * deliberately a snapshot of the repository rather than git state: a caller
 * may have uncommitted work, and the guard must not mistake that work for the
 * result of the skill. Forge skills are excluded because team generation is
 * allowed to refresh them, while template agents are excluded because they
 * are bootstrap-owned rather than project-owned agents.
 */
export type FeatureIncrementSnapshot = Map<string, string>;

function walkSnapshotFiles(dir: string, root: string, out: FeatureIncrementSnapshot): void {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return;
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const relative = path.relative(root, full);
    if (relative === ".git" || relative.startsWith(`.git${path.sep}`)) continue;
    const relativePosix = relative.split(path.sep).join("/");
    // The launcher appends its own diagnostic stream while the skill runs; it
    // is not a project change and must not make a valid team update fail.
    if (relativePosix === "docs/engine-run.log") continue;
    const forgeSkillsPrefix = `${harnessRootDir()}/skills/`;
    const projectAgentsPrefix = `${harnessRootDir()}/agents/`;
    // Only the selected harness's Forge skills are excluded. A project's own
    // src/skills (or another harness root) remains visible to the guard.
    if (relativePosix.startsWith(forgeSkillsPrefix)) continue;
    if (relativePosix.startsWith(projectAgentsPrefix) && FORGE_TEMPLATE_AGENTS.has(entry)) continue;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walkSnapshotFiles(full, root, out);
    else if (stat.isFile()) out.set(relativePosix, fs.readFileSync(full, "utf8"));
  }
}

/** Snapshot all non-Forge-owned files before a feature team update. */
export function snapshotFeatureIncrementFiles(repoDir: string): FeatureIncrementSnapshot {
  const snapshot: FeatureIncrementSnapshot = new Map();
  walkSnapshotFiles(repoDir, repoDir, snapshot);
  return snapshot;
}

export interface FeatureIncrementFileChanges {
  addedAgents: string[];
  modifiedAgents: string[];
  deletedAgents: string[];
  updatedOutputs: string[];
  unrelatedFiles: string[];
}

type FeatureIncrementManifest = {
  phases?: Array<{
    tasks?: Array<Record<string, unknown> & { id?: string }>;
  }>;
};

function additiveManifestUpdateOnly(beforeText: string, afterText: string): boolean {
  try {
    const before = JSON.parse(beforeText) as FeatureIncrementManifest;
    const after = JSON.parse(afterText) as FeatureIncrementManifest;
    const beforeTasks = new Map(
      (before.phases ?? []).flatMap((phase) => (phase.tasks ?? []).flatMap((task) => task.id ? [[task.id, JSON.stringify(task)] as const] : [])),
    );
    const afterTasks = new Map(
      (after.phases ?? []).flatMap((phase) => (phase.tasks ?? []).flatMap((task) => task.id ? [[task.id, JSON.stringify(task)] as const] : [])),
    );
    for (const [id, task] of beforeTasks) {
      if (!afterTasks.has(id)) return false;
      if (afterTasks.get(id) !== task) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Compare a feature-increment snapshot, allowing only project-agent changes. */
export function compareFeatureIncrementFiles(
  before: FeatureIncrementSnapshot,
  repoDir: string,
): FeatureIncrementFileChanges {
  const after = snapshotFeatureIncrementFiles(repoDir);
  const changed = new Set([...before.keys(), ...after.keys()]);
  const result: FeatureIncrementFileChanges = { addedAgents: [], modifiedAgents: [], deletedAgents: [], updatedOutputs: [], unrelatedFiles: [] };
  for (const file of [...changed].sort()) {
    const oldValue = before.get(file);
    const newValue = after.get(file);
    if (oldValue === newValue) continue;
    const isAgent = file.startsWith(`${harnessRootDir()}/agents/`) && file.endsWith(".md");
    if (isAgent && oldValue === undefined) {
      result.addedAgents.push(file);
      continue;
    }
    if (isAgent && newValue === undefined) {
      // Feature increments must preserve untouched agents; deletion is never
      // an intended update, even though the file is project-owned.
      result.deletedAgents.push(file);
      continue;
    }
    if (isAgent) {
      result.modifiedAgents.push(file);
      continue;
    }
    if (!FEATURE_INCREMENT_ALLOWED_OUTPUTS.has(file)) {
      result.unrelatedFiles.push(file);
      continue;
    }
    if (newValue === undefined) {
      result.unrelatedFiles.push(file);
      continue;
    }
    if (file === "docs/EXECUTION-MANIFEST.json" && oldValue !== undefined && !additiveManifestUpdateOnly(oldValue, newValue)) {
      result.unrelatedFiles.push(file);
    } else {
      result.updatedOutputs.push(file);
    }
  }
  return result;
}

function validateFeatureIncrementFiles(before: FeatureIncrementSnapshot): boolean {
  const changes = compareFeatureIncrementFiles(before, state.repoDir);
  const unexpected = [...changes.deletedAgents, ...changes.unrelatedFiles];
  if (unexpected.length === 0) {
    if (changes.addedAgents.length || changes.modifiedAgents.length || changes.updatedOutputs.length) {
      info(`Feature increment preserved project agents; changed ${changes.addedAgents.length + changes.modifiedAgents.length} agent file(s) and refreshed ${changes.updatedOutputs.length} generated output(s).`);
    }
    return true;
  }
  fail("Feature increment changed files outside its intended project-agent update:");
  for (const file of unexpected) out(`    - ${file}`);
  warn("No team-update commit was created. Review and revert the unexpected changes before retrying.");
  return false;
}

function prdSourceForTeam(): string {
  if (
    fs.existsSync(path.join(state.repoDir, "docs", "product-vision.md")) &&
    fs.existsSync(path.join(state.repoDir, "docs", "features"))
  ) {
    const features = fs.readdirSync(path.join(state.repoDir, "docs", "features")).filter((f) => f.endsWith(".md"));
    if (features.length) {
      return "the decomposed PRD representation (docs/product-vision.md + docs/features/*.md)";
    }
  }
  return "docs/PRD.md";
}

export function buildTeamPrompt(prdSource: string, harness: HarnessName): string {
  const harnessRoot = harness === "github"
    ? ".github"
    : harness === "claude"
      ? ".claude"
      : harness === "opencode"
        ? ".opencode"
        : ".agents";
  return `/forge-build-agent-team Use ${prdSource} to build the agent team. ` +
    `Write agent files under ${harnessRoot}/agents/ and skill files under ${harnessRoot}/skills/.`;
}

// --- auto-build command selection ------------------------------------------

/** Headless PRD-creation invocation: auto-proceed with defaults, then run the
 * same PRD gap check the manual flow does (acceptance criteria, tech stack,
 * non-functional requirements, phases) and fill any gaps before approving. */
const PRD_HEADLESS_MSG =
  "Use docs/IDEA.md as the project idea. Headless mode: auto-proceed with default assumptions and approve the PRD. After drafting, run a PRD gap check: every major component must have clear acceptance criteria, a defined tech stack, non-functional requirements (performance, security, privacy), and implementation phases; fill any gaps before approving.";

const EXISTING_PROJECT_PRD_MSG =
  "Author the project's PRD using forge-build-prd authoring semantics, not an auto-build or implementation workflow. This is an existing repository: inspect source code, documentation, tests, package manifests, configuration, and git history as context; infer the product purpose and current capabilities. Produce docs/PRD.md as a project PRD. Headless mode: ask no questions and use explicit assumptions. Include functional requirements with acceptance criteria, technology stack, non-functional requirements (performance, security, privacy), constraints, and implementation phases. Do not implement code, generate agents, compile a manifest, or run the workflow.";

/**
 * In-harness command to queue when the launcher opens the CLI (or prints
 * next steps). Conditional on the team so the harness entry honours the
 * "in the harness = project-orchestrator" rule when possible:
 *   - team exists    → /forge-orchestrate-build (project-orchestrator)
 *   - PRD, no team   → /forge-auto-build (generates the team in-chat first)
 *   - no PRD         → /forge-auto-build-prd (idea → PRD)
 */
function autobuildCommand(): string {
  if (!hasPrd()) return "/forge-auto-build-prd Use docs/IDEA.md as the project idea";
  if (hasGeneratedTeam()) return "/forge-orchestrate-build Use docs/PRD.md as the project PRD";
  return "/forge-auto-build Use docs/PRD.md as the project PRD";
}

/** Headless (terminal-driven) skill invocation - no chat session, so it keeps
 *  using forge-auto-build as the launcher-driven fast-path rather than the
 *  in-harness orchestrators. */
export function headlessSkillMsg(): string {
  if (hasPrd()) {
    if (envFlag("FORGE_WORKFLOW_ENGINE")) {
      return "/forge-auto-build Use docs/PRD.md as the project PRD. GO --workflow-engine";
    }
    return "/forge-auto-build Use docs/PRD.md as the project PRD. GO";
  }
  return `/forge-auto-build-prd ${PRD_HEADLESS_MSG}`;
}

function headlessRunner(): string {
  const runner = process.env.FORGE_RUN_WITH;
  if (runner) return runner;
  return state.harness === "github" ? "copilot" : "opencode";
}

function headlessCmdFor(msg: string): string {
  const runner = headlessRunner();
  if (runner === "copilot") return `copilot -p "${msg}" --yolo`;
  if (runner === "stub") return `stub (writes canned artifacts)`;
  return `opencode run --auto --dir "${state.repoDir}" "${msg}"`;
}

/** Extracts the skill name from a skill invocation message ("/name rest…"). */
function skillNameFromMsg(msg: string): string {
  const first = msg.trim().split(/\s+/)[0] ?? "";
  return first.replace(/^\/+/, "");
}

/**
 * Runs a skill invocation headlessly. Returns true when the skill was found and
 * executed (exit 0), false when the skill file is missing from the harness dir.
 * Sets FORGE_HEADLESS=1 for the child so the forge skills' headless gate fires
 * deterministically. Honors FORGE_RUN_WITH=stub for offline testing.
 */
async function runSkillHeadless(msg: string, opts: LauncherOptions): Promise<boolean> {
  const cmdStr = headlessCmdFor(msg);
  command(cmdStr);
  if (opts.dryRun) {
    warn("Dry-run: command printed, not executed.");
    return true;
  }

  const skillName = skillNameFromMsg(msg);
  if (skillName && !fs.existsSync(skillPathFor(skillName))) {
    warn(`Skill not found: ${skillPathFor(skillName)}`);
    warn("The repo may not have been bootstrapped for this harness, or the skill was renamed.");
    out(`    Run it manually instead: ${cmdStr}`);
    return false;
  }

  const runner = headlessRunner();
  if (runner === "stub") {
    return runStubSkill(msg, opts);
  }

  const args = runner === "copilot"
    ? ["-p", msg, "--yolo"]
    : debugMode()
      ? ["run", "--auto", "--dir", state.repoDir, "--print-logs", msg]
      : ["run", "--auto", "--dir", state.repoDir, msg];
  const code = await runLoggedStep("Running the skill (may take a while)", runner, args, {
    cwd: state.repoDir,
    dryRun: opts.dryRun,
    env: { FORGE_HEADLESS: "1" },
  });
  if (code !== 0) throw new Error(`Skill runner exited with code ${code}`);
  if (debugMode()) printLogTail(runLogFile(), 40);
  return true;
}

/**
 * Offline skill runner used by tests (FORGE_RUN_WITH=stub). Writes the artifact
 * a real skill would produce so the auto-draft success/failure paths are
 * testable without a model. FORGE_STUB_NOOP=1 writes nothing (failure path).
 */
async function runStubSkill(msg: string, opts: LauncherOptions): Promise<boolean> {
  if (opts.dryRun) {
    warn("Dry-run: stub would write its canned artifact.");
    return true;
  }
  const logFile = runLogFile();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const noop = process.env.FORGE_STUB_NOOP === "1";
  const skillName = skillNameFromMsg(msg);

  fs.appendFileSync(logFile, `[stub] invoking ${skillName}${noop ? " (noop)" : ""}\n`);

  if (noop) return true;

  if (skillName.includes("forge-auto-build-prd") || skillName.includes("forge-build-prd")) {
    const prd = path.join(state.repoDir, "docs", "PRD.md");
    fs.mkdirSync(path.dirname(prd), { recursive: true });
    fs.writeFileSync(prd, [
      "# PRD",
      "",
      "> Auto-drafted by the forge-launcher stub skill runner (FORGE_RUN_WITH=stub).",
      "",
      "## Overview",
      "Stub PRD for testing the auto-draft flow.",
      "",
      "## Functional Requirements",
      "- FR-1: stub requirement",
      "",
      "## Implementation Phases",
      "- Phase 1: stub",
      "",
      "## Acceptance Criteria",
      "- AC-1: stub",
      "",
    ].join("\n"));
    fs.appendFileSync(logFile, "[stub] wrote docs/PRD.md\n");
    return true;
  }

  if (skillName.includes("forge-build-agent-team")) {
    const agentFile = path.join(harnessAgentsDir(), "stub-project-agent.md");
    fs.mkdirSync(path.dirname(agentFile), { recursive: true });
    fs.writeFileSync(agentFile, [
      "---",
      "name: stub-project-agent",
      "description: Stub project agent generated by the forge-launcher stub skill runner.",
      "---",
      "# Stub Project Agent",
      "",
      "Generated for testing the auto-draft team flow.",
      "",
    ].join("\n"));
    fs.appendFileSync(logFile, `[stub] wrote ${agentFile}\n`);
    return true;
  }

  if (skillName.includes("forge-build-feature-prd")) {
    const feature = path.join(state.repoDir, "docs", "features", "stub-feature.md");
    fs.mkdirSync(path.dirname(feature), { recursive: true });
    fs.writeFileSync(feature, "# Stub Feature\n\n## Functional Requirements\n- FR-1: implement the stub feature.\n");
    fs.appendFileSync(logFile, `[stub] wrote ${feature}\n`);
    return true;
  }

  if (skillName.includes("forge-orchestrate-build")) {
    const progress = path.join(state.repoDir, "docs", "PROGRESS.md");
    fs.mkdirSync(path.dirname(progress), { recursive: true });
    fs.writeFileSync(progress, [
      "# Project Progress",
      "",
      "> Auto-drafted execution plan by the forge-launcher stub skill runner.",
      "",
      "## Phase 1: stub",
      "- [ ] Task 1: stub",
      "",
    ].join("\n"));
    fs.appendFileSync(logFile, "[stub] wrote docs/PROGRESS.md\n");
    return true;
  }

  fs.appendFileSync(logFile, `[stub] no canned artifact for ${skillName}\n`);
  return true;
}

// --- auto-draft flow -------------------------------------------------------

async function draftCommit(message: string): Promise<void> {
  await runCommand("git", ["-C", state.repoDir, "add", "."]);
  const diff = await runCommand("git", ["-C", state.repoDir, "diff", "--cached", "--quiet", "--", "."], { capture: true });
  if (diff.code === 0) {
    warn("No changes to commit after auto-draft.");
    return;
  }
  await runCommand("git", ["-C", state.repoDir, "commit", "-m", message]);
  ok(`Committed: '${message}'`);
}

// --- stop-here-and-resume-later checkpoints ---------------------------------

/** Set when the user chooses "stop here and resume later" at a checkpoint. */
let stopped = false;

/**
 * Interactive "stop here and resume later" checkpoint. When the user chooses to
 * stop, prints the resume command so the run can be picked up later with
 * `forge-launcher resume`. No-op in non-interactive / dry-run mode.
 */
async function pauseForResume(opts: LauncherOptions, stage: string): Promise<void> {
  if (opts.nonInteractive || opts.dryRun) return;
  const answer = await promptYesNo(`Stop here and resume later (after ${stage})?`, "n");
  if (answer !== "y") return;
  stopped = true;
  out("");
  info("Stopped. Resume later from anywhere with:");
  command(`forge-launcher resume --repo "${state.repoDir}"`);
  out("");
}

// --- post-team plan & validate step (playbook 5a) ----------------------------

/** True when the repo uses the decomposed vision + features layout. */
function hasDecomposedLayout(): boolean {
  return (
    fs.existsSync(path.join(state.repoDir, "docs", "product-vision.md")) &&
    fs.existsSync(path.join(state.repoDir, "docs", "features")) &&
    fs.readdirSync(path.join(state.repoDir, "docs", "features")).some((f) => f.endsWith(".md"))
  );
}

const PLAN_MONOLITHIC_MSG =
  "Analyze docs/PRD.md and produce an execution plan only. Do not implement anything yet. " +
  "List each phase, the agents involved, their tasks, and the dependencies between phases. " +
  "Save the plan to docs/PROGRESS.md. Headless mode: auto-proceed and stop after saving the plan.";

const PLAN_FEATURES_MSG =
  "Analyze docs/product-vision.md and all feature documents in docs/features/. " +
  "Build a feature dependency graph and produce an execution plan showing which features will be " +
  "built in which order and why. Save the plan to docs/PROGRESS.md. Do not implement anything yet. " +
  "Headless mode: auto-proceed and stop after saving the plan.";

/** Offers to open the harness CLI to run project-orchestrator's plan step manually. */
async function offerPlanManualRun(opts: LauncherOptions): Promise<void> {
  const manual = "Run it manually in the harness: @project-orchestrator Analyze docs/PRD.md and produce an execution plan only. Save the plan to docs/PROGRESS.md.";
  if (opts.nonInteractive) {
    out(`    ${manual}`);
    return;
  }
  const answer = await promptYesNo("Open the harness CLI to run project-orchestrator manually?", "n");
  if (answer === "n") {
    info("To run it manually:");
    out(`    cd "${state.repoDir}"`);
    out(`    ${manual}`);
    return;
  }
  const cli = state.harness === "github" ? "copilot" : state.harness === "claude" ? "claude" : "opencode";
  const launched = await launchCliInTerminal(cli, state.repoDir, state.harness === "github" ? [] : ["."]);
  if (launched) ok(`${cli} launched. Run @project-orchestrator in the session.`);
  else {
    warn(`${cli} did not open automatically. Run:`);
    out(`    cd "${state.repoDir}" && ${cli} .`);
  }
}

/**
 * Post-team "plan & validate" step (prompt-playbook 5a). Runs project-orchestrator
 * through the forge-orchestrate-build skill headlessly to produce the execution
 * plan in docs/PROGRESS.md, commits it, and stops for review before the build.
 * Falls back to the manual @project-orchestrator command when the headless run
 * fails or produces no plan document.
 */
async function planAndValidateStep(opts: LauncherOptions): Promise<void> {
  const skill = "forge-orchestrate-build";
  const planMsg = hasDecomposedLayout() ? PLAN_FEATURES_MSG : PLAN_MONOLITHIC_MSG;

  if (opts.nonInteractive) {
    if (!envFlag("FORGE_AUTO_DRAFT")) return;
  } else {
    const def = opts.draft ? "y" : "n";
    const answer = await promptYesNo(
      "Generate the execution plan now (project-orchestrator, headless; saved to docs/PROGRESS.md)?",
      def,
    );
    if (answer === "n") return;
  }

  out("");
  info("Generating the execution plan via project-orchestrator (headless) …");
  const ran = await runSkillHeadless(`/${skill} ${planMsg}`, opts);
  if (!ran) {
    await offerPlanManualRun(opts);
    return;
  }
  await draftCommit("docs: add execution plan");

  if (fs.existsSync(path.join(state.repoDir, "docs", "PROGRESS.md"))) {
    ok("Execution plan saved to docs/PROGRESS.md.");
    out("");
    out("  Review the plan before building:");
    out(`    - ${link(path.join(state.repoDir, "docs", "PROGRESS.md"))}`);
    await pauseForResume(opts, "execution plan drafted");
  } else {
    warn("No execution plan document detected after the run.");
    await offerPlanManualRun(opts);
  }
}

/** Prints diagnostics when an auto-draft stage finishes without its artifact. */
async function diagnoseAutoDraftFail(skillName: string): Promise<void> {
  warn(`The auto-draft did not produce the expected artifact for '${skillName}'.`);
  out("");
  printLogTail(runLogFile(), 30);
  out("");
  info("What the repo contains right now:");
  const st = await runCommand("git", ["-C", state.repoDir, "status", "--short"], { capture: true });
  if (st.code === 0 && st.stdout.trim()) {
    out("  " + st.stdout.trim().replace(/\n/g, "\n  "));
  } else {
    out("  (no changes)");
  }
  const skillPath = skillPathFor(skillName);
  out("");
  if (fs.existsSync(skillPath)) {
    info(`Skill present: ${skillPath}`);
  } else {
    warn(`Skill NOT found: ${skillPath}`);
  }
}

/** Offers to run the failed skill interactively (or prints the command). */
async function offerManualRun(skillName: string, opts: LauncherOptions): Promise<void> {
  if (opts.nonInteractive) {
    out(`    Run it manually in the repo: /${skillName} Use docs/IDEA.md as the project idea`);
    return;
  }
  const answer = await promptYesNo(`Open the harness CLI now to run /${skillName} manually?`, "n");
  if (answer === "n") {
    info("To run it manually:");
    out(`    cd "${state.repoDir}"`);
    out(`    Then run: /${skillName} Use docs/IDEA.md as the project idea`);
    return;
  }
  const cli = state.harness === "github" ? "copilot" : state.harness === "claude" ? "claude" : "opencode";
  const launched = await launchCliInTerminal(cli, state.repoDir, state.harness === "github" ? [] : ["."]);
  if (launched) ok(`${cli} launched. Run /${skillName} in the session.`);
  else {
    warn(`${cli} did not open automatically. Run:`);
    out(`    cd "${state.repoDir}" && ${cli} .`);
  }
}

async function autoDraftPrd(opts: LauncherOptions): Promise<void> {
  if (hasPrd()) return;
  if (opts.nonInteractive) {
    if (!envFlag("FORGE_AUTO_DRAFT")) return;
  } else {
    const def = opts.draft ? "y" : "n";
    const answer = await promptYesNo(
      "Generate the PRD from docs/IDEA.md automatically now (headless, auto-proceed with best answers)?",
      def,
    );
    if (answer === "n") return;
  }

  out("");
  info("Auto-drafting the PRD from docs/IDEA.md (headless) …");
  const skill = "forge-auto-build-prd";
  const ran = await runSkillHeadless(
    `/${skill} ${PRD_HEADLESS_MSG}`,
    opts,
  );
  if (!ran) return;
  await draftCommit("docs: add auto-drafted PRD");

  if (hasPrd()) {
    state.prdAdded = true;
    ok("PRD generated.");
    out("");
    out("  Review it before continuing:");
    out(`    - ${link(path.join(state.repoDir, "docs", "PRD.md"))}`);
    if (fs.existsSync(path.join(state.repoDir, "docs", "product-vision.md"))) {
      out("    - " + link(path.join(state.repoDir, "docs", "product-vision.md")) + " (decomposed) + docs/features/*.md");
    } else {
      out("    - docs/PRD.md is monolithic (no decomposition)");
    }
    await pauseForResume(opts, "PRD drafted");
  } else {
    await diagnoseAutoDraftFail(skill);
    await offerManualRun(skill, opts);
  }
}

function engineRunArgs(): string[] {
  const args = ["engine-run", "--repo", state.repoDir];
  const cfg = state.engineConfig;
  if (cfg.harness) args.push("--harness", cfg.harness);
  if (cfg.granularity) args.push("--granularity", cfg.granularity);
  if (cfg.concurrency) args.push("--concurrency", cfg.concurrency);
  if (cfg.taskTimeoutMs) args.push("--task-timeout-ms", cfg.taskTimeoutMs);
  if (cfg.maxRetries) args.push("--max-retries", cfg.maxRetries);
  if (cfg.viz) {
    args.push("--viz");
    if (cfg.vizPort) args.push("--viz-port", cfg.vizPort);
  }
  if (cfg.keepAlive) args.push("--keep-alive");
  if (cfg.attach) args.push("--attach", cfg.attach);
  if (cfg.autoCommit === false) args.push("--no-auto-commit");
  if (cfg.executionMode === "manual") {
    args.push("--execution-mode", "manual");
    if (cfg.selectionScope) args.push("--selection-scope", cfg.selectionScope);
    if (cfg.selectedTaskIds.length > 0) args.push("--selected-tasks", cfg.selectedTaskIds.join(","));
  }
  args.push("--yes");
  return args;
}

function printEngineCommand(): void {
  command(`npx forge-launcher ${engineRunArgs().join(" ")}`);
  out("");
  info("Run it from anywhere later to execute the build through the workflow engine.");
}

/** Coerce a numeric prompt to a positive integer, falling back on garbage/empty. */
function cleanPositiveInt(value: string, fallback: string): string {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? String(n) : fallback;
}

/**
 * Interactive engine configuration (task granularity, parallelism, timeout,
 * retries, harness). Always shown after choosing run/print; Esc/Ctrl+C keeps
 * the current defaults. Non-interactive runs use env vars only.
 */
async function configureEngineOptions(opts: LauncherOptions): Promise<void> {
  if (opts.nonInteractive) return;
  out("");
  step("Configure the workflow engine");
  info("Press Enter to accept the default for each option (Esc/Ctrl+C keeps defaults).");
  const cfg = state.engineConfig;
  try {
    cfg.harness = await promptSelect(
      "Per-task harness",
      [
        { value: "opencode", label: "opencode", hint: "default" },
        { value: "copilot", label: "copilot" },
        { value: "openai", label: "openai" },
        { value: "stub", label: "stub (offline testing)" },
        { value: "flowforge-kernel", label: "flowforge-kernel" },
      ],
      { initial: cfg.harness || "opencode" },
    );

    cfg.granularity = await promptSelect(
      "Task granularity",
      [
        { value: "fine", label: "fine", hint: "default: sub-bullets + oversized-bullet splits" },
        { value: "coarse", label: "coarse: one task per PRD bullet" },
      ],
      { initial: cfg.granularity || "fine" },
    );

    cfg.concurrency = cleanPositiveInt(
      await prompt("Max agents to run in parallel (1 = sequential)", cfg.concurrency || "1"),
      cfg.concurrency || "1",
    );
    cfg.taskTimeoutMs = cleanPositiveInt(
      await prompt("Per-task timeout (ms)", cfg.taskTimeoutMs || "600000"),
      cfg.taskTimeoutMs || "600000",
    );
    cfg.maxRetries = cleanPositiveInt(
      await prompt("Max retries per task", cfg.maxRetries || "2"),
      cfg.maxRetries || "2",
    );

    const vizAnswer = await promptYesNo(
      "Launch the live Forge Board dashboard during the run?",
      cfg.viz ? "y" : "y",
    );
    cfg.viz = vizAnswer === "y";
    if (cfg.viz) {
      cfg.vizPort = cleanPositiveInt(
        await prompt("Dashboard port (blank = 4299)", cfg.vizPort || "4299"),
        cfg.vizPort || "",
      );
    }

    const autoCommitAnswer = await promptYesNo(
      "Auto-commit after each completed task?",
      cfg.autoCommit ? "y" : "y",
    );
    cfg.autoCommit = autoCommitAnswer === "y";
  } catch {
    info("Engine options cancelled; using the current defaults.");
  }
  // Persist the chosen options so `forge-launcher resume` (and future runs) can
  // rebuild the engine command with the same settings instead of the minimal
  // `--harness`-only invocation.
  saveEngineConfig(state.repoDir, state.engineConfig);
}

async function stopEngine(_opts: LauncherOptions): Promise<void> {
  const engineDir = findEngineDir(state.repoDir);
  if (!engineDir) {
    warn("forge-workflow-engine not found under the repo; cannot stop the engine from here.");
    warn(`Stop it manually: write {"request":"stop"} to ${path.join(state.repoDir, "docs", "engine-control.json")} and SIGTERM the engine process.`);
    return;
  }
  info("Requesting a graceful stop after the current task …");
  const result = await runCommand("npm", ["run", "workflow-engine", "--", "stop", "--repo", state.repoDir], { cwd: engineDir });
  if (result.code !== 0) {
    warn("The engine stop command did not exit cleanly; the control file may still be honored on its next wave.");
  } else {
    info("Stop requested. The engine saves state as paused after the current task; resume with the command below.");
    command(`npx forge-launcher ${engineRunArgs().join(" ")}`);
  }
}

async function runEngineDetached(opts: LauncherOptions): Promise<void> {
  if (opts.dryRun) {
    warn("Dry-run: would start the engine detached:");
    printEngineCommand();
    return;
  }
  if (!hasPrd()) {
    warn("No PRD found yet (docs/PRD.md or docs/product-vision.md).");
    warn("The engine compiles the manifest from the PRD, so the detached run will");
    warn("fail at the compile step until a PRD exists. Generate one with forge-auto-build-prd first.");
    out("");
  }
  const logDir = path.join(state.repoDir, "docs");
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, "engine-run.log");
  const { cmd, args } = engineDetachedCommand(engineRunArgs());
  spawnDetached(cmd, args, {
    cwd: state.repoDir,
    logFile,
    outFile: logFile,
  });
  state.engineStarted = true;
  ok(`Engine started detached. Log: ${logFile}`);
  out("");
  info("The engine runs in the background, even after this launcher exits.");
  info("Monitor progress from another terminal with:");
  command(`tail -f ${logFile}`);
  command(`tail -f ${path.join(state.repoDir, "docs", "PROGRESS.md")}`);
  if (state.engineConfig.viz) {
    out("");
    info("The Forge Board dashboard starts when the engine starts");
    info("(after the manifest is prepared). The URL is printed to the log above.");
  }
}

async function engineDecision(opts: LauncherOptions): Promise<void> {
  out("");
  out("  The agent team is ready. You can run the build now through the");
  out("  workflow engine, run it later, or build manually.");
  out("");
  if (opts.nonInteractive) {
    if (!envFlag("FORGE_AUTO_DRAFT")) return;
    printEngineCommand();
    return;
  }
  out("");
  const choice = await promptSelect(
    "How do you want to run the build?",
    [
      { value: "1", label: "Run the workflow-engine build now (detached)" },
      { value: "2", label: "Print the engine command to run later", hint: "default" },
      { value: "3", label: "Skip - I will launch the CLI / build manually" },
    ],
    { initial: "2", nonInteractiveValue: "2" },
  );
  switch (choice) {
    case "1": await configureEngineOptions(opts); await runEngineDetached(opts); break;
    case "2": await configureEngineOptions(opts); printEngineCommand(); await pauseForResume(opts, "build configured"); break;
    default:
      info("Skipping the engine for now. Run the build manually or use the printed command later.");
      await pauseForResume(opts, "build configured");
  }
}

async function autoDraftTeam(opts: LauncherOptions): Promise<void> {
  if (!hasPrd()) return;
  if (opts.nonInteractive) {
    if (!envFlag("FORGE_AUTO_DRAFT")) return;
  } else {
    const def = opts.draft ? "y" : "n";
    const answer = await promptYesNo(
      "Generate the agent team from the PRD automatically now (headless)?",
      def,
    );
    if (answer === "n") return;
  }

  out("");
  info("Auto-drafting the agent team from the PRD (headless) …");
  const prdSource = prdSourceForTeam();
  const skill = "forge-build-agent-team";
  const ran = await runSkillHeadless(
    `${buildTeamPrompt(prdSource, state.harness)} Auto-proceed with default assumptions and no questions.`,
    opts,
  );
  if (!ran) return;
  await draftCommit("feat: generate auto-drafted agent team");

  if (hasGeneratedTeam()) {
    ok("Agent team generated.");
    out("");
    out("  Review the generated team before building:");
    out(`    - Agents : ${link(harnessAgentsDir() + "/")}`);
    out(`    - Skills : ${link(harnessSkillsDir() + "/")}`);
    await pauseForResume(opts, "team generated");
    if (stopped) return;
    await planAndValidateStep(opts);
    if (stopped) return;
  } else {
    await diagnoseAutoDraftFail(skill);
  }
  await engineDecision(opts);
}

async function autoDraftMenu(opts: LauncherOptions): Promise<void> {
  if (!fs.existsSync(path.join(state.repoDir, "docs", "IDEA.md"))) return;
  await autoDraftPrd(opts);
  if (stopped) return;
  await autoDraftTeam(opts);
}

// --- Step 1: Pre-flight ----------------------------------------------------

async function preflightCheck(): Promise<void> {
  step("Step 1 of 9: Pre-flight check");
  const missing: string[] = [];

  if (commandExists("git")) {
    const v = await runCommand("git", ["--version"], { capture: true });
    ok(`git ${v.stdout.trim()}`);
  } else {
    fail("git not found -install Git before running this launcher.");
    missing.push("git");
  }

  state.ghAvailable = commandExists("gh");
  if (state.ghAvailable) {
    const v = await runCommand("gh", ["--version"], { capture: true });
    ok(`gh ${v.stdout.split("\n")[0].replace(/^gh version /, "")}`);
  } else {
    warn("gh (GitHub CLI) not found -GitHub harness repo creation will be unavailable.");
  }

  state.copilotAvailable = commandExists("copilot");
  if (state.copilotAvailable) {
    ok("copilot (installed)");
  } else {
    warn("copilot not found -GitHub Copilot CLI auto-launch will be unavailable.");
  }

  state.opencodeAvailable = commandExists("opencode");
  if (state.opencodeAvailable) {
    ok("opencode (installed)");
  } else {
    warn("opencode not found -opencode harness auto-launch will be unavailable.");
  }

  state.claudeAvailable = commandExists("claude");
  if (state.claudeAvailable) {
    ok("claude (installed)");
  } else {
    warn("claude not found -Claude Code harness auto-launch will be unavailable.");
  }

  if (missing.length) {
    out("");
    fail(`Required tools are missing: ${missing.join(", ")}. Install them and re-run.`);
    process.exitCode = 1;
    throw new Error("pre-flight failed");
  }
}

function commandExists(cmd: string): boolean {
  const pathVar = process.env.PATH ?? "";
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

// --- Step 2: Select harness ------------------------------------------------

async function selectHarness(opts: LauncherOptions): Promise<void> {
  step("Step 2 of 9: Select agent harness");
  out("");

  const options = [
    { value: "1", label: "GitHub Copilot   (harness: github,    dir: .github/)" },
    { value: "2", label: "opencode         (harness: opencode,  dir: .opencode/)" },
    { value: "3", label: "Claude Code      (harness: claude,    dir: .claude/)" },
    { value: "4", label: "Generic .agents  (harness: agents,    dir: .agents/)", hint: "default" },
  ];

  const choice = await promptSelect("Which agent harness will this project use?", options, {
    initial: "4",
    nonInteractiveValue: process.env.FORGE_HARNESS_CHOICE ?? "4",
  });

  switch (choice) {
    case "1": state.harness = "github"; state.harnessLabel = "GitHub Copilot"; break;
    case "2": state.harness = "opencode"; state.harnessLabel = "opencode"; break;
    case "3": state.harness = "claude"; state.harnessLabel = "Claude Code"; break;
    case "4": state.harness = "agents"; state.harnessLabel = "Generic .agents"; break;
    default:
      warn(`Unrecognised choice '${choice}', defaulting to generic .agents`);
      state.harness = "agents"; state.harnessLabel = "Generic .agents";
  }
  if (!process.env.FORGE_ENGINE_HARNESS) {
    state.engineConfig.harness = defaultEngineHarness(state.harness);
  }
  ok(`Harness: ${state.harnessLabel} (--harness ${state.harness})`);
}

// --- Step 3: Create repository ---------------------------------------------

async function createRepo(opts: LauncherOptions): Promise<void> {
  step("Step 3 of 9: Create repository");

  let repoName: string;
  let repoDescription: string;
  let repoVisibility: string;
  let parentDir: string;

  if (opts.nonInteractive) {
    repoName = process.env.FORGE_REPO_NAME ?? "";
    if (!repoName) {
      fail("Non-interactive mode: $FORGE_REPO_NAME is not set.");
      throw new Error("FORGE_REPO_NAME not set");
    }
    repoDescription = process.env.FORGE_REPO_DESCRIPTION ?? "";
    repoVisibility = process.env.FORGE_REPO_VISIBILITY ?? "private";
    parentDir = process.env.FORGE_REPO_PARENT_DIR ?? process.cwd();
  } else {
    repoName = await prompt("Repository name (no spaces)", "");
    if (!repoName) {
      fail("Repository name cannot be empty.");
      throw new Error("empty repo name");
    }
    repoDescription = await prompt("Short description (optional)", "");
    repoVisibility = await prompt("Visibility -public or private", "private");
    parentDir = await promptPath("Parent directory for the new repo", process.cwd(), { directory: true });
  }

  repoVisibility = repoVisibility.toLowerCase();
  if (repoVisibility !== "public" && repoVisibility !== "private") repoVisibility = "private";
  parentDir = path.resolve(expandPath(parentDir || process.cwd()));

  state.repoDir = path.join(parentDir, repoName);

  if (state.harness === "github" && state.ghAvailable) {
    info(`Creating GitHub repository '${repoName}' (${repoVisibility}) …`);
    const ghArgs = ["repo", "create", repoName, `--${repoVisibility}`, "--clone"];
    if (repoDescription) ghArgs.push("--description", repoDescription);
    await runLoggedStep("Creating GitHub repository…", "gh", ghArgs, {
      cwd: parentDir,
      dryRun: opts.dryRun,
    });
    state.repoDir = path.join(parentDir, repoName);
    ok(`GitHub repo created and cloned to: ${state.repoDir}`);
    state.remoteCreated = true;
  } else {
    info(`Initialising local Git repository at: ${state.repoDir}`);
    fs.mkdirSync(state.repoDir, { recursive: true });
    await runCommand("git", ["init"], { cwd: state.repoDir });
    if (repoDescription) {
      fs.writeFileSync(
        path.join(state.repoDir, "README.md"),
        `# ${repoName}\n\n${repoDescription}\n`,
      );
    }
    ok(`Local git repository initialised: ${state.repoDir}`);
    state.remoteCreated = false;

    if (state.harness === "github" && !state.ghAvailable) {
      warn("gh is not installed -skipped remote creation.");
      warn("Run 'gh repo create' or 'git remote add origin <url>' manually.");
    } else {
      const addRemote = await promptYesNo("Add a Git remote for this repository now?", "n");
      if (addRemote === "y") {
        const remoteUrl = await prompt("Remote URL (e.g. https://github.com/user/repo.git)", "");
        if (remoteUrl) {
          await runCommand("git", ["-C", state.repoDir, "remote", "add", "origin", remoteUrl]);
          ok(`Remote 'origin' added: ${remoteUrl}`);
          state.remoteCreated = true;
        }
      }
    }
  }

  upsertProject({ path: state.repoDir, name: repoName, harness: state.harness });
}

// --- Step 4: Bootstrap -----------------------------------------------------

async function bootstrapForge(opts: LauncherOptions): Promise<void> {
  step("Step 4 of 9: Bootstrap MyForge");
  info(`Running bootstrap → ${state.repoDir} (--harness ${state.harness}) …`);
  await runWithHeartbeat(
    "Bootstrapping MyForge (copying templates)…",
    () =>
      bootstrap({
        targetDir: state.repoDir,
        harness: state.harness,
        force: true,
        nonInteractive: opts.nonInteractive,
        logFile: runLogFile(),
      }).then((code) => {
        if (code !== 0) throw new Error("bootstrap failed");
        return 0;
      }),
    { dryRun: opts.dryRun },
  );
  saveEngineConfig(state.repoDir, state.engineConfig);
  ok("MyForge templates bootstrapped.");
}

// --- Step 5: Capture idea --------------------------------------------------

async function captureIdea(opts: LauncherOptions): Promise<void> {
  step("Step 5 of 9: Capture your project idea");
  const ideaFileDocs = path.join(state.repoDir, "docs", "IDEA.md");
  const ideaFileRoot = path.join(state.repoDir, "IDEA.md");

  out("");
  out("  Describe your project idea below.");
  out("  This will be saved to docs/IDEA.md (and mirrored to IDEA.md)");
  out("  and used as the starting prompt");
  out("  for forge-auto-build-prd (which turns it into docs/PRD.md).");
  out("");

  let ideaText: string;
  if (opts.nonInteractive) {
    ideaText = process.env.FORGE_IDEA ?? "";
    if (!ideaText) {
      fail("Non-interactive mode: $FORGE_IDEA is not set.");
      throw new Error("FORGE_IDEA not set");
    }
  } else {
    ideaText = await promptMultiline("Describe your project idea");
  }

  if (!ideaText.trim()) {
    warn("No idea text entered. docs/IDEA.md will be created as a placeholder.");
    ideaText = "*(Replace this with your project idea before running forge-auto-build-prd.)*";
  }

  fs.mkdirSync(path.join(state.repoDir, "docs"), { recursive: true });
  const content = [
    "# Project Idea",
    "",
    ideaText,
    "",
    "---",
    "",
    `> Generated by forge-launcher on ${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}`,
    "> Use this file as input for: `@workspace /forge-auto-build-prd Use docs/IDEA.md as the project idea`",
    "",
  ].join("\n");
  fs.writeFileSync(ideaFileDocs, content);
  fs.copyFileSync(ideaFileDocs, ideaFileRoot);

  ok(`Idea saved to: ${ideaFileDocs}`);
  info(`Compatibility copy written to: ${ideaFileRoot}`);
}

// --- Step 6: PRD + research ------------------------------------------------

async function addPrdAndResearch(opts: LauncherOptions): Promise<void> {
  step("Step 6 of 9: Add PRD and research / seed documents (optional -recommended)");

  const docsDir = path.join(state.repoDir, "docs");
  const researchDir = path.join(docsDir, "research");
  state.prdAdded = false;
  state.researchAdded = false;

  out("");
  out("  Why this step matters:");
  out("  Starting with a well-defined PRD produces a far more accurate and");
  out("  complete build than starting from an idea alone.  Research / seed");
  out("  documents (design specs, market research, technical notes, etc.) give");
  out("  the pipeline additional context that improves every downstream stage.");
  out("");

  // --- PRD ---
  if (opts.nonInteractive) {
    const prdFile = process.env.FORGE_PRD_FILE;
    if (prdFile) {
      const resolved = resolveInputFile(prdFile);
      if (resolved.ok) {
        fs.mkdirSync(docsDir, { recursive: true });
        fs.copyFileSync(resolved.path, path.join(docsDir, "PRD.md"));
        ok("PRD copied from $FORGE_PRD_FILE → docs/PRD.md");
        state.prdAdded = true;
      } else {
        warn(`FORGE_PRD_FILE is set but ${resolved.reason} -skipping PRD.`);
      }
    }
  } else {
    out("  Do you have an existing PRD to add?");
    out("");
    const prdChoice = await promptSelect(
      "Do you have an existing PRD to add?",
      [
        { value: "1", label: "Yes - provide a file path to copy in as docs/PRD.md" },
        { value: "2", label: "Yes - paste the PRD content directly" },
        { value: "3", label: "No  - skip (the pipeline will build a PRD from docs/IDEA.md first)", hint: "default" },
      ],
      { initial: "3", nonInteractiveValue: "3" },
    );

    if (prdChoice === "1") {
      const prdSrc = await promptPath("Path to your PRD file", "");
      const resolved = resolveInputFile(prdSrc);
      if (resolved.ok) {
        fs.mkdirSync(docsDir, { recursive: true });
        fs.copyFileSync(resolved.path, path.join(docsDir, "PRD.md"));
        ok("PRD copied → docs/PRD.md");
        state.prdAdded = true;
      } else {
        warn(`${resolved.reason} -skipping PRD.`);
      }
    } else if (prdChoice === "2") {
      out("");
      const prdText = await promptMultiline("Paste your PRD content");
      if (prdText.trim()) {
        fs.mkdirSync(docsDir, { recursive: true });
        fs.writeFileSync(path.join(docsDir, "PRD.md"), prdText + "\n");
        ok("PRD saved → docs/PRD.md");
        state.prdAdded = true;
      } else {
        warn("No content entered -skipping PRD.");
      }
    } else {
      info("Skipping PRD -the pipeline will build a PRD from docs/IDEA.md first (via forge-auto-build-prd).");
    }
  }

  // --- Research / seed documents ---
  if (opts.nonInteractive) {
    const researchFiles = process.env.FORGE_RESEARCH_FILES;
    if (researchFiles) {
      fs.mkdirSync(researchDir, { recursive: true });
      for (const raw of researchFiles.split(",")) {
        const f = raw.trim();
        if (!f) continue;
        const resolved = resolveInputFile(f);
        if (resolved.ok) {
          fs.copyFileSync(resolved.path, path.join(researchDir, path.basename(resolved.path)));
          ok(`Research doc copied: ${path.basename(resolved.path)} → docs/research/`);
          state.researchAdded = true;
        } else {
          warn(`FORGE_RESEARCH_FILES: ${resolved.reason} -skipping.`);
        }
      }
    }
  } else {
    out("");
    const addResearch = await promptYesNo(
      "Do you have research or seed documents to add (design specs, market research, technical notes…)?",
      "n",
    );
    if (addResearch === "y") {
      fs.mkdirSync(researchDir, { recursive: true });
      out("");
      const paths = await promptPathLoop("  Enter a research/seed doc path (Enter on a blank line to finish)");
      for (const resPath of paths) {
        const resolved = resolveInputFile(resPath);
        if (resolved.ok) {
          fs.copyFileSync(resolved.path, path.join(researchDir, path.basename(resolved.path)));
          ok(`Research doc copied: ${path.basename(resolved.path)} → docs/research/`);
          state.researchAdded = true;
        } else {
          warn(`${resolved.reason} -skipping.`);
        }
      }
    } else {
      info("Skipping research documents.");
    }
  }
}

// --- Step 7: Commit + push -------------------------------------------------

async function commitBootstrap(): Promise<void> {
  step("Step 7 of 9: Commit bootstrapped forge and idea");

  await runCommand("git", ["-C", state.repoDir, "add", "."]);
  await runCommand("git", ["-C", state.repoDir, "commit", "-m", "chore: bootstrap MyForge"]);
  ok("Committed: 'chore: bootstrap MyForge'");

  if (state.remoteCreated) {
    info("Pushing to remote …");
    const branch = await runCommand("git", ["-C", state.repoDir, "rev-parse", "--abbrev-ref", "HEAD"], { capture: true });
    const push = await runLoggedStep("Pushing to remote…", "git", ["-C", state.repoDir, "push", "-u", "origin", "HEAD"]);
    if (push !== 0 && branch.stdout.trim()) {
      await runLoggedStep("Pushing to remote…", "git", ["-C", state.repoDir, "push", "-u", "origin", branch.stdout.trim()]);
    }
    ok("Pushed to remote.");
  } else {
    warn("No remote configured -skipping push. Add a remote and run 'git push -u origin HEAD' manually.");
  }
}

// --- Step 8: Launch auto-build ---------------------------------------------

async function launchAutobuild(opts: LauncherOptions): Promise<void> {
  step("Step 8 of 9: Launch auto-build");

  out("");
  if (hasPrd()) {
    if (hasGeneratedTeam()) {
      out("  The repository is bootstrapped, PRD in place, and the agent team");
      out("  is generated. In the harness, run /forge-orchestrate-build (project-");
      out("  orchestrator) for an interactive build, or forge-launcher engine-run");
      out("  for autonomous execution through the workflow engine.");
    } else {
      out("  The repository is bootstrapped and ready for forge-auto-build.");
      out("  forge-auto-build will generate the agent team, then execute the build");
      out("  (add 'GO --workflow-engine' at its pre-flight gate to run via the");
      out("  workflow engine instead of the prompt-driven orchestrator).");
    }
  } else {
    out("  The repository is bootstrapped. forge-auto-build-prd will turn your idea");
    out("  into a reviewed PRD, then forge-auto-build will generate the agent team");
    out("  and execute the build.");
  }
  out("");

  if (opts.headless) {
    info("Headless mode: driving the queued skill directly from the terminal");
    out("  (no interactive CLI session will be opened).");
    out("");
    await runSkillHeadless(headlessSkillMsg(), opts);
    return;
  }

  await autoDraftMenu(opts);
  if (stopped) return;

  if (state.engineStarted) {
    out("");
    info("The workflow engine is already running this build in the background.");
    info("Skipping the interactive CLI launch prompt - monitor or resume it with forge-launcher resume.");
    return;
  }

  const launchPrompt = async (cli: string, extra: string[]): Promise<void> => {
    const answer = await promptYesNo(`Launch ${cli} in the new repository now?`, "n");
    if (answer === "n") {
      info("To launch manually:");
      out(`    cd "${state.repoDir}" && ${cli} ${extra.join(" ")}`);
      out(`    Then: ${autobuildCommand()}`);
      return;
    }
    info(`Launching ${cli} in: ${state.repoDir}`);
    const launched = await launchCliInTerminal(cli, state.repoDir, extra);
    if (launched) {
      ok(`${cli} launched in a separate terminal.`);
      out(`    Then run: ${autobuildCommand()}`);
    } else {
      warn(`${cli} did not open automatically. Run:`);
      out(`    cd "${state.repoDir}" && ${cli} ${extra.join(" ")}`);
      out(`    Then: ${autobuildCommand()}`);
    }
  };

  switch (state.harness) {
    case "github":
      if (state.copilotAvailable) {
        await launchPrompt("copilot", []);
      } else {
        info("Open the repository in GitHub Copilot Chat and run:");
        out("");
        out(`    ${autobuildCommand()}`);
        out("");
        info("The skill will present a pre-flight summary. Type GO to start the pipeline (use GO --workflow-engine for the workflow-engine build path).");
      }
      break;
    case "claude":
      if (state.claudeAvailable) {
        await launchPrompt("claude", ["."]);
      } else {
        warn("claude CLI is not installed. Install it from https://claude.ai/code then run:");
        out(`    cd "${state.repoDir}" && claude .`);
        out(`    Then: ${autobuildCommand()}`);
      }
      break;
    case "agents":
      info("Open the repository in your agent harness and run:");
      out("");
      out(`    ${autobuildCommand()}`);
      out("");
      info("Agent templates are in:");
      out(`    ${path.join(state.repoDir, ".agents", "agents")}/`);
      break;
    case "opencode":
      if (state.opencodeAvailable) {
        await launchPrompt("opencode", ["."]);
      } else {
        warn("opencode CLI is not installed. Install it from https://opencode.ai then run:");
        out(`    cd "${state.repoDir}" && opencode .`);
        out(`    Then: ${autobuildCommand()}`);
      }
      break;
  }
}

// --- Resume: re-enter an existing project at the current stage --------------

export interface ResumeOptions {
  repo?: string;
  nonInteractive?: boolean;
  dryRun?: boolean;
}

interface ResumeEngineState {
  runId?: string;
  status?: string;
  harness?: string;
  currentPhase?: string;
  tasks?: Record<string, { taskId?: string; status?: string; errorMessage?: string; outputFiles?: string[] }>;
  blockers?: string[];
}

/** Detects which harness root a repo was bootstrapped with. */
function detectHarnessForRepo(repoDir: string): { harness: HarnessName; label: string } {
  const roots: Array<[HarnessName, string]> = [
    ["opencode", ".opencode"],
    ["github", ".github"],
    ["claude", ".claude"],
    ["agents", ".agents"],
  ];
  const bootstrapped = roots.find(([, root]) =>
    fs.existsSync(path.join(repoDir, root, "agents")) ||
    fs.existsSync(path.join(repoDir, root, "skills")));
  const [harness] = bootstrapped ?? (["agents", ".agents"] as [HarnessName, string]);
  const labels: Record<HarnessName, string> = {
    github: "GitHub Copilot",
    opencode: "opencode",
    claude: "Claude Code",
    agents: "Generic .agents",
  };
  return { harness, label: labels[harness] };
}

/** Re-populates the module state from an existing repo (resume entry point). */
function setupStateForRepo(repoDir: string): void {
  const { harness, label } = detectHarnessForRepo(repoDir);
  state.repoDir = repoDir;
  state.harness = harness;
  state.harnessLabel = label;
  state.remoteCreated = false;
  state.ghAvailable = commandExists("gh");
  state.copilotAvailable = commandExists("copilot");
  state.opencodeAvailable = commandExists("opencode");
  state.claudeAvailable = commandExists("claude");
  state.prdAdded = fs.existsSync(path.join(repoDir, "docs", "PRD.md"));
  state.researchAdded = fs.existsSync(path.join(repoDir, "docs", "research"));
  state.engineStarted = false;
  // Start from any persisted engine config (docs/engine-config.json), then let
  // explicit environment variables win over it.
  const persisted = loadEngineConfig(repoDir);
  state.engineConfig.harness = process.env.FORGE_ENGINE_HARNESS ?? persisted?.harness ?? "opencode";
  state.engineConfig.granularity = process.env.FORGE_ENGINE_GRANULARITY ?? persisted?.granularity ?? "";
  state.engineConfig.concurrency = process.env.FORGE_ENGINE_CONCURRENCY ?? persisted?.concurrency ?? "";
  state.engineConfig.taskTimeoutMs = process.env.FORGE_ENGINE_TASK_TIMEOUT_MS ?? persisted?.taskTimeoutMs ?? "";
  state.engineConfig.maxRetries = process.env.FORGE_ENGINE_MAX_RETRIES ?? persisted?.maxRetries ?? "";
  state.engineConfig.viz = envFlagOrUndefined("FORGE_ENGINE_VIZ") ?? persisted?.viz ?? false;
  state.engineConfig.vizPort = process.env.FORGE_ENGINE_VIZ_PORT ?? persisted?.vizPort ?? "";
  state.engineConfig.keepAlive = envFlagOrUndefined("FORGE_ENGINE_ATTACH") ?? persisted?.keepAlive ?? false;
  state.engineConfig.attach = process.env.FORGE_ENGINE_ATTACH_URL ?? persisted?.attach ?? "";
  state.engineConfig.autoCommit = envFlagOrUndefined("FORGE_ENGINE_AUTO_COMMIT") ?? persisted?.autoCommit ?? true;
  state.engineConfig.executionMode = persisted?.executionMode === "manual" ? "manual" : "auto";
  state.engineConfig.selectionScope = persisted?.selectionScope === "single" || persisted?.selectionScope === "range" || persisted?.selectionScope === "list"
    ? persisted.selectionScope
    : undefined;
  state.engineConfig.selectedTaskIds = Array.isArray(persisted?.selectedTaskIds)
    ? persisted!.selectedTaskIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    : [];
}

function readEngineState(): ResumeEngineState | null {
  const sp = path.join(state.repoDir, "docs", "WORKFLOW-STATE.json");
  if (!fs.existsSync(sp)) return null;
  try {
    return JSON.parse(fs.readFileSync(sp, "utf8")) as ResumeEngineState;
  } catch {
    return null;
  }
}

function prdDocName(): string {
  return fs.existsSync(path.join(state.repoDir, "docs", "product-vision.md"))
    ? "product-vision.md (decomposed)"
    : "PRD.md";
}

function printResumeWhere(): void {
  const ideaPath = path.join(state.repoDir, "docs", "IDEA.md");
  const idea = fs.existsSync(ideaPath);
  const prd = hasPrd();
  const team = hasGeneratedTeam();
  const manifest = fs.existsSync(path.join(state.repoDir, "docs", "EXECUTION-MANIFEST.json"));
  const engine = readEngineState();

  step("Resume project state");
  out("");
  out(`  Repository  : ${link(state.repoDir)}`);
  out(`  Harness     : ${state.harnessLabel} (${harnessRootDir()}/)`);
  out("");
  info("Where you are:");
  out(`    - Project idea       : ${idea ? `yes  ${link(ideaPath)}` : "no"}`);
  out(`    - PRD                : ${prd ? `yes  ${link(path.join(state.repoDir, "docs", prdDocName()))}` : "no"}`);
  out(`    - Agent team         : ${team ? `yes  ${link(harnessAgentsDir() + "/")}` : "no"}`);
  out(`    - Execution manifest : ${manifest ? "yes" : "no"}`);
  if (engine) out(`    - Engine run         : ${engine.status ?? "unknown"}${engine.runId ? ` (run ${engine.runId})` : ""}`);
  out("");
}

/** Stage: capture a project idea (only when nothing at all exists yet). */
async function resumeIdeaStep(opts: ResumeOptions): Promise<boolean> {
  const ideaPath = path.join(state.repoDir, "docs", "IDEA.md");
  if (fs.existsSync(ideaPath) || hasPrd()) return true;
  if (opts.nonInteractive) {
    out("  No idea or PRD captured yet. Next: run the launcher to capture an idea:");
    command("forge-launcher");
    return false;
  }
  out("  No project idea or PRD captured yet in this repository.");
  out("");
  const choice = await promptSelect("What would you like to do?", [
    { value: "capture", label: "Capture your project idea now", hint: "writes docs/IDEA.md" },
    { value: "cli", label: "Open the harness CLI to run /forge-auto-build-prd manually" },
    { value: "stop", label: "Stop here" },
  ], { initial: "capture" });
  if (choice === "stop") return false;
  if (choice === "cli") {
    await openCliFor("/forge-auto-build-prd Use docs/IDEA.md as the project idea");
    return false;
  }
  if (opts.dryRun) {
    warn("Dry-run: would prompt for an idea and write docs/IDEA.md.");
    return false;
  }
  const ideaText = await promptMultiline("Describe your project idea");
  if (!ideaText.trim()) {
    warn("No idea text entered; stopping here.");
    return false;
  }
  fs.mkdirSync(path.join(state.repoDir, "docs"), { recursive: true });
  const content = [
    "# Project Idea",
    "",
    ideaText,
    "",
    "---",
    "",
    `> Generated by forge-launcher (resume) on ${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}`,
    "> Use this file as input for: `@workspace /forge-auto-build-prd Use docs/IDEA.md as the project idea`",
    "",
  ].join("\n");
  fs.writeFileSync(ideaPath, content);
  fs.copyFileSync(ideaPath, path.join(state.repoDir, "IDEA.md"));
  ok(`Idea saved to: ${link(ideaPath)}`);
  return true;
}

/** Stage: turn the idea into a reviewed PRD. */
async function resumePrdStep(opts: ResumeOptions): Promise<boolean> {
  if (hasPrd()) return true;
  if (!fs.existsSync(path.join(state.repoDir, "docs", "IDEA.md"))) return true;
  if (opts.nonInteractive) {
    out("  No PRD yet. Next: draft the PRD from docs/IDEA.md:");
    command(headlessCmdFor(`/forge-auto-build-prd ${PRD_HEADLESS_MSG}`));
    return false;
  }
  out("  No PRD yet. docs/IDEA.md is ready to become a reviewed PRD.");
  out("");
  const choice = await promptSelect("How do you want to create the PRD?", [
    { value: "draft", label: "Auto-draft it now", hint: "headless forge-auto-build-prd" },
    { value: "cli", label: "Open the harness CLI to draft it manually" },
    { value: "stop", label: "Stop here" },
  ], { initial: "draft" });
  if (choice === "stop") return false;
  if (choice === "cli") {
    await openCliFor("/forge-auto-build-prd Use docs/IDEA.md as the project idea");
    return false;
  }
  const ran = await runSkillHeadless(`/forge-auto-build-prd ${PRD_HEADLESS_MSG}`, opts);
  if (!ran) return false;
  await draftCommit("docs: add auto-drafted PRD");
  if (hasPrd()) {
    state.prdAdded = true;
    ok("PRD generated.");
    out("");
    out("  Review it before continuing:");
    out(`    - ${link(path.join(state.repoDir, "docs", "PRD.md"))}`);
    if (fs.existsSync(path.join(state.repoDir, "docs", "product-vision.md"))) {
      out("    - " + link(path.join(state.repoDir, "docs", "product-vision.md")) + " (decomposed) + docs/features/*.md");
    } else {
      out("    - docs/PRD.md is monolithic (no decomposition)");
    }
  } else {
    await diagnoseAutoDraftFail("forge-auto-build-prd");
    return false;
  }
  return true;
}

/** Stage: generate the agent team from the PRD. */
async function resumeTeamStep(opts: ResumeOptions): Promise<boolean> {
  if (hasGeneratedTeam()) return true;
  if (!hasPrd()) return true;
  if (opts.nonInteractive) {
    out("  No agent team yet. Next: generate the team from the PRD:");
    command(headlessCmdFor(`${buildTeamPrompt(prdSourceForTeam(), state.harness)} Auto-proceed with default assumptions and no questions.`));
    return false;
  }
  out("  No agent team yet. docs/PRD.md is ready for team generation.");
  out("");
  const choice = await promptSelect("How do you want to generate the team?", [
    { value: "draft", label: "Auto-draft it now", hint: "headless forge-build-agent-team" },
    { value: "cli", label: "Open the harness CLI to build the team manually" },
    { value: "stop", label: "Stop here" },
  ], { initial: "draft" });
  if (choice === "stop") return false;
  if (choice === "cli") {
    await openCliFor(buildTeamPrompt("docs/PRD.md", state.harness));
    return false;
  }
  const prdSource = prdSourceForTeam();
  const ran = await runSkillHeadless(
    `${buildTeamPrompt(prdSource, state.harness)} Auto-proceed with default assumptions and no questions.`,
    opts,
  );
  if (!ran) return false;
  await draftCommit("feat: generate auto-drafted agent team");
  if (hasGeneratedTeam()) {
    ok("Agent team generated.");
    out("");
    out("  Review the generated team before building:");
    out(`    - Agents : ${link(harnessAgentsDir() + "/")}`);
    out(`    - Skills : ${link(harnessSkillsDir() + "/")}`);
  } else {
    await diagnoseAutoDraftFail("forge-build-agent-team");
    return false;
  }
  return true;
}

/**
 * Headless pipeline advancement for the Forge Console: draft the PRD from
 * docs/IDEA.md (when absent). Non-interactive by design — the console triggers
 * it, the user reviews the result (and comes back) in the UI.
 */
export async function runDraftPrd(repoDir: string): Promise<number> {
  setupStateForRepo(repoDir);
  if (hasPrd()) {
    out("PRD already exists.");
    return 0;
  }
  const ideaPath = path.join(repoDir, "docs", "IDEA.md");
  const context = fs.existsSync(ideaPath)
    ? "Use docs/IDEA.md as the project idea."
    : "This is an existing repository with no IDEA.md. Inspect the existing source code, docs, tests, package manifests, and git history as the project context; infer the product purpose and ask no questions.";
  out(fs.existsSync(ideaPath) ? "Auto-drafting the PRD from docs/IDEA.md (headless) …" : "Auto-drafting a context-aware PRD from the existing repository (headless) …");
  const ran = await runSkillHeadless(`/forge-auto-build-prd ${context} ${PRD_HEADLESS_MSG}`, { nonInteractive: true });
  if (!ran) return 1;
  await draftCommit("docs: add auto-drafted PRD");
  if (hasPrd()) {
    ok("PRD generated.");
    out(`    - ${link(path.join(repoDir, "docs", "PRD.md"))}`);
    return 0;
  }
  await diagnoseAutoDraftFail("forge-auto-build-prd");
  return 1;
}

/** Authors a project PRD from an existing repository without an IDEA.md. */
export async function runDraftExistingPrd(repoDir: string): Promise<number> {
  setupStateForRepo(repoDir);
  if (hasPrd()) { out("PRD already exists."); return 0; }
  out("Authoring a project PRD from the existing repository (headless) …");
  const skill = "forge-build-prd";
  const ran = await runSkillHeadless(`/${skill} ${EXISTING_PROJECT_PRD_MSG}`, { nonInteractive: true });
  if (!ran) return 1;
  await draftCommit("docs: add project PRD");
  if (hasPrd()) {
    ok("Project PRD generated.");
    out(`    - ${link(path.join(repoDir, "docs", "PRD.md"))}`);
    return 0;
  }
  await diagnoseAutoDraftFail(skill);
  return 1;
}

/** Authors a Feature PRD through the authoring skill; workflow execution is intentionally separate. */
export async function runFeaturePrd(repoDir: string, featurePrompt?: string): Promise<number> {
  setupStateForRepo(repoDir);
  authoringEvent("authoring.started", { operation: "feature-prd" });
  const featuresDir = path.join(repoDir, "docs", "features");
  const before = new Set(fs.existsSync(featuresDir)
    ? fs.readdirSync(featuresDir).filter((name) => name.endsWith(".md"))
    : []);
  if (!featurePrompt?.trim()) {
    if (prompts.nonInteractive) throw new Error("feature-prd requires --prompt in non-interactive mode");
    featurePrompt = await prompt("What feature should be added?", "");
  }
  if (!featurePrompt.trim()) return 1;
  const message = `/forge-build-feature-prd I want to add ${featurePrompt.trim()} to this project. Analyze the existing codebase and agent team, then produce a self-contained Feature PRD and save it under docs/features/. Do not modify the original PRD or start the workflow engine.`;
  const ran = await runSkillHeadless(message, { nonInteractive: true });
  if (!ran) {
    authoringEvent("authoring.failed", { operation: "feature-prd", stage: "authoring" });
    return 1;
  }
  const added = fs.existsSync(featuresDir)
    ? fs.readdirSync(featuresDir)
      .filter((name) => name.endsWith(".md") && !before.has(name))
      .filter((name) => fs.statSync(path.join(featuresDir, name)).isFile())
      .filter((name) => fs.readFileSync(path.join(featuresDir, name), "utf8").trim().length > 0)
    : [];
  if (added.length === 0) {
    fail("Feature PRD authoring exited without creating a new non-empty docs/features/*.md file.");
    await diagnoseAutoDraftFail("forge-build-feature-prd");
    authoringEvent("authoring.failed", { operation: "feature-prd", stage: "validation" });
    return 1;
  }
  await draftCommit("docs: add feature PRD");
  ok(`Feature PRD generated: ${added.join(", ")}`);
  authoringEvent("authoring.completed", { operation: "feature-prd", features: added });
  return 0;
}

/** Author a feature, update only affected team members, compile, and optionally run it. */
export async function runFeatureIncrement(repoDir: string, featurePrompt: string | undefined, run = false): Promise<number> {
  setupStateForRepo(repoDir);
  authoringEvent("authoring.started", { operation: "feature-increment", run });
  const featuresDir = path.join(repoDir, "docs", "features");
  const beforeFeatures = new Set(fs.existsSync(featuresDir)
    ? fs.readdirSync(featuresDir).filter((name) => name.endsWith(".md"))
    : []);
  const featureCode = await runFeaturePrd(repoDir, featurePrompt);
  if (featureCode !== 0) { authoringEvent("authoring.failed", { operation: "feature-increment", stage: "feature-prd", code: featureCode }); return featureCode; }
  authoringEvent("authoring.stage.completed", { operation: "feature-increment", stage: "feature-prd" });
  const teamCode = await runDraftTeam(repoDir, true);
  if (teamCode !== 0) { authoringEvent("authoring.failed", { operation: "feature-increment", stage: "team", code: teamCode }); return teamCode; }
  authoringEvent("authoring.stage.completed", { operation: "feature-increment", stage: "team" });
  const manifestCode = await runCompileManifest(repoDir);
  if (manifestCode !== 0) { authoringEvent("authoring.failed", { operation: "feature-increment", stage: "manifest", code: manifestCode }); return manifestCode; }
  authoringEvent("authoring.stage.completed", { operation: "feature-increment", stage: "manifest" });
  if (!run) {
    out("Feature increment prepared. Review the manifest, then run: forge-launcher engine-run --repo \"" + path.resolve(repoDir) + "\" --yes");
    authoringEvent("authoring.completed", { operation: "feature-increment", run: false });
    return 0;
  }
  const newFeatures = fs.existsSync(featuresDir)
    ? fs.readdirSync(featuresDir).filter((name) => name.endsWith(".md") && !beforeFeatures.has(name))
    : [];
  const code = await engineRunCliForIncrement(repoDir, newFeatures.map((name) => path.basename(name, ".md")));
  authoringEvent(code === 0 ? "authoring.completed" : "authoring.failed", { operation: "feature-increment", run: true, code });
  return code;
}

async function engineRunCliForIncrement(repoDir: string, featureNames: string[]): Promise<number> {
  const manifestPath = path.join(repoDir, "docs", "EXECUTION-MANIFEST.json");
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      phases?: Array<{ id?: string; feature?: string; tasks?: Array<{ id: string }> }>;
    };
    const selected = featureTaskIds(manifest, featureNames);
    if (selected.length === 0) {
      fail("Cannot run feature increment: no task IDs were emitted for the feature PRD.");
      return 1;
    }
    const cfg = state.engineConfig;
    const args = ["--repo", path.resolve(repoDir), "--harness", cfg.harness || "opencode", "--execution-mode", "manual", "--selected-tasks", selected.join(","), "--yes"];
    if (cfg.granularity) args.push("--granularity", cfg.granularity);
    if (cfg.concurrency) args.push("--concurrency", cfg.concurrency);
    if (cfg.taskTimeoutMs) args.push("--task-timeout-ms", cfg.taskTimeoutMs);
    if (cfg.maxRetries) args.push("--max-retries", cfg.maxRetries);
    if (cfg.viz) args.push("--viz", ...(cfg.vizPort ? ["--viz-port", cfg.vizPort] : []));
    if (cfg.keepAlive) args.push("--keep-alive");
    if (cfg.attach) args.push("--attach", cfg.attach);
    if (cfg.autoCommit === false) args.push("--no-auto-commit");
    return engineRunCli(args);
  } catch {
    fail("Cannot run feature increment: execution manifest is missing or invalid.");
    return 1;
  }
}

/** Returns only task IDs belonging to the newly authored feature documents. */
export function featureTaskIds(
  manifest: { phases?: Array<{ id?: string; feature?: string; tasks?: Array<{ id: string }> }> },
  featureNames: string[],
): string[] {
  const featureCodes = new Set(featureNames.map((name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toUpperCase()));
  return (manifest.phases ?? [])
    .filter((phase) => phase.feature && (featureNames.includes(phase.feature) || featureCodes.has((phase.id ?? "").split("-")[0] ?? "")))
    .flatMap((phase) => (phase.tasks ?? []).map((task) => task.id));
}

/**
 * Headless pipeline advancement for the Forge Console: generate the agent team
 * from the PRD (when absent).
 */
export async function runDraftTeam(repoDir: string, featureIncrement = false): Promise<number> {
  setupStateForRepo(repoDir);
  if (hasGeneratedTeam() && !featureIncrement) {
    out("Agent team already exists.");
    return 0;
  }
  if (!hasPrd()) {
    fail("No PRD yet; draft the PRD first.");
    return 1;
  }
  out("Generating the agent team from the PRD (headless) …");
  // Capture this immediately before invoking the team skill. In feature mode
  // the preceding feature-PRD stage is expected to change docs, so those
  // changes must not be attributed to team generation.
  const featureSnapshot = featureIncrement ? snapshotFeatureIncrementFiles(repoDir) : undefined;
  const prdSource = prdSourceForTeam();
  const ran = await runSkillHeadless(
    `${buildTeamPrompt(prdSource, state.harness)} ${featureIncrement
      ? "This is Feature Increment Mode. Preserve every untouched existing agent and skill; update or add only agents affected by the new feature. Review the existing codebase and team before making changes."
      : "Auto-proceed with default assumptions and no questions."}`,
    { nonInteractive: true },
  );
  if (!ran) return 1;
  if (featureSnapshot && !validateFeatureIncrementFiles(featureSnapshot)) return 1;
  await draftCommit("feat: generate auto-drafted agent team");
  if (hasGeneratedTeam()) {
    ok("Agent team generated.");
    out(`    - Agents : ${link(harnessAgentsDir() + "/")}`);
    return 0;
  }
  await diagnoseAutoDraftFail("forge-build-agent-team");
  return 1;
}

export async function runCompileManifest(repoDir: string): Promise<number> {
  setupStateForRepo(repoDir);
  const manifestPath = path.join(repoDir, "docs", "EXECUTION-MANIFEST.json");
  if (fs.existsSync(manifestPath)) out("Recompiling the execution manifest (existing task state will be reconciled) …");
  if (!hasGeneratedTeam()) {
    fail("No generated agent team yet; generate the team first.");
    return 1;
  }
  const adapterDir = findAdapterDir(repoDir);
  if (!adapterDir) {
    fail("forge-execution-adapter is not installed under this repo.");
    return 1;
  }
  out("Preparing the build by compiling the execution manifest …");
  let code = await runLoggedStep("Installing execution adapter dependencies", "npm", ["install"], { cwd: adapterDir });
  if (code !== 0) return code;
  const compileArgs = ["run", "forge-execution-adapter", "--", "compile", "--repo", repoDir];
  if (state.engineConfig.granularity) compileArgs.push("--granularity", state.engineConfig.granularity);
  code = await runLoggedStep("Compiling execution manifest", "npm", compileArgs, { cwd: adapterDir });
  if (code !== 0) return code;
  if (!fs.existsSync(manifestPath)) {
    fail("Manifest compile exited without producing docs/EXECUTION-MANIFEST.json.");
    return 1;
  }
  ok("Execution manifest compiled.");
  out(`    - ${link(manifestPath)}`);
  return 0;
}

function printEngineStatus(engine: ResumeEngineState): void {
  info("Engine run state:");
  out(`    - Run id   : ${engine.runId ?? "unknown"}`);
  out(`    - Status   : ${engine.status ?? "unknown"}`);
  out(`    - Harness  : ${engine.harness ?? "-"}`);
  if (engine.currentPhase) out(`    - Phase    : ${engine.currentPhase}`);
  const tasks = Object.values(engine.tasks ?? {});
  const counts: Record<string, number> = {};
  for (const t of tasks) counts[t.status ?? "pending"] = (counts[t.status ?? "pending"] ?? 0) + 1;
  out(`    - Tasks    : ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(", ") || "0"}`);
  const hollow = tasks.filter((t) => t.status === "complete" && (!t.outputFiles || t.outputFiles.length === 0));
  if (hollow.length) {
    out(`    - Completed without outputs : ${hollow.map((t) => t.taskId).join(", ")} (verify these actually delivered)`);
  }
  const failed = tasks.filter((t) => t.status === "failed");
  if (failed.length) {
    out(`    - Failed   : ${failed.map((t) => `${t.taskId ?? "?"}${t.errorMessage ? ` (${t.errorMessage})` : ""}`).join("; ")}`);
  }
  if (Array.isArray(engine.blockers) && engine.blockers.length) {
    out(`    - Blockers : ${engine.blockers.join("; ")}`);
  }
  out("");
}

function printMonitorCommands(): void {
  info("Monitor the build from another terminal:");
  command(`tail -f ${path.join(state.repoDir, "docs", "engine-run.log")}`);
  command(`tail -f ${path.join(state.repoDir, "docs", "PROGRESS.md")}`);
  command(`npx forge-launcher ${engineRunArgs().join(" ")}`);
  out("");
}

async function openCliFor(cmd: string): Promise<void> {
  const cli = state.harness === "github" ? "copilot" : state.harness === "claude" ? "claude" : "opencode";
  const launched = await launchCliInTerminal(cli, state.repoDir, state.harness === "github" ? [] : ["."]);
  if (launched) ok(`${cli} launched in a separate terminal.`);
  else {
    warn(`${cli} did not open automatically. Run:`);
    out(`    cd "${state.repoDir}" && ${cli} .`);
  }
  out(`    Then run: ${cmd}`);
  out("");
}

/** Stage: start/resume the build via the engine or hand off to the harness. */
async function resumeEngineStep(opts: ResumeOptions): Promise<void> {
  const engine = readEngineState();

  if (engine) {
    printEngineStatus(engine);
    if (opts.nonInteractive) {
      if (engine.status === "complete") {
        out("  The engine run is complete. Next:");
        command(`tail -f ${path.join(state.repoDir, "docs", "PROGRESS.md")}`);
      } else if (engine.status === "running") {
        warn("The engine is already running in the background - do not start a second run.");
        printMonitorCommands();
      } else {
        out("  Next: resume the engine run from WORKFLOW-STATE.json:");
        command(`npx forge-launcher ${engineRunArgs().join(" ")}`);
      }
      return;
    }
    if (engine.status === "complete") {
      ok("The build is complete.");
      const open = await promptYesNo("Open the harness CLI to continue (add features, review, etc.)?", "n");
      if (open === "y") await openCliFor("/forge-orchestrate-build");
      return;
    }
    if (engine.status === "running") {
      warn("The engine is currently running in the background.");
      const stopChoice = await promptSelect("The engine is running. What would you like to do?", [
        { value: "monitor", label: "Monitor the build (print commands)", hint: "default" },
        { value: "stop", label: "Stop the engine after the current task" },
        { value: "back", label: "Go back" },
      ], { initial: "monitor" });
      if (stopChoice === "stop") {
        await stopEngine(opts);
      } else if (stopChoice === "monitor") {
        printMonitorCommands();
      }
      return;
    }
    const choice = await promptSelect("What would you like to do?", [
      { value: "resume", label: "Resume the engine run", hint: "continues from WORKFLOW-STATE.json" },
      { value: "cli", label: "Open the harness CLI for project-orchestrator" },
      { value: "logs", label: "Print monitor / log commands" },
      { value: "stop", label: "Stop here" },
    ], { initial: "resume" });
    switch (choice) {
      case "resume": await runEngineDetached(opts); break;
      case "cli": await openCliFor(autobuildCommand()); break;
      case "logs": printMonitorCommands(); break;
    }
    return;
  }

  // No engine run yet (the team-absent case is handled by the earlier stages).
  if (opts.nonInteractive) {
    out("  Next: compile the manifest and start the engine:");
    command(`npx forge-launcher ${engineRunArgs().join(" ")}`);
    return;
  }
  await engineDecision(opts);
  if (state.engineStarted) return;
  const open = await promptYesNo(`Open the ${state.harnessLabel} CLI to build manually now?`, "n");
  if (open === "y") await openCliFor(autobuildCommand());
}

function resumeSummary(): void {
  out("");
  out("════════════════════════════════════════════════════════");
  out("  forge-launcher resume: where to pick up");
  out("════════════════════════════════════════════════════════");
  out("");
  out(`  Repository  : ${link(state.repoDir)}`);
  out(`  Harness     : ${state.harnessLabel}`);
  const ideaPath = path.join(state.repoDir, "docs", "IDEA.md");
  out(`  Idea file   : ${fs.existsSync(ideaPath) ? link(ideaPath) : "none"}`);
  out(`  PRD         : ${hasPrd() ? link(path.join(state.repoDir, "docs", "PRD.md")) : "none"}`);
  out(`  Agent team  : ${hasGeneratedTeam() ? link(harnessAgentsDir() + "/") : "none"}`);
  out("");
  out("  Next steps:");
  out("");
  if (state.engineStarted) {
    out(`  1. The workflow engine is building in the background.`);
    out(`     Monitor: tail -f ${path.join(state.repoDir, "docs", "PROGRESS.md")}`);
  } else if (!hasPrd()) {
    out(`  1. Run forge-launcher to continue: forge-launcher`);
  } else if (!hasGeneratedTeam()) {
    out(`  1. Generate the agent team: open the harness and run /forge-build-agent-team`);
  } else {
    out(`  1. Build: npx forge-launcher ${engineRunArgs().join(" ")}`);
    out(`  2. Or in the harness: ${autobuildCommand()}`);
  }
  out("");
}

/**
 * Re-enters an existing forge project at its current stage (idea → PRD → team →
 * build) so a run paused for review can be picked up later. Full interactive
 * wizard in a TTY; prints state + exact next commands with --non-interactive.
 */
export async function runResume(opts: ResumeOptions = {}): Promise<number> {
  prompts.nonInteractive = Boolean(opts.nonInteractive);
  const repoDir = opts.repo ? path.resolve(opts.repo) : detectRepoRoot();
  if (!fs.existsSync(path.join(repoDir, ".git"))) {
    fail(`Not a git repository: ${repoDir}`);
    out("");
    info("Run forge-launcher to create and bootstrap a new project first.");
    return 1;
  }
  setupStateForRepo(repoDir);

  printResumeWhere();

  let go = await resumeIdeaStep(opts);
  if (!go) { resumeSummary(); return 0; }
  go = await resumePrdStep(opts);
  if (!go) { resumeSummary(); return 0; }
  go = await resumeTeamStep(opts);
  if (!go) { resumeSummary(); return 0; }
  await resumeEngineStep(opts);
  resumeSummary();
  return 0;
}

// --- Step 9: Summary -------------------------------------------------------

function completionSummary(): void {
  step("Step 9 of 9: Summary");
  out("");
  out("════════════════════════════════════════════════════════");
  out("  forge-launcher: Complete");
  out("════════════════════════════════════════════════════════");
  out("");
  out(`  Repository  : ${state.repoDir}`);
  out(`  Harness     : ${state.harnessLabel} (--harness ${state.harness})`);
  out(`  Remote      : ${state.remoteCreated ? "yes" : "none configured"}`);
  out(`  Idea file   : ${path.join(state.repoDir, "docs", "IDEA.md")}`);
  out(`  PRD         : ${state.prdAdded ? path.join(state.repoDir, "docs", "PRD.md") : "none (will be built from docs/IDEA.md by forge-auto-build-prd)"}`);
  out(`  Research    : ${state.researchAdded ? path.join(state.repoDir, "docs", "research") + "/" : "none"}`);
  out("");
  out("  Next steps:");
  out("");
  if (state.engineStarted) {
    const engineHarness = process.env.FORGE_ENGINE_HARNESS ?? "opencode";
    out("  1. The workflow engine is building the project in the background");
    out("     (it keeps running after this launcher exits).");
    out("  2. Monitor progress from another terminal:");
    out("");
    out(`       tail -f ${path.join(state.repoDir, "docs", "engine-run.log")}`);
    out(`       tail -f ${path.join(state.repoDir, "docs", "PROGRESS.md")}`);
    out("");
    out(`  3. Re-run or resume the engine later if needed:`);
    out("");
    out(`       npx forge-launcher ${engineRunArgs().join(" ")}`);
    if (state.engineConfig.viz) {
      out("");
      out("  The Forge Board dashboard launches with the engine run; its URL");
      out("  is printed in docs/engine-run.log once the manifest is prepared.");
    }
  } else {
    out("  1. Open the project in your agent harness.");
    out("  2. Run the queued command:");
    out("");
    out(`       ${autobuildCommand()}`);
    out("");
    if (hasPrd() && hasGeneratedTeam()) {
      out("     (/forge-orchestrate-build drives the interactive build; use");
      out("      forge-launcher engine-run for autonomous execution instead.)");
    } else {
      out("  3. Review the pre-flight summary that the skill presents.");
      out("  4. Type GO to start the pipeline (add --workflow-engine to run the");
      out("     build through the workflow engine once the agent team is generated).");
    }
  }
  out("");
  out("  References:");
  out(`   • Prompt playbook : ${path.join(state.repoDir, "docs", "prompt-playbook.md")}`);
  const skillsRoot = state.harness === "github" ? ".github" : state.harness === "claude" ? ".claude" : state.harness === "opencode" ? ".opencode" : ".agents";
  out(`   • project-orchestrator   : ${path.join(state.repoDir, skillsRoot, "skills", "forge-orchestrate-build", "SKILL.md")}`);
  out(`   • workflow-engine        : ${path.join(state.repoDir, skillsRoot, "skills", "forge-workflow-engine", "SKILL.md")}`);
  out(`   • forge-auto-build-prd   : ${path.join(state.repoDir, skillsRoot, "skills", "forge-auto-build-prd", "SKILL.md")}`);
  out(`   • forge-auto-build       : ${path.join(state.repoDir, skillsRoot, "skills", "forge-auto-build", "SKILL.md")} (terminal/headless fast-path)`);
  out("       (paths may vary by harness)");
  out("");
}

// --- Entry -----------------------------------------------------------------

export async function runLauncher(opts: LauncherOptions = {}): Promise<number> {
  prompts.nonInteractive = Boolean(opts.nonInteractive);
  stopped = false;

  header();
  try {
    await preflightCheck();
    await selectHarness(opts);
    await createRepo(opts);
    await bootstrapForge(opts);
    await captureIdea(opts);
    await pauseForResume(opts, "idea captured");
    if (stopped) { resumeSummary(); return 0; }
    await addPrdAndResearch(opts);
    await pauseForResume(opts, "PRD added or skipped");
    if (stopped) { resumeSummary(); return 0; }
    await commitBootstrap();
    await launchAutobuild(opts);
    if (stopped) { resumeSummary(); return 0; }
    completionSummary();
    return 0;
  } catch (err) {
    if (err instanceof Error && err.message === "pre-flight failed") return 1;
    if (opts.dryRun) {
      warn(`Dry-run: stopped before executing: ${(err as Error).message}`);
      return 0;
    }
    throw err;
  }
}
