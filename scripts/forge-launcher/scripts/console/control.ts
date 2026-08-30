import fs from "node:fs";
import path from "node:path";
import spawn from "cross-spawn";

import { loadEngineConfig } from "../engine-config.ts";
import { engineDetachedCommand } from "../launcher.ts";
import { findEngineDir, inferEngineHarness, repoPaths } from "./paths.ts";
import type {
  ControlAction,
  ControlResult,
  CreateProjectRequest,
  CreateProjectResult,
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
    this.repoRoot = repoRoot;
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

  run(): ControlResult {
    const logFile = this.p.logPath;
    const { cmd, args } = engineDetachedCommand(engineRunArgs(this.repoRoot));
    const { pid } = this.spawner(cmd, args, { cwd: this.repoRoot, logFile });
    return { ok: true, message: "Engine started in the background.", pid };
  }

  /** Spawns a headless launcher pipeline step (draft-prd / draft-team). */
  private draft(action: "draft-prd" | "draft-team", label: string): ControlResult {
    const { cmd, args } = engineDetachedCommand([action, "--repo", this.repoRoot]);
    const { pid } = this.spawner(cmd, args, { cwd: this.repoRoot, logFile: this.p.logPath });
    return { ok: true, message: `${label} started in the background.`, pid };
  }

  draftPrd(): ControlResult {
    return this.draft("draft-prd", "PRD draft");
  }

  draftTeam(): ControlResult {
    return this.draft("draft-team", "Agent team generation");
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
    return { ok: true, message: `Replay of ${taskId} started in the background.`, pid };
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
    if (req.autoDraft) env.FORGE_AUTO_DRAFT = "1";

    const logFile = path.join(parentDir, `${req.name}.forge-create.log`);
    const { cmd, args } = engineDetachedCommand(["--non-interactive"]);
    const { pid } = this.spawner(cmd, args, { cwd: parentDir, env, logFile });

    return {
      ok: true,
      message: "Project creation started in the background.",
      repoDir: path.join(parentDir, req.name),
      logFile,
      pid,
    };
  }

  dispatch(action: ControlAction, taskId?: string): ControlResult {
    switch (action) {
      case "pause": return this.pause();
      case "stop": return this.stop();
      case "run":
      case "resume": return this.run();
      case "replay": return taskId ? this.replay(taskId) : { ok: false, message: "replay requires a taskId." };
      case "draft-prd": return this.draftPrd();
      case "draft-team": return this.draftTeam();
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
