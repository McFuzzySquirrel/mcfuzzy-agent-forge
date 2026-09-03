import fs from "node:fs";
import path from "node:path";
import spawn from "cross-spawn";

import {
  loadEngineConfig,
  normaliseExecutionMode,
  normaliseSelectedTaskIds,
  normaliseSelectionScope,
} from "../engine-config.ts";
import { repositoryLogFile } from "../bootstrap.ts";
import { engineDetachedCommand } from "../launcher.ts";
import { startJob } from "./jobs.ts";
import { findEngineDir, inferEngineHarness, repoPaths, upsertProject } from "./paths.ts";
import type {
  ControlAction,
  ControlResult,
  CreateProjectRequest,
  CreateProjectResult,
  WorkflowState,
} from "./types.ts";

// ─── Spawn seam (testable) ───────────────────────────────────────────────────

export interface SpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logFile?: string;
}

export interface SpawnResult {
  pid?: number;
}

export type Spawner = (cmd: string, args: string[], opts: SpawnOptions) => SpawnResult;

export interface ControlDeps {
  spawner?: Spawner;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
}

function defaultSpawner(cmd: string, args: string[], opts: SpawnOptions): SpawnResult {
  let stdio: Array<"ignore" | number> = ["ignore"];
  if (opts.logFile) {
    fs.mkdirSync(path.dirname(opts.logFile), { recursive: true });
    const fd = fs.openSync(opts.logFile, "a");
    stdio = ["ignore", fd, fd];
  } else {
    stdio = ["ignore", "ignore", "ignore"];
  }
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    detached: true,
    stdio: stdio as never,
  });
  child.on("error", () => {});
  child.unref();
  return { pid: child.pid };
}

function defaultKill(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {
    // process already gone
  }
}

/** Builds the engine-run invocation args (console is the live view, so no --viz). */
function engineRunArgs(repoRoot: string): string[] {
  const cfg = loadEngineConfig(repoRoot);
  const args = ["engine-run", "--repo", repoRoot, "--harness", cfg?.harness ?? inferEngineHarness(repoRoot)];
  if (cfg?.granularity) args.push("--granularity", cfg.granularity);
  if (cfg?.concurrency) args.push("--concurrency", cfg.concurrency);
  if (cfg?.taskTimeoutMs) args.push("--task-timeout-ms", cfg.taskTimeoutMs);
  if (cfg?.maxRetries) args.push("--max-retries", cfg.maxRetries);
  if (cfg?.keepAlive) args.push("--keep-alive");
  if (cfg?.attach) args.push("--attach", cfg.attach);
  if (cfg?.autoCommit === false) args.push("--no-auto-commit");
  const selectedTaskIds = normaliseSelectedTaskIds(cfg?.selectedTaskIds);
  const executionMode = normaliseExecutionMode(cfg?.executionMode);
  const selectionScope = normaliseSelectionScope(cfg?.selectionScope, selectedTaskIds);
  if (executionMode === "manual") {
    args.push("--execution-mode", "manual");
    if (selectionScope) args.push("--selection-scope", selectionScope);
    if (selectedTaskIds.length > 0) args.push("--selected-tasks", selectedTaskIds.join(","));
  }
  args.push("--yes");
  return args;
}

// ─── Controller ──────────────────────────────────────────────────────────────

export class RunController {
  repoRoot: string;
  private readonly spawner: Spawner;
  private readonly kill: (pid: number, signal: NodeJS.Signals) => void;

  constructor(
    repoRoot: string,
    deps: ControlDeps = {},
  ) {
    // Jobs may be created from a relative project selection. Persist one
    // canonical absolute root so their docs log is the same file the Console
    // poller follows.
    this.repoRoot = path.resolve(repoRoot);
    this.spawner = deps.spawner ?? defaultSpawner;
    this.kill = deps.kill ?? defaultKill;
  }

  private get p() {
    return repoPaths(this.repoRoot);
  }

  private writeControl(request: "pause" | "stop"): void {
    fs.mkdirSync(path.dirname(this.p.controlPath), { recursive: true });
    fs.writeFileSync(
      this.p.controlPath,
      `${JSON.stringify({ request, requestedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
  }

  private readPid(): number | null {
    if (!fs.existsSync(this.p.pidPath)) return null;
    const pid = Number(fs.readFileSync(this.p.pidPath, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  }

  pause(): ControlResult {
    this.writeControl("pause");
    return { ok: true, message: "Pause requested; the engine will stop after the current task." };
  }

  stop(): ControlResult {
    this.writeControl("stop");
    const pid = this.readPid();
    if (pid !== null) {
      this.kill(pid, "SIGTERM");
      return { ok: true, message: "Stop requested; the engine will stop after the current task.", pid };
    }
    return { ok: true, message: "Stop request written; no live engine PID found to signal." };
  }

  run(jobType: "engine-run" | "engine-resume" = "engine-run"): ControlResult {
    const logFile = this.p.logPath;
    const { cmd, args } = engineDetachedCommand(engineRunArgs(this.repoRoot));
    const { pid } = this.spawner(cmd, args, { cwd: this.repoRoot, logFile });
    const job = startJob({ type: jobType, repoPath: this.repoRoot, pid, logPath: logFile, message: "Engine started in the background." });
    return { ok: true, message: "Engine started in the background.", pid, job };
  }

  /** Spawns a headless launcher pipeline step (draft-prd / draft-team). */
  private draft(action: "draft-prd" | "draft-team", label: string): ControlResult {
    const { cmd, args } = engineDetachedCommand([action, "--repo", this.repoRoot]);
    const { pid } = this.spawner(cmd, args, { cwd: this.repoRoot, logFile: this.p.logPath });
    const job = startJob({
      type: action,
      repoPath: this.repoRoot,
      pid,
      logPath: this.p.logPath,
      message: `${label} started in the background.`,
    });
    return { ok: true, message: `${label} started in the background.`, pid, job };
  }

  draftPrd(): ControlResult {
    return this.draft("draft-prd", "PRD draft");
  }

  draftTeam(): ControlResult {
    return this.draft("draft-team", "Agent team generation");
  }

  featurePrd(prompt: string): ControlResult {
    const logFile = this.p.logPath;
    const { cmd, args } = engineDetachedCommand(["feature-prd", "--repo", this.repoRoot, "--prompt", prompt]);
    const { pid } = this.spawner(cmd, args, { cwd: this.repoRoot, logFile });
    const job = startJob({ type: "feature-prd", repoPath: this.repoRoot, pid, logPath: logFile, message: "Feature PRD authoring started in the background." });
    return { ok: true, message: "Feature PRD authoring started in the background.", pid, job };
  }

  featureIncrement(prompt: string, run = false): ControlResult {
    const logFile = this.p.logPath;
    const args = ["feature-increment", "--repo", this.repoRoot, "--prompt", prompt];
    if (run) args.push("--run");
    const { cmd, args: fullArgs } = engineDetachedCommand(args);
    const { pid } = this.spawner(cmd, fullArgs, { cwd: this.repoRoot, logFile });
    const message = run ? "Feature increment started in the background and will run the workflow." : "Feature increment preparation started in the background.";
    const job = startJob({ type: "feature-increment", repoPath: this.repoRoot, pid, logPath: logFile, run, message });
    return { ok: true, message, pid, job };
  }

  bootstrap(req: { path: string; harness?: string; force?: boolean; initGit?: boolean }): ControlResult {
    const target = path.resolve(req.path);
    const logFile = repositoryLogFile(target);
    const args = ["bootstrap", target];
    if (req.harness) args.push("--harness", req.harness);
    if (req.force) args.push("--force");
    if (req.initGit) args.push("--init-git");
    const { cmd, args: fullArgs } = engineDetachedCommand(args);
    const { pid } = this.spawner(cmd, fullArgs, { cwd: target, logFile });
    const job = startJob({ type: "bootstrap", repoPath: target, pid, logPath: logFile, message: "Repository bootstrap started in the background." });
    upsertProject({ path: target });
    return { ok: true, message: "Repository bootstrap started in the background.", pid, job };
  }

  compileManifest(): ControlResult {
    const { cmd, args } = engineDetachedCommand(["compile-manifest", "--repo", this.repoRoot]);
    const { pid } = this.spawner(cmd, args, { cwd: this.repoRoot, logFile: this.p.logPath });
    const job = startJob({
      type: "compile-manifest",
      repoPath: this.repoRoot,
      pid,
      logPath: this.p.logPath,
      message: "Manifest compile started in the background.",
    });
    return { ok: true, message: "Manifest compile started in the background.", pid, job };
  }

  replay(taskId: string): ControlResult {
    const engineDir = findEngineDir(this.repoRoot);
    if (!engineDir) {
      return { ok: false, message: "forge-workflow-engine not found under this repo; cannot replay." };
    }
    const { pid } = this.spawner(
      "npm",
      ["run", "workflow-engine", "--", "replay", taskId, "--repo", this.repoRoot],
      { cwd: engineDir, logFile: this.p.logPath },
    );
    const job = startJob({
      type: "engine-replay",
      repoPath: this.repoRoot,
      pid,
      taskId,
      logPath: this.p.logPath,
      message: `Replay of ${taskId} started in the background.`,
    });
    return { ok: true, message: `Replay of ${taskId} started in the background.`, pid, job };
  }

  createProject(req: CreateProjectRequest): CreateProjectResult {
    const parentDir = path.resolve(req.parentDir || process.cwd());
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FORGE_REPO_NAME: req.name,
      FORGE_REPO_PARENT_DIR: parentDir,
      FORGE_REPO_DESCRIPTION: req.description ?? "",
      FORGE_REPO_VISIBILITY: req.visibility === "public" ? "public" : "private",
      FORGE_HARNESS_CHOICE: harnessChoice(req.harness),
      FORGE_IDEA: req.idea,
      FORGE_YN_DEFAULT: "n",
    };
    // Existing PRD + research/seed docs: hand the non-interactive launcher the
    // paths so its Step 6 (addPrdAndResearch) copies them into the new repo,
    // mirroring the terminal flow exactly.
    if (req.prdPath) env.FORGE_PRD_FILE = req.prdPath;
    if (req.researchPaths && req.researchPaths.length > 0) {
      env.FORGE_RESEARCH_FILES = req.researchPaths.join(",");
    }
    if (req.autoDraft) env.FORGE_AUTO_DRAFT = "1";
    if (req.concurrency && req.concurrency > 0) env.FORGE_ENGINE_CONCURRENCY = String(req.concurrency);

    const logFile = path.join(parentDir, `${req.name}.forge-create.log`);
    const { cmd, args } = engineDetachedCommand(["--non-interactive"]);
    const { pid } = this.spawner(cmd, args, { cwd: parentDir, env, logFile });
    const repoDir = path.join(parentDir, req.name);
    upsertProject({ path: repoDir, name: req.name, harness: req.harness });
    const message = req.autoDraft
      ? "Project creation started in the background (auto-draft PRD + team enabled)."
      : "Project creation started in the background.";
    const job = startJob({
      type: "create-project",
      repoPath: repoDir,
      pid,
      logPath: logFile,
      message,
    });

    return {
      ok: true,
      message,
      repoDir,
      logFile,
      pid,
      job,
    };
  }

  private manualSelectionRequiredMessage(action: "run" | "resume"): ControlResult | null {
    const cfg = loadEngineConfig(this.repoRoot);
    if (normaliseExecutionMode(cfg?.executionMode) !== "manual") return null;
    const selectedTaskIds = this.selectedTaskIdsForAction(action, cfg?.selectedTaskIds);
    if (selectedTaskIds.length > 0) return null;
    return {
      ok: false,
      message: `Manual mode is enabled. Select at least one task in Tasks before ${action === "run" ? "running" : "resuming"} the build.`,
    };
  }

  private selectedTaskIdsForAction(action: "run" | "resume", configSelectedTaskIds: unknown): string[] {
    const selectedTaskIds = normaliseSelectedTaskIds(configSelectedTaskIds);
    if (selectedTaskIds.length > 0 || action !== "resume") return selectedTaskIds;
    if (!fs.existsSync(this.p.statePath)) return selectedTaskIds;
    try {
      const state = JSON.parse(fs.readFileSync(this.p.statePath, "utf8")) as WorkflowState;
      if (state.status !== "paused") return selectedTaskIds;
      if (state.selection?.mode !== "manual") return selectedTaskIds;
      return normaliseSelectedTaskIds(state.selection.taskIds);
    } catch {
      return selectedTaskIds;
    }
  }

  dispatch(action: ControlAction, taskId?: string): ControlResult {
    if (action === "run" || action === "resume") {
      const validation = this.manualSelectionRequiredMessage(action);
      if (validation) return validation;
    }
    switch (action) {
      case "pause": return this.pause();
      case "stop": return this.stop();
      case "run": return this.run();
      case "resume": return this.run("engine-resume");
      case "replay": return taskId ? this.replay(taskId) : { ok: false, message: "replay requires a taskId." };
      case "draft-prd": return this.draftPrd();
      case "draft-team": return this.draftTeam();
      case "feature-prd": return this.featurePrd("");
      case "feature-increment": return { ok: false, message: "feature-increment requires a prompt." };
      case "compile-manifest": return this.compileManifest();
      default: return { ok: false, message: `Unknown action: ${action}` };
    }
  }
}

function harnessChoice(harness?: string): string {
  switch (harness) {
    case "github": return "1";
    case "opencode": return "2";
    case "claude": return "3";
    default: return "4";
  }
}
