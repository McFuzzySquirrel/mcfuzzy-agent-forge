import { readFileSync } from "node:fs";

import type {
  AgentDescriptor,
  AuditEvent,
  EngineOptions,
  ExecutionManifest,
  ManifestTask,
  TaskResult,
  TaskStatus,
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

import { ArtifactStore } from "./artifacts.ts";
import { commitTaskWork } from "./commit.ts";
import { captureWorktree, diffWorktree, runTaskValidation, verifyTaskResult } from "./verify.ts";
import { clearControl, readControl } from "./control.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `worker` over `items` with at most `limit` invocations in flight at once,
 * returning results in input order. Degrades to a plain sequential map when
 * `limit <= 1` or `items.length <= 1`.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  const cap = Math.max(1, limit);

  let nextIndex = 0;
  async function run(): Promise<void> {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  }

  const workers = Array.from({ length: Math.min(cap, items.length) }, () => run());
  await Promise.all(workers);
  return results;
}

function loadManifest(path: string): ExecutionManifest {
  return JSON.parse(readFileSync(path, "utf8")) as ExecutionManifest;
}

export function isTaskDone(status: TaskStatus | undefined): boolean {
  return status === "complete" || status === "skipped";
}

export function allDepsComplete(
  taskId: string,
  deps: string[],
  state: WorkflowState,
): boolean {
  return deps.every((depId) => isTaskDone(state.tasks[depId]?.status));
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

export interface FlatTask {
  phaseId: string;
  phaseIndex: number;
  task: ManifestTask;
}

function flattenManifest(manifest: ExecutionManifest): FlatTask[] {
  return manifest.phases.flatMap((phase, phaseIndex) =>
    phase.tasks.map((task) => ({ phaseId: phase.id, phaseIndex, task })),
  );
}

export function nextReadyTasks(manifest: ExecutionManifest, state: WorkflowState): FlatTask[] {
  const flat = flattenManifest(manifest);
  const ready: FlatTask[] = [];

  for (const entry of flat) {
    const record = state.tasks[entry.task.id];
    if (!record || record.status !== "pending") continue;

    const phaseDepsOk = manifest.phases[entry.phaseIndex]?.dependencies.every(
      (depPhaseId) => {
        const depPhase = manifest.phases.find((p) => p.id === depPhaseId);
        return depPhase?.tasks.every((t) => isTaskDone(state.tasks[t.id]?.status)) ?? true;
      },
    ) ?? true;

    if (!phaseDepsOk) continue;

    if (!allDepsComplete(entry.task.id, entry.task.dependencies, state)) continue;

    ready.push(entry);
  }

  return ready;
}

/**
 * Restrict a ready frontier so that at most one task per owner runs in a single
 * wave. Tasks owned by the same agent share a subsystem (project dir, build
 * outputs, ports), so dispatching them concurrently can collide even when the
 * dependency graph considers them independent. Cross-owner tasks still
 * parallelize up to `--concurrency`; same-owner tasks drain one per wave.
 *
 * First task per owner wins (manifest order); later same-owner entries stay
 * `pending` and re-enter the frontier on the next wave. Unassigned tasks share
 * the `__unassigned__` bucket so they serialize too.
 */
export function ownerUniqueReady(ready: FlatTask[]): FlatTask[] {
  const seenOwners = new Set<string>();
  const unique: FlatTask[] = [];

  for (const entry of ready) {
    const owner = entry.task.ownerAgent ?? "__unassigned__";
    if (seenOwners.has(owner)) continue;
    seenOwners.add(owner);
    unique.push(entry);
  }

  return unique;
}

export function isComplete(manifest: ExecutionManifest, state: WorkflowState): boolean {
  return flattenManifest(manifest).every(
    ({ task }) => isTaskDone(state.tasks[task.id]?.status),
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
  store: ArtifactStore,
  shouldStop: () => boolean,
): Promise<WorkflowState> {
  const { task } = entry;
  const agent = findAgentForTask(agents, task.ownerAgent);

  // A stop/pause was requested while this task was queued in the current wave.
  // Leave it pending so `run` resumes it later instead of starting it.
  if (shouldStop()) {
    console.log(`[engine] Stop requested before task ${task.id} started; leaving it pending.`);
    return state;
  }

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

  // ── Context projection ──────────────────────────────────────────────────────
  // Resolve input artifacts declared in the task manifest and build a
  // projection.  The harness receives only the projection, not raw artifacts.
  const inputTypes = task.inputs ?? [];
  let inputArtifactIds: string[] = [];
  let contextBlock = "";

  if (inputTypes.length > 0) {
    const projection = store.project({ taskId: task.id, inputTypes });
    inputArtifactIds = projection.artifacts.map((a) => a.artifactId);
    contextBlock = store.renderProjection(projection);

    if (projection.sourceTokenEstimate > 0) {
      const reductionPercent = parseFloat(
        (
          (1 - projection.projectedTokenEstimate / projection.sourceTokenEstimate) *
          100
        ).toFixed(1),
      );

      writeAuditEvent(opts.auditPath, {
        timestamp: new Date().toISOString(),
        action: "context.projected",
        runId: state.runId,
        taskId: task.id,
        sourceTokenEstimate: projection.sourceTokenEstimate,
        projectedTokenEstimate: projection.projectedTokenEstimate,
        reductionPercent,
        note: `${inputArtifactIds.length} artifact(s) projected for task ${task.id}`,
      });

      console.log(
        `[engine] Context projected for ${task.id}: ~${projection.projectedTokenEstimate} tokens ` +
          `(${reductionPercent}% reduction from ~${projection.sourceTokenEstimate})`,
      );
    }
  }

  let currentState = markTaskStarted(state, task.id);
  writeAuditEvent(opts.auditPath, {
    timestamp: new Date().toISOString(),
    action: "task.started",
    runId: currentState.runId,
    taskId: task.id,
    phaseId: entry.phaseId,
    attempt: currentState.tasks[task.id]?.attempt,
  });

  // Persist the "running" status so snapshots/dashboards (and reconnects) see
  // in-flight work instead of a stale "pending". Safe on restart: runEngine
  // normalizes any leftover "running" tasks back to "pending" on load.
  saveState(opts.statePath, currentState);

  // Output-verification baseline: a snapshot of the working tree taken before
  // the harness runs. It supports both the no-op heuristic and Git-based
  // output-file enrichment for in-place edits, even when --allow-noop disables
  // only the no-op rejection check.
  const baseline = await captureWorktree(opts.repoRoot);

  console.log(`[engine] Starting task ${task.id}: ${task.title} (@${agent.name})`);

  for (let attempt = 0; attempt <= opts.maxRetries; attempt += 1) {
    if (attempt > 0) {
      // A stop/pause arrived during the failed attempt. Do not start another
      // retry; reset the task back to pending so `run` resumes it later.
      if (shouldStop()) {
        console.log(`[engine] Stop requested between attempts for task ${task.id}; leaving it pending.`);
        const pendingTask = { ...currentState.tasks[task.id]!, status: "pending" as const, startedAt: undefined };
        return { ...currentState, tasks: { ...currentState.tasks, [task.id]: pendingTask } };
      }
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

    const invokeStart = Date.now();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    if (opts.heartbeatMs > 0) {
      heartbeat = setInterval(() => {
        const elapsed = Math.round((Date.now() - invokeStart) / 1000);
        console.log(`[engine] …still working on task ${task.id} (@${agent.name}, ${elapsed}s elapsed)`);
      }, opts.heartbeatMs);
      heartbeat.unref?.();
    }

    let result: TaskResult;
    try {
      result = await opts.harness.invoke(
        agent,
        task,
        currentState,
        opts.repoRoot,
        contextBlock,
        task.timeoutMs ?? opts.taskTimeoutMs,
        opts.maxRetries,
      );
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }

    // Record a failed attempt (either the harness failed or the output gate
    // rejected a hollow "success"). Exhausting retries marks the task failed.
    const failTask = (msg: string): WorkflowState => {
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
    };

    if (result.success) {
      // ── Output verification: never report a task complete with no evidence ─
      const verified = await verifyTaskResult(task, result, baseline, {
        repoRoot: opts.repoRoot,
        allowNoop: opts.allowNoop,
        runValidation: opts.runValidation,
      });
      let failReason = verified.ok ? undefined : verified.reason;

      if (!failReason && opts.runValidation) {
        const validation = await runTaskValidation(task, opts.repoRoot, task.timeoutMs ?? opts.taskTimeoutMs);
        if (!validation.ok) failReason = validation.reason;
      }

      if (failReason) {
        if (attempt === opts.maxRetries) return failTask(failReason);
        continue; // hollow success → retry
      }

      // ── Enrich output files from git diff ─────────────────────────────────
      // Adapters only check `expectedOutputs` for output files, which misses
      // files the agent modified in place.  Diff the worktree against the
      // pre-task baseline to capture every file that changed during this task
      // and merge with any files the adapter already reported.
      if (baseline) {
        const after = await captureWorktree(opts.repoRoot);
        const gitChanged = diffWorktree(baseline, after);
        if (gitChanged.length > 0) {
          const merged = new Set([...result.outputFiles, ...gitChanged]);
          result = { ...result, outputFiles: [...merged] };
        }
      }

      // ── Artifact creation ─────────────────────────────────────────────────
      let artifactId: string | undefined;

      if (task.produces) {
        const artifact = store.synthesise({
          type: task.produces,
          taskId: task.id,
          taskTitle: task.title,
          taskDescription: task.description,
          producedBy: agent.name,
          outputFiles: result.outputFiles,
          agentOutput: result.stdout,
          inputArtifactIds,
        });
        artifactId = artifact.artifactId;

        writeAuditEvent(opts.auditPath, {
          timestamp: new Date().toISOString(),
          action: "artifact.created",
          runId: currentState.runId,
          taskId: task.id,
          artifactId: artifact.artifactId,
          artifactType: artifact.type,
          inputArtifacts: inputArtifactIds,
        });

        console.log(`[engine] Artifact created: ${artifact.artifactId} (${artifact.type})`);
      }

      currentState = markTaskComplete(
        currentState,
        task.id,
        result.outputFiles,
        result.stdout,
        artifactId,
        inputArtifactIds.length > 0 ? inputArtifactIds : undefined,
      );
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
      return failTask(result.errorMessage ?? result.stderr);
    }
  }

  return currentState;
}

// ─── Main engine loop ─────────────────────────────────────────────────────────

export async function runEngine(opts: EngineOptions): Promise<WorkflowState> {
  const manifest = loadManifest(opts.manifestPath);

  let state = loadState(opts.statePath)
    ?? initState(manifest, opts.manifestPath, opts.harness.name);

  // A previous run that died mid-task may have left tasks marked "running".
  // Reset those to "pending" so they are picked up again instead of deadlocking.
  if (state.tasks) {
    const tasks: WorkflowState["tasks"] = {};
    let changed = false;
    for (const [id, record] of Object.entries(state.tasks)) {
      tasks[id] = record.status === "running"
        ? { ...record, status: "pending", startedAt: undefined }
        : record;
      if (tasks[id] !== record) changed = true;
    }
    if (changed) state = { ...state, tasks };
  }

  // A fresh `run` is authoritative: discard any stale pause/stop request left
  // over by a killed engine (its SIGTERM handler never got to clear it). A live
  // engine polls this file at each wave; only pause/stop issued while it runs
  // should take effect.
  clearControl(opts.controlPath);

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

  const store = new ArtifactStore({ artifactsPath: opts.artifactsPath });
  // Output attribution compares repository-wide worktree snapshots; running
  // tasks concurrently can attribute another task's file changes to the current
  // task. Keep execution serialized until task-isolated attribution is used.
  const concurrency = 1;
  let currentPhaseId: string | undefined;

  // Stop signal: the in-process flag (SIGINT/SIGTERM) OR a pause/stop request
  // written to the control file by `workflow-engine pause|stop`. Checked at the
  // top of each wave so a running task finishes before the run pauses.
  const shouldStop = (): boolean =>
    Boolean(opts.pauseRequested || opts.stopRequested?.() || readControl(opts.controlPath) !== null);

  while (!isComplete(manifest, state) && !shouldStop()) {
    if (hasFailed(state)) {
      console.error("[engine] Stopping: one or more tasks failed.");
      state = { ...state, status: "failed" };
      break;
    }

    const ready = ownerUniqueReady(nextReadyTasks(manifest, state));

    if (ready.length === 0) {
      if (hasFailed(state)) break;
      console.error("[engine] Deadlock: no tasks are ready but workflow is not complete. Check dependency graph.");
      state = { ...state, status: "failed", blockers: [...state.blockers, "Dependency deadlock detected"] };
      break;
    }

    // Phase bookkeeping for every phase entering this wave (manifest order).
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
    }

    // Dispatch the ready frontier concurrently (bounded). Each executeTask is
    // derived from the same base state and returns only its own task's
    // transition, which is merged back deterministically below.
    const results = await mapLimit(ready, concurrency, (entry) =>
      executeTask(entry, agents, state, opts, store, shouldStop),
    );

    for (let i = 0; i < ready.length; i += 1) {
      const taskId = ready[i]!.task.id;
      const record = results[i]!.tasks[taskId];
      if (record) {
        state = {
          ...state,
          lastUpdatedAt: results[i]!.lastUpdatedAt,
          tasks: { ...state.tasks, [taskId]: record },
        };
      }
    }

    saveState(opts.statePath, state);
    syncProgressMd(opts.progressPath, state, manifest);

    // Auto-commit: one commit per task that completed in this wave, sequenced
    // after the merge (safe with any concurrency). Runs after saveState +
    // syncProgressMd so the engine-owned files (WORKFLOW-STATE, audit, PROGRESS)
    // are included in the same commit as the task's work. Defaults to on.
    if (opts.autoCommit !== false) {
      for (const entry of ready) {
        const record = state.tasks[entry.task.id];
        if (record?.status !== "complete") continue;
        const sha = await commitTaskWork(
          entry.task.id,
          entry.task.title,
          opts.repoRoot,
          opts.commitMessageTemplate,
        );
        if (!sha) continue;
        writeAuditEvent(opts.auditPath, {
          timestamp: new Date().toISOString(),
          action: "task.committed",
          runId: state.runId,
          taskId: entry.task.id,
          commitSha: sha,
        });
        console.log(`[engine] Task ${entry.task.id} committed (${sha.slice(0, 7)})`);
      }
    }
  }

  if (shouldStop() && !isComplete(manifest, state)) {
    // Stop/pause wins over a failed task in the same wave: record the run as
    // paused (resume-able) rather than failed, and always clear the request.
    state = { ...state, status: "paused" };
    writeAuditEvent(opts.auditPath, {
      timestamp: new Date().toISOString(),
      action: "run.paused",
      runId: state.runId,
      note: "Stop/pause requested (control file or signal)",
    });
    console.log("[engine] Paused after current task.");
  } else if (hasFailed(state)) {
    state = { ...state, status: "failed" };
    writeAuditEvent(opts.auditPath, {
      timestamp: new Date().toISOString(),
      action: "run.failed",
      runId: state.runId,
      note: "One or more tasks failed",
    });
    console.log("[engine] Run ended in failure.");
  } else if (isComplete(manifest, state)) {
    state = { ...state, status: "complete" };
    writeAuditEvent(opts.auditPath, {
      timestamp: new Date().toISOString(),
      action: "run.complete",
      runId: state.runId,
    });
    console.log("[engine] Workflow complete.");
  }

  // Always clear a pending stop/pause request: the run ended (paused, failed,
  // or complete) and the next `run` must start clean.
  clearControl(opts.controlPath);

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

  const store = new ArtifactStore({ artifactsPath: opts.artifactsPath });
  const phaseId = findPhaseForTask(manifest, taskId);
  const task = findTask(manifest, taskId);
  if (!task || !phaseId) throw new Error(`Task '${taskId}' not found in manifest.`);

  const entry = { phaseId, phaseIndex: manifest.phases.findIndex((p) => p.id === phaseId), task };
  state = await executeTask(entry, agents, state, opts, store, () => false);
  if (!hasFailed(state) && isComplete(manifest, state)) {
    state = { ...state, status: "complete" };
  }

  saveState(opts.statePath, state);
  syncProgressMd(opts.progressPath, state, manifest);

  // Auto-commit a replayed task's work too (default on), matching runEngine.
  if (opts.autoCommit !== false && state.tasks[taskId]?.status === "complete") {
    const sha = await commitTaskWork(
      taskId,
      task.title ?? taskId,
      opts.repoRoot,
      opts.commitMessageTemplate,
    );
    if (sha) {
      writeAuditEvent(opts.auditPath, {
        timestamp: new Date().toISOString(),
        action: "task.committed",
        runId: state.runId,
        taskId,
        commitSha: sha,
      });
      console.log(`[engine] Task ${taskId} committed (${sha.slice(0, 7)})`);
    }
  }

  return state;
}
