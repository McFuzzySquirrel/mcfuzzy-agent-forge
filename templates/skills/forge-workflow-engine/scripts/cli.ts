#!/usr/bin/env node
import { dirname, join, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import * as readline from "node:readline";

import { runEngine, replayTask } from "./engine.ts";
import { loadState, statePath, auditPath } from "./state.ts";
import { OpenCodeAdapter } from "./harness/opencode-adapter.ts";
import { CopilotAdapter } from "./harness/copilot-adapter.ts";
import { OpenAIAdapter } from "./harness/openai-adapter.ts";
import { StubAdapter } from "./harness/stub-adapter.ts";
import { FlowForgeKernelAdapter } from "./harness/flowforge-kernel-adapter.ts";
import type { ExecutionManifest, HarnessAdapter, EngineOptions } from "./types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function usage(): never {
  console.log(`forge-workflow-engine

Usage:
  npm run workflow-engine -- run     [--repo <path>] [--harness opencode|copilot|openai|stub|flowforge-kernel]
                                     [--max-retries <n>] [--retry-delay-ms <ms>] [--heartbeat-ms <ms>] [--concurrency <n>] [--yes]
  npm run workflow-engine -- status  [--repo <path>]
  npm run workflow-engine -- replay  <task-id> [--repo <path>] [--harness opencode|copilot|openai|stub|flowforge-kernel]
  npm run workflow-engine -- pause   [--repo <path>]

Environment variables:
  FORGE_ENGINE_YES      Skip the pre-run confirmation gate (same as --yes)
  FORGE_ENGINE_HEARTBEAT_MS  Heartbeat interval in ms while a task runs (default: 15000)
  FORGE_ENGINE_CONCURRENCY   Max ready tasks to run in parallel (default: 1; ignored unless harness supports concurrency)
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

function resolveHarness(name: string | undefined): HarnessAdapter {
  switch (name ?? "opencode") {
    case "opencode": return new OpenCodeAdapter();
    case "copilot": return new CopilotAdapter();
    case "openai": return new OpenAIAdapter();
    case "stub": return new StubAdapter();
    case "flowforge-kernel": return new FlowForgeKernelAdapter();
    default:
      console.error(`Unknown harness: '${name}'. Choose opencode, copilot, openai, stub, or flowforge-kernel.`);
      process.exit(1);
  }
}

function buildOptions(args: string[], harnessName?: string): EngineOptions {
  const repoArg = flag(args, "--repo");
  const repoRoot = repoArg ? resolve(repoArg) : detectRepoRoot();
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
    harness: resolveHarness(harnessName ?? flag(args, "--harness")),
    maxRetries: Number(flag(args, "--max-retries") ?? "2"),
    retryDelayMs: Number(flag(args, "--retry-delay-ms") ?? "5000"),
    heartbeatMs: Number(flag(args, "--heartbeat-ms") ?? process.env["FORGE_ENGINE_HEARTBEAT_MS"] ?? "15000"),
    maxConcurrency: Number(flag(args, "--concurrency") ?? process.env["FORGE_ENGINE_CONCURRENCY"] ?? "1"),
    pauseRequested: false,
  };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

// Presents the pre-run gate. Skipped when `--yes` or FORGE_ENGINE_YES=1 is set,
// or when stdin is not a TTY (CI / headless) - the gate is interactive-only.
async function confirmPreRun(opts: EngineOptions, args: string[]): Promise<void> {
  const manifest = JSON.parse(readFileSync(opts.manifestPath, "utf8")) as ExecutionManifest;
  const taskCount = manifest.phases.reduce((n, p) => n + (p.tasks?.length ?? 0), 0);
  const skip = hasFlag(args, "--yes") || process.env["FORGE_ENGINE_YES"] === "1";

  console.log("Forge Workflow Engine - Pre-run Summary");
  console.log(`  Harness : ${opts.harness.name}`);
  console.log(`  Phases  : ${manifest.phases.length}`);
  console.log(`  Tasks   : ${taskCount}`);
  console.log(`  Manifest: ${opts.manifestPath}`);

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
  const opts = buildOptions(args);
  await confirmPreRun(opts, args);
  const state = await runEngine(opts);

  console.log(`\nRun ${state.runId} finished with status: ${state.status}`);
  const completed = Object.values(state.tasks).filter((t) => t.status === "complete").length;
  const total = Object.keys(state.tasks).length;
  console.log(`Tasks: ${completed}/${total} complete`);

  if (state.blockers.length > 0) {
    console.log(`Blockers:`);
    for (const b of state.blockers) console.log(`  - ${b}`);
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

  console.log(JSON.stringify({
    runId: state.runId,
    status: state.status,
    harness: state.harness,
    startedAt: state.startedAt,
    lastUpdatedAt: state.lastUpdatedAt,
    currentPhase: state.currentPhase,
    taskSummary: byStatus,
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
  const opts = buildOptions(rest);
  const state = await replayTask(taskId, opts);
  const record = state.tasks[taskId];
  console.log(`Replay of task ${taskId}: ${record?.status}`);
  if (record?.errorMessage) console.error(`Error: ${record.errorMessage}`);
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
  console.log(`Workflow ${paused.runId} paused.`);
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
    default: usage();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
