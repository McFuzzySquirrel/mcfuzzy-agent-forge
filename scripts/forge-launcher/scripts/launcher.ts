import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrap } from "./bootstrap.ts";
import { command, fail, header, info, ok, out, printLogTail, runCommand, runLogged, runWithHeartbeat, spawnDetached, step, warn } from "./format.ts";
import { expandPath, resolveInputFile } from "./paths.ts";
import { prompt, promptMultiline, promptPath, promptPathLoop, promptSelect, promptYesNo, prompts } from "./prompts.ts";
import { launchCliInTerminal } from "./terminal.ts";

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
  },
};

/** Single tee-log for all long-running step output during this launcher run. */
function runLogFile(): string {
  return path.join(os.tmpdir(), `forge-launcher-${process.pid}.log`);
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

// --- auto-build command selection ------------------------------------------

/** Headless PRD-creation invocation: auto-proceed with defaults, then run the
 * same PRD gap check the manual flow does (acceptance criteria, tech stack,
 * non-functional requirements, phases) and fill any gaps before approving. */
const PRD_HEADLESS_MSG =
  "Use docs/IDEA.md as the project idea. Headless mode: auto-proceed with default assumptions and approve the PRD. After drafting, run a PRD gap check: every major component must have clear acceptance criteria, a defined tech stack, non-functional requirements (performance, security, privacy), and implementation phases; fill any gaps before approving.";

function autobuildCommand(): string {
  return hasPrd()
    ? "/forge-auto-build Use docs/PRD.md as the project PRD"
    : "/forge-auto-build-prd Use docs/IDEA.md as the project idea";
}

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
    out(`    - ${path.join(state.repoDir, "docs", "PRD.md")}`);
    if (fs.existsSync(path.join(state.repoDir, "docs", "product-vision.md"))) {
      out("    - " + path.join(state.repoDir, "docs", "product-vision.md") + " (decomposed) + docs/features/*.md");
    } else {
      out("    - docs/PRD.md is monolithic (no decomposition)");
    }
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
  } catch {
    info("Engine options cancelled; using the current defaults.");
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
    case "2": await configureEngineOptions(opts); printEngineCommand(); break;
    default: info("Skipping the engine for now. Run the build manually or use the printed command later.");
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
    `/${skill} Use ${prdSource} to build the agent team. Auto-proceed with default assumptions and no questions.`,
    opts,
  );
  if (!ran) return;
  await draftCommit("feat: generate auto-drafted agent team");

  if (hasGeneratedTeam()) {
    ok("Agent team generated.");
    out("");
    out("  Review the generated team before building:");
    out(`    - Agents : ${harnessAgentsDir()}/`);
    out(`    - Skills : ${path.dirname(harnessAgentsDir())}/skills/`);
  } else {
    await diagnoseAutoDraftFail(skill);
  }
  await engineDecision(opts);
}

async function autoDraftMenu(opts: LauncherOptions): Promise<void> {
  if (!fs.existsSync(path.join(state.repoDir, "docs", "IDEA.md"))) return;
  await autoDraftPrd(opts);
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
}

// --- Step 4: Bootstrap -----------------------------------------------------

async function bootstrapForge(opts: LauncherOptions): Promise<void> {
  step("Step 4 of 9: Bootstrap Agent Forge");
  info(`Running bootstrap → ${state.repoDir} (--harness ${state.harness}) …`);
  await runWithHeartbeat(
    "Bootstrapping Agent Forge (copying templates)…",
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
  ok("Agent Forge templates bootstrapped.");
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
  await runCommand("git", ["-C", state.repoDir, "commit", "-m", "chore: bootstrap agent forge"]);
  ok("Committed: 'chore: bootstrap agent forge'");

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
    out("  The repository is bootstrapped and ready for forge-auto-build.");
    out("  forge-auto-build will generate the agent team, then execute the build");
    out("  (add 'GO --workflow-engine' at its pre-flight gate to run via the");
    out("  workflow engine instead of the prompt-driven orchestrator).");
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

  if (state.engineStarted) {
    out("");
    info("The workflow engine is already running this build in the background.");
    info("Skipping the interactive CLI launch prompt - no need to run forge-auto-build.");
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
    out(`       npx forge-launcher engine-run --repo "${state.repoDir}" --harness ${engineHarness} --yes`);
    if (state.engineConfig.viz) {
      out("");
      out("  The Forge Board dashboard launches with the engine run; its URL");
      out("  is printed in docs/engine-run.log once the manifest is prepared.");
    }
  } else {
    out("  1. Open the project in your agent harness.");
    out("  2. Run the queued pipeline command:");
    out("");
    out(`       ${autobuildCommand()}`);
    out("");
    out("  3. Review the pre-flight summary that the skill presents.");
    out("  4. Type GO to start the autonomous pipeline (add --workflow-engine to");
    out("     run the build through the workflow engine once the agent team is generated).");
  }
  out("");
  out("  References:");
  out(`   • Prompt playbook : ${path.join(state.repoDir, "docs", "prompt-playbook.md")}`);
  const skillsRoot = state.harness === "github" ? ".github" : state.harness === "claude" ? ".claude" : state.harness === "opencode" ? ".opencode" : ".agents";
  out(`   • forge-auto-build    : ${path.join(state.repoDir, skillsRoot, "skills", "forge-auto-build", "SKILL.md")}`);
  out(`   • forge-auto-build-prd: ${path.join(state.repoDir, skillsRoot, "skills", "forge-auto-build-prd", "SKILL.md")}`);
  out("       (paths may vary by harness)");
  out("");
}

// --- Entry -----------------------------------------------------------------

export async function runLauncher(opts: LauncherOptions = {}): Promise<number> {
  prompts.nonInteractive = Boolean(opts.nonInteractive);

  header();
  try {
    await preflightCheck();
    await selectHarness(opts);
    await createRepo(opts);
    await bootstrapForge(opts);
    await captureIdea(opts);
    await addPrdAndResearch(opts);
    await commitBootstrap();
    await launchAutobuild(opts);
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
