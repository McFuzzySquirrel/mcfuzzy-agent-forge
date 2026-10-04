import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  loadEngineConfig,
  assertEngineHarnessAvailable,
  normaliseExecutionMode,
  normaliseSelectedTaskIds,
  normaliseSelectionScope,
} from "../engine-config.ts";
import { repositoryLogFile } from "../bootstrap.ts";
import { spawnDetached } from "../format.ts";
import { jobResultPath } from "./jobs.ts";
import { jobRunnerCommand } from "../job-runner.ts";
import { AUTHORING_STAGES, validateAuthoringConfig } from "../authoring-config.ts";
import { engineDetachedCommand } from "../launcher.ts";
import { currentJobForRepo, startJob, updateJob } from "./jobs.ts";
import { findEngineDir, inferEngineHarness, repoPaths, upsertProject } from "./paths.ts";
import { authoringBlocker, isPidAlive, refreshJobs, resetChangedCompletedTasks } from "./repo.ts";
import type { RederiveStepId } from "../rederive-state.ts";
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
  onStartupError?: (error: Error) => void;
}

export interface SpawnResult {
  pid?: number;
}

export type Spawner = (cmd: string, args: string[], opts: SpawnOptions) => SpawnResult;

export interface ControlDeps {
  spawner?: Spawner;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  isPidAlive?: (pid: number | null) => boolean;
}

function defaultSpawner(cmd: string, args: string[], opts: SpawnOptions): SpawnResult {
  return spawnDetached(cmd, args, opts);
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
  const harness = process.env.FORGE_ENGINE_HARNESS ?? cfg?.harness ?? inferEngineHarness(repoRoot);
  assertEngineHarnessAvailable(harness);
  const args = ["engine-run", "--repo", repoRoot, "--harness", harness];
  // The numeric settings are numbers in engine-config.json but strings in argv;
  // passing one through raw makes the job runner's argv scanning throw on
  // `startsWith`, so a Console-started run with a configured concurrency, task
  // timeout, or retry count could not be launched at all.
  if (cfg?.granularity) args.push("--granularity", String(cfg.granularity));
  if (cfg?.concurrency) args.push("--concurrency", String(cfg.concurrency));
  if (cfg?.taskTimeoutMs) args.push("--task-timeout-ms", String(cfg.taskTimeoutMs));
  if (cfg?.maxRetries) args.push("--max-retries", String(cfg.maxRetries));
  if (cfg?.autoCommit === false) args.push("--no-auto-commit");
  args.push(cfg?.logHarnessActivity ? "--log-harness-activity" : "--no-log-harness-activity");
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
  private readonly isPidAlive: (pid: number | null) => boolean;

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
    this.isPidAlive = deps.isPidAlive ?? isPidAlive;
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
    refreshJobs();
    const blocker = authoringBlocker(this.p);
    if (blocker) return { ok: false, message: blocker };
    const logFile = this.p.logPath;
    const { cmd, args } = engineDetachedCommand(engineRunArgs(this.repoRoot));
    const job = this.launchJob(jobType, "Engine started in the background.", cmd, args, logFile);
    const { pid } = job;
    return { ok: job.status !== "failed", message: job.message, pid, job };
  }

  private launchJob(
    type: Parameters<typeof startJob>[0]["type"],
    message: string,
    cmd: string,
    args: string[],
    logFile: string,
    extra: { taskId?: string; run?: boolean; autoDraft?: boolean } = {},
    options: { cwd?: string; repoPath?: string; env?: NodeJS.ProcessEnv } = {},
  ) {
    const target = options.repoPath ?? this.repoRoot;
    const active = currentJobForRepo(target);
    if (active?.status === "running" && this.isPidAlive(active.pid ?? null)) {
      throw new Error(`A ${active.type} job is already running in this repository.`);
    }
    const id = randomUUID();
    const resultPath = jobResultPath(id);
    const wrapped = jobRunnerCommand(cmd, args, resultPath, id);
    let startupError: Error | undefined;
    let jobId: string | undefined;
    const result = this.spawner(wrapped.cmd, wrapped.args, {
      cwd: options.cwd ?? this.repoRoot,
      env: options.env,
      logFile,
      onStartupError: (error) => {
        startupError = error;
        if (jobId) updateJob(jobId, { status: "failed", message: `Failed to start background job: ${error.message}`, finishedAt: new Date().toISOString() });
      },
    });
    if (!result.pid && !startupError) startupError = new Error("The background process did not provide a PID.");
    const job = startJob({
      id,
      type,
      repoPath: options.repoPath ?? this.repoRoot,
      pid: result.pid,
      logPath: logFile,
      resultPath,
      message,
      ...extra,
    });
    jobId = job.id;
    if (startupError) {
      return updateJob(job.id, {
        status: "failed",
        message: `Failed to start background job: ${startupError.message}`,
        finishedAt: new Date().toISOString(),
      }) ?? job;
    }
    return job;
  }

  /** Spawns a headless launcher pipeline step (draft-team / draft-skills). */
  private draft(action: "draft-team" | "draft-skills", label: string): ControlResult {
    const { cmd, args } = engineDetachedCommand([action, "--repo", this.repoRoot]);
    const job = this.launchJob(action, `${label} started in the background.`, cmd, args, this.p.logPath);
    const { pid } = job;
    return { ok: job.status !== "failed", message: job.message, pid, job };
  }

  /** ADR-060: requirements authoring is always interactive. Retained so an
   * older Console client gets guidance instead of a 400. */
  draftPrd(): ControlResult {
    return interactiveRequirements();
  }

  /** ADR-060: see `draftPrd`. */
  draftExistingPrd(): ControlResult {
    return interactiveRequirements();
  }

  draftTeam(): ControlResult {
    return this.draft("draft-team", "Agent team generation");
  }

  draftSkills(): ControlResult {
    return this.draft("draft-skills", "Project-skill generation");
  }

  /**
   * Regenerates the agent team, project skills, and execution manifest as one
   * chain, so a user who changed the PRD does not have to discover and run each
   * stale stage by hand. `from` restarts at a named step, which is how the UI
   * retries a chain that failed partway through.
   */
  rederive(from?: RederiveStepId): ControlResult {
    refreshJobs();
    const active = currentJobForRepo(this.repoRoot);
    if (active?.status === "running" && this.isPidAlive(active.pid ?? null)) {
      return { ok: false, message: `A ${active.type} job is already running in this repository.` };
    }
    // ADR-060: the chain never authors requirements, so a project without a
    // committed PRD and features cannot be re-derived at all. Say so here rather
    // than letting the job start and fail on its first step.
    const p = this.p;
    const hasFeatures = fs.existsSync(p.featuresDir) && fs.statSync(p.featuresDir).isDirectory() &&
      fs.readdirSync(p.featuresDir).some((file) => file.endsWith(".md"));
    if (!fs.existsSync(p.visionPath) || !hasFeatures) {
      return {
        ok: false,
        message: "Requirements authoring is always interactive and cannot be re-derived headlessly. "
          + "Use the primary action on the Overview pipeline card to open the authoring session in a terminal.",
      };
    }
    const args = ["rederive", "--repo", this.repoRoot];
    if (from) args.push("--from", from);
    const { cmd, args: fullArgs } = engineDetachedCommand(args);
    const job = this.launchJob("rederive", "Re-deriving the team, project skills, and manifest.", cmd, fullArgs, p.logPath);
    return { ok: job.status !== "failed", message: job.message, pid: job.pid, job };
  }

  /** ADR-060: a feature document is requirements, so it needs a session too. */
  featurePrd(): ControlResult {
    return interactiveRequirements();
  }

  /** ADR-060: a feature document is requirements, so the feature stage needs a
   * session. The stages after it (team, skills, manifest, build) are headless
   * derivations and do run unattended once the feature document is committed;
   * the CLI `feature-increment` subcommand advances them. */
  featureIncrement(): ControlResult {
    return interactiveRequirements();
  }

  continueFeatureIncrement(): ControlResult {
    const { cmd, args } = engineDetachedCommand(["feature-increment-continue", "--repo", this.repoRoot]);
    const job = this.launchJob("feature-increment", "Feature increment preparation started.", cmd, args, this.p.logPath);
    return { ok: job.status !== "failed", message: job.message, pid: job.pid, job };
  }

  bootstrap(req: { path: string; harness?: string; force?: boolean; initGit?: boolean; runner?: string }): ControlResult {
    const target = path.resolve(req.path);
    const logFile = repositoryLogFile(target);
    const args = ["bootstrap", target];
    if (req.harness) args.push("--harness", req.harness);
    if (req.force) args.push("--force");
    if (req.initGit) args.push("--init-git");
    if (req.runner) args.push("--runner", req.runner);
    const { cmd, args: fullArgs } = engineDetachedCommand(args);
    const job = this.launchJob(
      "bootstrap",
      "Repository bootstrap started in the background.",
      cmd,
      fullArgs,
      logFile,
      {},
      { cwd: target, repoPath: target },
    );
    const { pid } = job;
    upsertProject({ path: target });
    return { ok: job.status !== "failed", message: job.message, pid, job };
  }

  compileManifest(): ControlResult {
    refreshJobs();
    const blocker = authoringBlocker(this.p);
    if (blocker) return { ok: false, message: blocker };
    const { cmd, args } = engineDetachedCommand(["compile-manifest", "--repo", this.repoRoot]);
    const job = this.launchJob(
      "compile-manifest",
      "Manifest compile started in the background.",
      cmd,
      args,
      this.p.logPath,
    );
    const { pid } = job;
    return { ok: job.status !== "failed", message: job.message, pid, job };
  }

  replay(taskId: string): ControlResult {
    refreshJobs();
    const blocker = authoringBlocker(this.p);
    if (blocker) return { ok: false, message: blocker };
    const harness = process.env.FORGE_ENGINE_HARNESS ?? loadEngineConfig(this.repoRoot)?.harness ?? inferEngineHarness(this.repoRoot);
    assertEngineHarnessAvailable(harness);
    const engineDir = findEngineDir(this.repoRoot);
    if (!engineDir) {
      return { ok: false, message: "forge-workflow-engine not found under this repo; cannot replay." };
    }
    const replayArgs = ["run", "workflow-engine", "--", "replay", taskId, "--repo", this.repoRoot, "--harness", harness];
    const job = this.launchJob(
      "engine-replay",
      `Replay of ${taskId} started in the background.`,
      "npm",
      replayArgs,
      this.p.logPath,
      { taskId },
      { cwd: engineDir },
    );
    const { pid } = job;
    return { ok: job.status !== "failed", message: job.message, pid, job };
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
    const launcherArgs = ["--non-interactive"];
    if (req.authoringConfig) {
      const config = validateAuthoringConfig(req.authoringConfig);
      for (const stage of AUTHORING_STAGES) launcherArgs.push(`--${stage}-model`, config.models[stage] ?? "inherit");
      if (config.runner) launcherArgs.push("--runner", config.runner);
    }
    const { cmd, args } = engineDetachedCommand(launcherArgs);
    const repoDir = path.join(parentDir, req.name);
    const job = this.launchJob(
      "create-project",
      req.autoDraft
        ? "Project creation started in the background (PRD, team, and project-skills authoring enabled)."
        : "Project creation started in the background.",
      cmd,
      args,
      logFile,
      { autoDraft: req.autoDraft },
      { cwd: parentDir, repoPath: repoDir, env },
    );
    const { pid } = job;
    upsertProject({ path: repoDir, name: req.name, harness: req.harness });
    const message = job.message;

    return {
      ok: job.status !== "failed",
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

  dispatch(action: ControlAction, taskId?: string, from?: RederiveStepId): ControlResult {
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
      case "reset-changed": {
        const result = resetChangedCompletedTasks(this.p);
        return { ok: result.ok, message: result.message };
      }
      case "draft-prd":
      case "draft-existing-prd": return interactiveRequirements();
      case "draft-team": return this.draftTeam();
      case "draft-skills": return this.draftSkills();
      case "rederive": return this.rederive(from);
      case "feature-prd": return interactiveRequirements();
      case "feature-increment": return this.featureIncrement();
      case "feature-increment-continue": return this.continueFeatureIncrement();
      case "compile-manifest": return this.compileManifest();
      default: return { ok: false, message: `Unknown action: ${action}` };
    }
  }
}

/** ADR-060: a requirements stage cannot be a background job. Point the caller at
 * the interactive session the Overview pipeline card offers as its primary action. */
function interactiveRequirements(): ControlResult {
  return {
    ok: false,
    message: "Requirements authoring is always interactive, so it is not run as a background job. "
      + "Use the primary action on the Overview pipeline card to open the authoring session in a terminal, "
      + "then come back - the team, project-skill and build stages still run headless.",
  };
}

function harnessChoice(harness?: string): string {
  switch (harness) {
    case "github": return "1";
    case "opencode": return "2";
    case "claude": return "3";
    default: return "4";
  }
}
