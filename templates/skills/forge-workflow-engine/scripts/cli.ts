#!/usr/bin/env node
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import * as readline from "node:readline";

import { runEngine, replayTask } from "./engine.ts";
import { loadState, statePath, auditPath } from "./state.ts";
import { startVizServer, type VizServer } from "./viz/server.ts";
import { controlPath, pidPath, readPid, removePid, writeControl, writePid } from "./control.ts";
import { DEFAULT_TASK_TIMEOUT_MS, DEFAULT_HEARTBEAT_MS, type ExecutionManifest, type HarnessAdapter, type EngineOptions } from "./types.ts";
import { OpenCodeAdapter } from "./harness/opencode-adapter.ts";
import { CopilotAdapter } from "./harness/copilot-adapter.ts";
import { OpenAIAdapter } from "./harness/openai-adapter.ts";
import { StubAdapter } from "./harness/stub-adapter.ts";
import { FlowForgeKernelAdapter } from "./harness/flowforge-kernel-adapter.ts";
import { startAttachServer } from "./harness/opencode-server.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function usage(): never {
  console.log(`forge-workflow-engine

Usage:
  npm run workflow-engine -- run     [--repo <path>] [--harness opencode|copilot|openai|stub|flowforge-kernel]
                                     [--max-retries <n>] [--retry-delay-ms <ms>] [--heartbeat-ms <ms>] [--concurrency <n>] [--task-timeout-ms <ms>] [--yes]
                                     [--allow-noop] [--run-validation]
                                     [--auto-commit|--no-auto-commit] [--commit-message-template <tmpl>]
                                     [--viz [port]] [--no-open]
                                     [--keep-alive] [--keep-alive-port <port>] [--attach <url>] [--no-keep-alive]
  npm run workflow-engine -- status  [--repo <path>]
  npm run workflow-engine -- replay  <task-id> [--repo <path>] [--harness opencode|copilot|openai|stub|flowforge-kernel]
  npm run workflow-engine -- pause   [--repo <path>]
  npm run workflow-engine -- stop    [--repo <path>]
  npm run workflow-engine -- viz     [--repo <path>] [--port <port>] [--no-open]

Environment variables:
  FORGE_ENGINE_YES      Skip the pre-run confirmation gate (same as --yes)
  FORGE_ENGINE_HEARTBEAT_MS  Heartbeat interval in ms while a task runs (default: 60000)
  FORGE_ENGINE_CONCURRENCY   Max ready tasks to run in parallel (default: 1; ignored unless harness supports concurrency)
  FORGE_ENGINE_TASK_TIMEOUT_MS   Per-task timeout in ms (default: 600000 / 10 min; per-task manifest timeoutMs overrides)
  FORGE_ENGINE_ALLOW_NOOP        "1" to allow tasks that produce no expected outputs, no file changes, and only
                                 trivial agent output to count as complete (bypasses the no-op output gate)
  FORGE_ENGINE_RUN_VALIDATION    "1" to execute each task's manifest validationCommands and require them to pass
                                 before the task is marked complete
  FORGE_ENGINE_AUTO_COMMIT        "0" to disable auto-commit after each completed task (default: 1)
  FORGE_ENGINE_COMMIT_MESSAGE_TEMPLATE  Commit message template with {taskId}/{taskTitle} placeholders
                                 (default: feat(forge-engine): complete task {taskId} - {taskTitle})
  FORGE_ENGINE_ATTACH   "1" to force the opencode keep-alive server for the run (same as --keep-alive);
                        "0" to force cold start per task (same as --no-keep-alive); unset = adaptive
                        (keep-alive when more than one task remains, cold start otherwise)
  FORGE_ENGINE_ATTACH_URL   Attach tasks to an existing opencode serve instance instead of cold-starting per task

Pause & stop:
  pause writes a pause request (docs/engine-control.json) - a live engine stops after
  the current task and saves state as paused; run resumes from the last completed task.
  stop does the same and additionally sends SIGTERM to the engine PID recorded in
  docs/engine.pid, so a live run stops even mid-task (still gracefully after the current task).

  OPENCODE_BIN           Path to opencode binary (default: opencode)
  OPENCODE_EXTRA_FLAGS   Extra flags passed to opencode run
  COPILOT_BIN            Path to copilot binary (default: copilot)
  COPILOT_EXTRA_FLAGS    Extra flags passed to copilot -p (e.g. "--model gpt-4o")
  OPENAI_API_KEY         Required for --harness openai
  OPENAI_BASE_URL        OpenAI API base URL (default: https://api.openai.com/v1)
  OPENAI_MODEL           Model override for OpenAI adapter (default: gpt-4o)
  STUB_FAIL_TASK_IDS     Comma-separated task IDs to fail in stub adapter
  STUB_DELAY_MS          Simulated latency for stub adapter
  FLOWFORGE_KERNEL_BIN               FlowForge CLI binary (default: flowforge)
  FLOWFORGE_WORKFORCE_PATH           Optional override for compiled .workforce directory
  FLOWFORGE_WORKFLOW_ID              Workflow id in workforce package (default: forge-build)
  FLOWFORGE_KERNEL_MOCK              Use --mock when invoking FlowForge CLI (default: false)
  FLOWFORGE_KERNEL_EXTRA_FLAGS       Extra flags appended to FlowForge kernel command
  FLOWFORGE_KERNEL_COMMAND_ARGS_JSON Optional JSON array of args with placeholders
  FLOWFORGE_VALIDATE_WORKFORCE       Validate workforce before run (default: true)
`);
  process.exit(1);
}

function flag(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === name) return args[i + 1];
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

/**
 * Parse the optional `--viz [port]` flag (also `--viz=<port>`). Returns the
 * requested port, or `undefined` when `--viz` is absent. `undefined` means
 * "use the server default"; pass a sentinel to distinguish "absent" from
 * "present without a value", which both default to the server's default port.
 */
function vizPortFor(args: string[]): number | undefined {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg === "--viz") {
      const next = args[i + 1];
      if (next && /^\d+$/.test(next)) return Number(next);
      return undefined;
    }
    if (arg.startsWith("--viz=")) {
      const value = arg.slice("--viz=".length);
      if (/^\d+$/.test(value)) return Number(value);
      return undefined;
    }
  }
  return undefined;
}

/** True when the user explicitly disabled auto-opening the browser. */
function hasVizFlag(args: string[]): boolean {
  return args.includes("--viz") || args.some((a) => a.startsWith("--viz="));
}

function detectRepoRoot(start = process.cwd()): string {
  let current = resolve(start);
  for (let depth = 0; depth < 12; depth++) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(start);
}

import { shouldKeepAlive, remainingTaskCount, type KeepAliveDecision } from "./keepalive.ts";

function resolveHarness(name: string | undefined, attachUrl?: string): HarnessAdapter {
  switch (name ?? "opencode") {
    case "opencode": return new OpenCodeAdapter({ attachUrl });
    case "copilot": return new CopilotAdapter();
    case "openai": return new OpenAIAdapter();
    case "stub": return new StubAdapter();
    case "flowforge-kernel": return new FlowForgeKernelAdapter();
    default:
      console.error(`Unknown harness: '${name}'. Choose opencode, copilot, openai, stub, or flowforge-kernel.`);
      process.exit(1);
  }
}

function buildOptions(
  args: string[],
  repoRoot: string,
  harnessName?: string,
  attachUrl?: string,
): EngineOptions {
  const manifestPath = join(repoRoot, "docs", "EXECUTION-MANIFEST.json");

  if (!existsSync(manifestPath)) {
    console.error(`Execution manifest not found at ${manifestPath}`);
    console.error(`Run the forge-execution-adapter first: npm run forge-execution-adapter -- compile`);
    process.exit(1);
  }

  return {
    repoRoot,
    manifestPath,
    statePath: statePath(repoRoot),
    progressPath: join(repoRoot, "docs", "PROGRESS.md"),
    auditPath: auditPath(repoRoot),
    artifactsPath: join(repoRoot, "docs", "artifacts"),
    controlPath: controlPath(repoRoot),
    pidPath: pidPath(repoRoot),
    harness: resolveHarness(harnessName ?? flag(args, "--harness"), attachUrl),
    maxRetries: Number(flag(args, "--max-retries") ?? "2"),
    retryDelayMs: Number(flag(args, "--retry-delay-ms") ?? "5000"),
    heartbeatMs: Number(flag(args, "--heartbeat-ms") ?? process.env["FORGE_ENGINE_HEARTBEAT_MS"] ?? String(DEFAULT_HEARTBEAT_MS)),
    maxConcurrency: Number(flag(args, "--concurrency") ?? process.env["FORGE_ENGINE_CONCURRENCY"] ?? "1"),
    taskTimeoutMs: Number(flag(args, "--task-timeout-ms") ?? process.env["FORGE_ENGINE_TASK_TIMEOUT_MS"] ?? String(DEFAULT_TASK_TIMEOUT_MS)),
    allowNoop: hasFlag(args, "--allow-noop") || process.env["FORGE_ENGINE_ALLOW_NOOP"] === "1",
    runValidation: hasFlag(args, "--run-validation") || process.env["FORGE_ENGINE_RUN_VALIDATION"] === "1",
    autoCommit: !(hasFlag(args, "--no-auto-commit") || process.env["FORGE_ENGINE_AUTO_COMMIT"] === "0"),
    commitMessageTemplate: flag(args, "--commit-message-template") ?? process.env["FORGE_ENGINE_COMMIT_MESSAGE_TEMPLATE"],
    pauseRequested: false,
  };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

// Presents the pre-run gate. Skipped when `--yes` or FORGE_ENGINE_YES=1 is set,
// or when stdin is not a TTY (CI / headless) - the gate is interactive-only.
async function confirmPreRun(opts: EngineOptions, args: string[], keepAlive?: KeepAliveDecision): Promise<void> {
  const manifest = JSON.parse(readFileSync(opts.manifestPath, "utf8")) as ExecutionManifest;
  const taskCount = manifest.phases.reduce((n, p) => n + (p.tasks?.length ?? 0), 0);
  const skip = hasFlag(args, "--yes") || process.env["FORGE_ENGINE_YES"] === "1";

  const keepAliveLabel = keepAlive
    ? keepAlive.mode === "attach"
      ? "attach to existing server"
      : keepAlive.mode === "keep-alive"
        ? "keep-alive (forced)"
        : keepAlive.mode === "adaptive"
          ? `adaptive (keep-alive, ${keepAlive.remaining} tasks remaining)`
          : keepAlive.remaining > 1
            ? `cold start per task (${keepAlive.remaining} tasks remaining)`
            : "cold start (single task remaining)"
    : "n/a";

  console.log("Forge Workflow Engine - Pre-run Summary");
  console.log(`  Harness : ${opts.harness.name}`);
  console.log(`  Layout  : ${manifest.sourceLayout ?? "monolithic"}`);
  console.log(`  Phases  : ${manifest.phases.length}`);
  console.log(`  Tasks   : ${taskCount}`);
  console.log(`  Timeout : ${opts.taskTimeoutMs}ms per task (--task-timeout-ms / per-task timeoutMs overrides)`);
  console.log(`  Retries : ${opts.maxRetries} max, ${opts.retryDelayMs}ms between attempts (--max-retries / --retry-delay-ms)`);
  console.log(`  Concurrency: ${opts.maxConcurrency} (--concurrency; sequential unless the harness opts in)`);
  console.log(`  Keep-alive: ${keepAliveLabel}`);
  console.log(`  Output gate: ${opts.allowNoop ? "relaxed (--allow-noop: no-op tasks allowed)" : "strict (missing outputs / no-op tasks are retried then failed)"}`);
  if (opts.runValidation) console.log("  Validation: running manifest validationCommands per task (--run-validation)");
  const autoCommitLabel = opts.autoCommit === false
    ? "off (--no-auto-commit)"
    : opts.commitMessageTemplate
      ? "on (one commit per completed task, custom template)"
      : "on (one commit per completed task)";
  console.log(`  Auto-commit: ${autoCommitLabel}`);
  console.log(`  Manifest: ${opts.manifestPath}`);
  if (manifest.featureOrder) console.log(`  Features: ${manifest.featureOrder.join(" → ")}`);
  if (manifest.responsibilityMatrixPath) console.log(`  Matrix  : ${manifest.responsibilityMatrixPath}`);

  if (skip) {
    console.log("Confirmation skipped (--yes / FORGE_ENGINE_YES=1).");
    return;
  }
  if (!process.stdin.isTTY) {
    console.log("Non-interactive stdin detected - starting automatically. Pass --yes to skip this gate explicitly.");
    return;
  }

  const answer = await new Promise<string>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Type "yes" to start dark orchestration, or Ctrl+C to abort: ', (a) => {
      rl.close();
      resolve(a);
    });
  });
  if (answer.trim().toLowerCase() !== "yes") {
    console.log("Aborted.");
    process.exit(0);
  }
}

async function cmdRun(args: string[]): Promise<void> {
  const repoArg = flag(args, "--repo");
  const repoRoot = repoArg ? resolve(repoArg) : detectRepoRoot();
  const harnessName = flag(args, "--harness") ?? process.env["FORGE_ENGINE_HARNESS"] ?? "opencode";
  const manifestPath = join(repoRoot, "docs", "EXECUTION-MANIFEST.json");

  if (!existsSync(manifestPath)) {
    console.error(`Execution manifest not found at ${manifestPath}`);
    console.error(`Run the forge-execution-adapter first: npm run forge-execution-adapter -- compile`);
    process.exit(1);
  }

  // Attach mode: `--attach <url>` reuses an existing opencode serve instance;
  // `--keep-alive` has the engine boot one for the run and tear it down after.
  // Otherwise the engine defaults adaptively: keep-alive when more than one
  // task remains, cold start per task otherwise. `--no-keep-alive` (or
  // FORGE_ENGINE_ATTACH=0) forces the cold-start fallback.
  const attachUrl = flag(args, "--attach") ?? process.env["FORGE_ENGINE_ATTACH_URL"];
  const keepAlive = hasFlag(args, "--keep-alive") || process.env["FORGE_ENGINE_ATTACH"] === "1";
  const noKeepAlive = hasFlag(args, "--no-keep-alive") || process.env["FORGE_ENGINE_ATTACH"] === "0";

  const decision = shouldKeepAlive({
    attachUrl,
    keepAlive,
    noKeepAlive,
    harness: harnessName,
    remaining: remainingTaskCount(manifestPath, statePath(repoRoot)),
  });

  if (decision.mode === "keep-alive" && harnessName !== "opencode") {
    console.warn("[engine] --keep-alive only applies to the opencode harness; ignoring.");
  }

  if (decision.startServer) {
    const port = Number(flag(args, "--keep-alive-port") ?? "0") || undefined;
    const startedAt = Date.now();
    const server = await startAttachServer({
      bin: process.env["OPENCODE_BIN"] ?? "opencode",
      repoRoot,
      port,
    });
    console.log(`[engine] opencode attach server ready at ${server.url} in ${Date.now() - startedAt}ms`);
    await runWithServer(args, repoRoot, harnessName, server.url, decision);
    await server.stop();
    return;
  }

  await runWithServer(args, repoRoot, harnessName, attachUrl, decision);
}

async function runWithServer(
  args: string[],
  repoRoot: string,
  harnessName: string,
  attachUrl: string | undefined,
  decision: KeepAliveDecision,
): Promise<void> {
  const opts = buildOptions(args, repoRoot, harnessName, attachUrl);

  // Stop signal: Ctrl+C / SIGTERM set an in-process flag the engine checks at
  // the top of each task wave (alongside the docs/engine-control.json file).
  // The engine finishes the current task, saves state as `paused`, and exits.
  // `on` (not `once`) so a repeated signal never hits Node's default terminate
  // behavior — the flag is idempotent and the process must survive until the
  // engine has finished its graceful-pause cleanup.
  let signalStopped = false;
  const onStopSignal = (signal: string) => {
    if (signalStopped) return;
    signalStopped = true;
    console.log(`[engine] Received ${signal} - stopping after the current task.`);
  };
  process.on("SIGINT", () => onStopSignal("SIGINT"));
  process.on("SIGTERM", () => onStopSignal("SIGTERM"));

  writePid(opts.pidPath, process.pid);

  let viz: VizServer | undefined;
  try {
    if (hasVizFlag(args)) {
      viz = await startVizServer({
        repoRoot: opts.repoRoot,
        manifestPath: opts.manifestPath,
        statePath: opts.statePath,
        auditPath: opts.auditPath,
        port: vizPortFor(args),
        open: !hasFlag(args, "--no-open"),
        source: "in-process",
      });
    }

    await confirmPreRun(opts, args, decision);

    const state = await runEngine({ ...opts, stopRequested: () => signalStopped });

    console.log(`\nRun ${state.runId} finished with status: ${state.status}`);
    const completed = Object.values(state.tasks).filter((t) => t.status === "complete").length;
    const total = Object.keys(state.tasks).length;
    console.log(`Tasks: ${completed}/${total} complete`);

    const hollow = Object.values(state.tasks).filter(
      (t) => t.status === "complete" && (!t.outputFiles || t.outputFiles.length === 0),
    );
    if (hollow.length > 0) {
      console.warn(`Warning: ${hollow.length} task(s) completed with no recorded output files: ${hollow.map((t) => t.taskId).join(", ")}`);
      console.warn("Verify these tasks actually produced their deliverables before relying on the result.");
    }

    if (state.blockers.length > 0) {
      console.log(`Blockers:`);
      for (const b of state.blockers) console.log(`  - ${b}`);
    }
  } finally {
    removePid(opts.pidPath);
    if (viz) await viz.stop();
  }
}

async function cmdStatus(args: string[]): Promise<void> {
  const repoArg = flag(args, "--repo");
  const repoRoot = repoArg ? resolve(repoArg) : detectRepoRoot();
  const sp = statePath(repoRoot);
  const state = loadState(sp);

  if (!state) {
    console.log("No workflow state found. Run `npm run workflow-engine -- run` first.");
    process.exit(0);
  }

  const tasks = Object.values(state.tasks);
  const byStatus = {
    pending: tasks.filter((t) => t.status === "pending").length,
    running: tasks.filter((t) => t.status === "running").length,
    complete: tasks.filter((t) => t.status === "complete").length,
    failed: tasks.filter((t) => t.status === "failed").length,
    skipped: tasks.filter((t) => t.status === "skipped").length,
  };

  const hollow = tasks.filter((t) => t.status === "complete" && (!t.outputFiles || t.outputFiles.length === 0));

  console.log(JSON.stringify({
    runId: state.runId,
    status: state.status,
    harness: state.harness,
    startedAt: state.startedAt,
    lastUpdatedAt: state.lastUpdatedAt,
    currentPhase: state.currentPhase,
    taskSummary: byStatus,
    completedWithoutOutput: hollow.map((t) => t.taskId),
    failedTasks: tasks.filter((t) => t.status === "failed").map((t) => ({
      taskId: t.taskId,
      attempt: t.attempt,
      errorMessage: t.errorMessage,
    })),
    blockers: state.blockers,
  }, null, 2));
}

async function cmdReplay(args: string[]): Promise<void> {
  const taskId = args[0];
  if (!taskId || taskId.startsWith("--")) {
    console.error("Usage: workflow-engine replay <task-id> [--repo <path>] [--harness <name>]");
    process.exit(1);
  }
  const rest = args.slice(1);
  const repoArg = flag(rest, "--repo");
  const repoRoot = repoArg ? resolve(repoArg) : detectRepoRoot();
  const harnessName = flag(rest, "--harness");
  const attachUrl = flag(rest, "--attach") ?? process.env["FORGE_ENGINE_ATTACH_URL"];
  const opts = buildOptions(rest, repoRoot, harnessName, attachUrl);
  const state = await replayTask(taskId, opts);
  const record = state.tasks[taskId];
  console.log(`Replay of task ${taskId}: ${record?.status}`);
  if (record?.errorMessage) console.error(`Error: ${record.errorMessage}`);
}

async function cmdViz(args: string[]): Promise<void> {
  const repoArg = flag(args, "--repo");
  const repoRoot = repoArg ? resolve(repoArg) : detectRepoRoot();
  const manifestPath = join(repoRoot, "docs", "EXECUTION-MANIFEST.json");

  if (!existsSync(manifestPath)) {
    console.error(`Execution manifest not found at ${manifestPath}`);
    console.error(`Run the forge-execution-adapter first: npm run forge-execution-adapter -- compile`);
    process.exit(1);
  }

  const viz = await startVizServer({
    repoRoot,
    manifestPath,
    statePath: statePath(repoRoot),
    auditPath: auditPath(repoRoot),
    port: vizPortFor(args),
    open: !hasFlag(args, "--no-open"),
    source: "tail",
  });

  console.log(`Attached to workflow-engine run in ${repoRoot}. Press Ctrl+C to stop.`);
  await new Promise<void>(() => {
    process.on("SIGINT", () => {
      viz.stop().then(() => process.exit(0));
    });
  });
}

async function cmdPause(args: string[]): Promise<void> {
  const repoArg = flag(args, "--repo");
  const repoRoot = repoArg ? resolve(repoArg) : detectRepoRoot();
  const sp = statePath(repoRoot);
  const state = loadState(sp);

  if (!state) {
    console.error("No workflow state found.");
    process.exit(1);
  }

  // Write the control file so a live engine picks up the pause at the top of
  // its next task wave (after the current task), then flip the state status for
  // resume-ability even if no engine is running.
  writeControl(controlPath(repoRoot), "pause");

  const { saveState, writeAuditEvent, auditPath: ap, syncProgressMd } = await import("./state.ts");
  const manifestPath = join(repoRoot, "docs", "EXECUTION-MANIFEST.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const paused = { ...state, status: "paused" as const };

  saveState(sp, paused);
  writeAuditEvent(ap(repoRoot), {
    timestamp: new Date().toISOString(),
    action: "run.paused",
    runId: paused.runId,
    note: "Pause requested via CLI",
  });
  syncProgressMd(join(repoRoot, "docs", "PROGRESS.md"), paused, manifest);
  console.log(`Pause requested for workflow ${paused.runId}. The engine will stop after the current task.`);
}

async function cmdStop(args: string[]): Promise<void> {
  const repoArg = flag(args, "--repo");
  const repoRoot = repoArg ? resolve(repoArg) : detectRepoRoot();
  const controlPath_ = controlPath(repoRoot);
  const pid = readPid(pidPath(repoRoot));

  // If a live engine is running (it wrote docs/engine.pid), write the stop
  // request and nudge it with a SIGTERM so the in-process flag trips even
  // mid-wave; it finishes the current task, saves state as paused, and exits.
  if (pid !== null) {
    writeControl(controlPath_, "stop");
    console.log("Stop requested. The engine will stop after the current task.");
    try {
      process.kill(pid, "SIGTERM");
      console.log(`Sent SIGTERM to engine process ${pid}.`);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ESRCH") {
        console.log(`Engine process ${pid} is no longer running; nothing to stop.`);
      } else {
        console.warn(`Could not signal engine process ${pid}: ${err.message}`);
      }
    }
  } else {
    // Nothing running: leave no control file behind (a fresh `run` would clear
    // it anyway). Use `pause` to flip an existing run's state for a clean
    // stop/resume cycle.
    console.log("No running engine found (docs/engine.pid is empty). Nothing to stop.");
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [, , command, ...args] = process.argv;
  if (!command) usage();

  switch (command) {
    case "run": await cmdRun(args); break;
    case "status": await cmdStatus(args); break;
    case "replay": await cmdReplay(args); break;
    case "pause": await cmdPause(args); break;
    case "stop": await cmdStop(args); break;
    case "viz": await cmdViz(args); break;
    default: usage();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
