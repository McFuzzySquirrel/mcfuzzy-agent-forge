import { readFileSync } from "node:fs";

import type {
  AgentDescriptor,
  AuditEvent,
  EngineOptions,
  ExecutionManifest,
  ManifestTask,
  WorkflowState,
} from "./types.ts";

import {
  appendAuditEvent,
  auditPath as defaultAuditPath,
  findPhaseForTask,
  findTask,
  initState,
  loadState,
  markTaskComplete,
  markTaskFailed,
  markTaskSkipped,
  markTaskStarted,
  saveState,
  setCurrentPhase,
  statePath as defaultStatePath,
  syncProgressMd,
  writeAuditEvent,
} from "./state.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadManifest(path: string): ExecutionManifest {
  return JSON.parse(readFileSync(path, "utf8")) as ExecutionManifest;
}

function allDepsComplete(
  taskId: string,
  deps: string[],
  state: WorkflowState,
): boolean {
  return deps.every((depId) => state.tasks[depId]?.status === "complete");
}

function findAgentForTask(agents: AgentDescriptor[], ownerName: string | undefined): AgentDescriptor | undefined {
  if (!ownerName) return undefined;
  return agents.find((a) => a.name === ownerName);
}

function emit(event: AuditEvent, opts: EngineOptions): WorkflowState {
  writeAuditEvent(opts.auditPath, event);
  return event as unknown as WorkflowState;
}

// ─── DAG ordering ─────────────────────────────────────────────────────────────

interface FlatTask {
  phaseId: string;
  phaseIndex: number;
  task: ManifestTask;
}

function flattenManifest(manifest: ExecutionManifest): FlatTask[] {
  return manifest.phases.flatMap((phase, phaseIndex) =>
    phase.tasks.map((task) => ({ phaseId: phase.id, phaseIndex, task })),
  );
}

function nextReadyTasks(manifest: ExecutionManifest, state: WorkflowState): FlatTask[] {
  const flat = flattenManifest(manifest);
  const ready: FlatTask[] = [];

  for (const entry of flat) {
    const record = state.tasks[entry.task.id];
    if (!record || record.status !== "pending") continue;

    const phaseDepsOk = manifest.phases[entry.phaseIndex]?.dependencies.every(
      (depPhaseId) => {
        const depPhase = manifest.phases.find((p) => p.id === depPhaseId);
        return depPhase?.tasks.every((t) => state.tasks[t.id]?.status === "complete") ?? true;
      },
    ) ?? true;

    if (!phaseDepsOk) continue;

    if (!allDepsComplete(entry.task.id, entry.task.dependencies, state)) continue;

    ready.push(entry);
  }

  return ready;
}

function isComplete(manifest: ExecutionManifest, state: WorkflowState): boolean {
  return flattenManifest(manifest).every(
    ({ task }) => state.tasks[task.id]?.status === "complete" || state.tasks[task.id]?.status === "skipped",
  );
}

function hasFailed(state: WorkflowState): boolean {
  return Object.values(state.tasks).some((t) => t.status === "failed");
}

// ─── Single-task executor ─────────────────────────────────────────────────────

async function executeTask(
  entry: FlatTask,
  agents: AgentDescriptor[],
  state: WorkflowState,
  opts: EngineOptions,
): Promise<WorkflowState> {
  const { task } = entry;
  const agent = findAgentForTask(agents, task.ownerAgent);

  if (!agent) {
    console.warn(`[engine] No agent found for task ${task.id} (owner: ${task.ownerAgent ?? "unassigned"}). Skipping.`);
    writeAuditEvent(opts.auditPath, {
      timestamp: new Date().toISOString(),
      action: "task.skipped",
      runId: state.runId,
      taskId: task.id,
      note: `No agent matched owner '${task.ownerAgent ?? "unassigned"}'`,
    });
    return markTaskSkipped(state, task.id);
  }

  let currentState = markTaskStarted(state, task.id);
  saveState(opts.statePath, currentState);
  writeAuditEvent(opts.auditPath, {
    timestamp: new Date().toISOString(),
    action: "task.started",
    runId: currentState.runId,
    taskId: task.id,
    phaseId: entry.phaseId,
    attempt: currentState.tasks[task.id]?.attempt,
  });

  console.log(`[engine] Starting task ${task.id}: ${task.title} (@${agent.name})`);

  for (let attempt = 0; attempt <= opts.maxRetries; attempt += 1) {
    if (attempt > 0) {
      console.log(`[engine] Retrying task ${task.id} (attempt ${attempt + 1}/${opts.maxRetries + 1})`);
      writeAuditEvent(opts.auditPath, {
        timestamp: new Date().toISOString(),
        action: "task.retrying",
        runId: currentState.runId,
        taskId: task.id,
        attempt: attempt + 1,
      });
      await sleep(opts.retryDelayMs);
    }

    const result = await opts.harness.invoke(agent, task, currentState, opts.repoRoot);

    if (result.success) {
      currentState = markTaskComplete(currentState, task.id, result.outputFiles, result.stdout);
      writeAuditEvent(opts.auditPath, {
        timestamp: new Date().toISOString(),
        action: "task.complete",
        runId: currentState.runId,
        taskId: task.id,
        phaseId: entry.phaseId,
        outputFiles: result.outputFiles,
        durationMs: result.durationMs,
      });
      console.log(`[engine] Task ${task.id} complete (${result.durationMs}ms)`);
      return currentState;
    }

    if (attempt === opts.maxRetries) {
      const msg = result.errorMessage ?? result.stderr;
      console.error(`[engine] Task ${task.id} FAILED after ${attempt + 1} attempt(s): ${msg}`);
      currentState = markTaskFailed(currentState, task.id, msg);
      writeAuditEvent(opts.auditPath, {
        timestamp: new Date().toISOString(),
        action: "task.failed",
        runId: currentState.runId,
        taskId: task.id,
        phaseId: entry.phaseId,
        durationMs: result.durationMs,
        note: msg,
      });
      return currentState;
    }
  }

  return currentState;
}

// ─── Main engine loop ─────────────────────────────────────────────────────────

export async function runEngine(opts: EngineOptions): Promise<WorkflowState> {
  const manifest = loadManifest(opts.manifestPath);

  let state = loadState(opts.statePath)
    ?? initState(manifest, opts.manifestPath, opts.harness.name);

  if (state.status === "complete") {
    console.log("[engine] Workflow already complete. Nothing to do.");
    return state;
  }

  if (state.status === "failed") {
    console.log("[engine] Previous run ended in failure. Use `replay` to re-run failed tasks, or `run` to reset.");
  }

  state = { ...state, status: "running" };
  saveState(opts.statePath, state);
  writeAuditEvent(opts.auditPath, {
    timestamp: new Date().toISOString(),
    action: "run.started",
    runId: state.runId,
    note: `harness=${opts.harness.name}`,
  });

  const agentsDir = manifest.harnessRoot ? `${opts.repoRoot}/${manifest.harnessRoot}/agents` : "";
  const { discoverForgeRepo } = await import("../../forge-execution-adapter/scripts/discovery.ts");
  let agents: AgentDescriptor[] = [];
  try {
    const repo = discoverForgeRepo(opts.repoRoot);
    agents = repo.agents;
  } catch {
    console.warn("[engine] Could not discover agent files; owner matching will be skipped.");
  }

  let currentPhaseId: string | undefined;

  while (!isComplete(manifest, state) && !opts.pauseRequested) {
    if (hasFailed(state)) {
      console.error("[engine] Stopping: one or more tasks failed.");
      state = { ...state, status: "failed" };
      break;
    }

    const ready = nextReadyTasks(manifest, state);

    if (ready.length === 0) {
      if (hasFailed(state)) break;
      console.error("[engine] Deadlock: no tasks are ready but workflow is not complete. Check dependency graph.");
      state = { ...state, status: "failed", blockers: [...state.blockers, "Dependency deadlock detected"] };
      break;
    }

    for (const entry of ready) {
      if (entry.phaseId !== currentPhaseId) {
        currentPhaseId = entry.phaseId;
        state = setCurrentPhase(state, currentPhaseId);
        writeAuditEvent(opts.auditPath, {
          timestamp: new Date().toISOString(),
          action: "phase.started",
          runId: state.runId,
          phaseId: currentPhaseId,
        });
        console.log(`[engine] === Phase ${currentPhaseId} ===`);
      }

      state = await executeTask(entry, agents, state, opts);
      saveState(opts.statePath, state);
      syncProgressMd(opts.progressPath, state, manifest);

      if (hasFailed(state)) break;
    }
  }

  if (opts.pauseRequested && !isComplete(manifest, state) && !hasFailed(state)) {
    state = { ...state, status: "paused" };
    writeAuditEvent(opts.auditPath, {
      timestamp: new Date().toISOString(),
      action: "run.paused",
      runId: state.runId,
    });
    console.log("[engine] Paused after current task.");
  } else if (isComplete(manifest, state)) {
    state = { ...state, status: "complete" };
    writeAuditEvent(opts.auditPath, {
      timestamp: new Date().toISOString(),
      action: "run.complete",
      runId: state.runId,
    });
    console.log("[engine] Workflow complete.");
  }

  saveState(opts.statePath, state);
  syncProgressMd(opts.progressPath, state, manifest);
  return state;
}

// ─── Replay a single failed task ──────────────────────────────────────────────

export async function replayTask(taskId: string, opts: EngineOptions): Promise<WorkflowState> {
  const manifest = loadManifest(opts.manifestPath);
  let state = loadState(opts.statePath);
  if (!state) throw new Error("No workflow state found. Run the engine first.");

  const record = state.tasks[taskId];
  if (!record) throw new Error(`Task '${taskId}' not found in workflow state.`);

  // Reset the task back to pending so the engine can execute it
  state = {
    ...state,
    status: "running",
    tasks: {
      ...state.tasks,
      [taskId]: { ...record, status: "pending", errorMessage: undefined },
    },
  };

  const { discoverForgeRepo } = await import("../../forge-execution-adapter/scripts/discovery.ts");
  let agents: AgentDescriptor[] = [];
  try {
    const repo = discoverForgeRepo(opts.repoRoot);
    agents = repo.agents;
  } catch {
    console.warn("[engine] Could not discover agent files.");
  }

  const phaseId = findPhaseForTask(manifest, taskId);
  const task = findTask(manifest, taskId);
  if (!task || !phaseId) throw new Error(`Task '${taskId}' not found in manifest.`);

  const entry = { phaseId, phaseIndex: manifest.phases.findIndex((p) => p.id === phaseId), task };
  state = await executeTask(entry, agents, state, opts);
  if (!hasFailed(state) && isComplete(manifest, state)) {
    state = { ...state, status: "complete" };
  }

  saveState(opts.statePath, state);
  syncProgressMd(opts.progressPath, state, manifest);
  return state;
}
