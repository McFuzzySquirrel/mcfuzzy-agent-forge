import { readFileSync } from "node:fs";

import type {
  AgentDescriptor,
  AuditEvent,
  ExecutionMode,
  EngineOptions,
  ExecutionManifest,
  ManifestTask,
  SelectionScope,
  TaskResult,
  TaskStatus,
  TaskSelection,
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
  markTaskStarted,
  reconcileState,
  saveState,
  setCurrentPhase,
  setSelection,
  statePath as defaultStatePath,
  syncProgressMd,
  writeAuditEvent,
} from "./state.ts";

import { ArtifactStore } from "./artifacts.ts";
import { commitTaskWork } from "./commit.ts";
import { captureWorktree, diffWorktree, runTaskValidation, verifyTaskResult } from "./verify.ts";
import { clearControl, readControl } from "./control.ts";
import { assertTaskCapabilities, prepareTaskRequest } from "./request.ts";

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

/** Validate the graph before execution so malformed manifests fail clearly. */
export function validateManifestDependencies(manifest: ExecutionManifest): string[] {
  const owners = new Map<string, string>();
  const orphanWarnings: string[] = [];
  for (const phase of manifest.phases) {
    for (const task of phase.tasks) {
      const previous = owners.get(task.id);
      if (previous) throw new Error(`Duplicate global task id '${task.id}' in phases '${previous}' and '${phase.id}'.`);
      owners.set(task.id, phase.id);
    }
  }
  for (const phase of manifest.phases) {
    for (const phaseDependency of phase.dependencies ?? []) {
      if (!manifest.phases.some((candidate) => candidate.id === phaseDependency)) {
        orphanWarnings.push(`Phase '${phase.id}' depends on orphan phase '${phaseDependency}'.`);
      }
    }
    for (const task of phase.tasks) {
      for (const dependency of task.dependencies ?? []) {
        if (!owners.has(dependency)) orphanWarnings.push(`Task '${task.id}' depends on orphan task '${dependency}'.`);
      }
    }
  }
  return orphanWarnings;
}

function scopedTaskSet(selection: TaskSelection | undefined): Set<string> | null {
  return selection?.mode === "manual" && selection.taskIds.length > 0
    ? new Set(selection.taskIds)
    : null;
}

function findManifestTask(manifest: ExecutionManifest, taskId: string): ManifestTask | undefined {
  return flattenManifest(manifest).find((entry) => entry.task.id === taskId)?.task;
}

function expandSelectedTaskIds(manifest: ExecutionManifest, selectedTaskIds: string[]): string[] {
  const selected = new Set<string>();
  const visiting = new Set<string>();

  const visit = (taskId: string): void => {
    if (selected.has(taskId) || visiting.has(taskId)) return;
    const task = findManifestTask(manifest, taskId);
    if (!task) return;
    visiting.add(taskId);
    const phase = manifest.phases.find((candidate) => candidate.tasks.some((entry) => entry.id === taskId));
    for (const phaseId of phase?.dependencies ?? []) {
      for (const prerequisite of manifest.phases.find((candidate) => candidate.id === phaseId)?.tasks ?? []) visit(prerequisite.id);
    }
    for (const depId of task.dependencies ?? []) visit(depId);
    visiting.delete(taskId);
    selected.add(taskId);
  };

  for (const taskId of selectedTaskIds) visit(taskId);
  return flattenManifest(manifest).map((entry) => entry.task.id).filter((id) => selected.has(id));
}

function resolveSelection(manifest: ExecutionManifest, state: WorkflowState, opts: EngineOptions): TaskSelection | undefined {
  const executionMode = opts.executionMode === "manual" || state.selection?.mode === "manual" ? "manual" as ExecutionMode : "auto" as ExecutionMode;
  const requested = opts.selectedTaskIds && opts.selectedTaskIds.length > 0
    ? opts.selectedTaskIds
    : state.selection?.mode === "manual"
      ? state.selection.taskIds
      : [];
  if (executionMode !== "manual") return undefined;
  const taskIds = expandSelectedTaskIds(manifest, requested);
  if (taskIds.length === 0) {
    throw new Error("Manual execution mode requires at least one valid selected task.");
  }
  return {
    mode: "manual",
    scope: opts.selectionScope ?? state.selection?.scope ?? (taskIds.length === 1 ? "single" : "list") as SelectionScope,
    taskIds,
  };
}

export function nextReadyTasks(manifest: ExecutionManifest, state: WorkflowState): FlatTask[] {
  const flat = flattenManifest(manifest);
  const ready: FlatTask[] = [];
  const selected = scopedTaskSet(state.selection);

  for (const entry of flat) {
    if (selected && !selected.has(entry.task.id)) continue;
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
 * dependency graph considers them independent. The current scheduler also
 * serializes cross-owner tasks for repository-wide output attribution.
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
  const selected = scopedTaskSet(state.selection);
  return flattenManifest(manifest)
    .filter(({ task }) => !selected || selected.has(task.id))
    .every(
    ({ task }) => isTaskDone(state.tasks[task.id]?.status),
  );
}

function hasFailed(state: WorkflowState): boolean {
  const selected = scopedTaskSet(state.selection);
  return Object.values(state.tasks).some((t) => t.status === "failed" && (!selected || selected.has(t.taskId)));
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
    throw new Error(`Task '${task.id}' requires missing owner '${task.ownerAgent ?? "unassigned"}'. Restore its agent file or correct ownerAgent and recompile.`);
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

  const cancelAttempt = (): WorkflowState => {
    currentState = {
      ...currentState,
      tasks: { ...currentState.tasks, [task.id]: {
        ...currentState.tasks[task.id]!, status: "pending", startedAt: undefined, completedAt: undefined,
        errorMessage: "Task cancelled", failureKind: "cancelled",
      } },
    };
    writeAuditEvent(opts.auditPath, {
      timestamp: new Date().toISOString(), action: "task.cancelled", runId: currentState.runId, taskId: task.id,
      note: "Attempt cancelled; task remains pending for resume",
    });
    return currentState;
  };

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
      if (shouldStop()) {
        return { ...currentState, tasks: { ...currentState.tasks, [task.id]: { ...currentState.tasks[task.id]!, status: "pending", startedAt: undefined } } };
      }
      currentState = markTaskStarted(currentState, task.id);
      saveState(opts.statePath, currentState);
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
      result = await opts.harness.invoke(prepareTaskRequest({
        agent, task, repoRoot: opts.repoRoot, contextBlock,
        defaultModel: opts.harness.defaultModel, timeoutMs: opts.taskTimeoutMs,
        maxRetries: opts.maxRetries, attempt: currentState.tasks[task.id]!.attempt,
        runId: currentState.runId, signal: opts.signal,
      }));
    } catch (error) {
      if (opts.signal?.aborted) return cancelAttempt();
      const message = `Adapter exception: ${error instanceof Error ? error.message : String(error)}`;
      currentState = markTaskFailed(currentState, task.id, message);
      currentState.tasks[task.id] = { ...currentState.tasks[task.id]!, failureKind: "exception" };
      writeAuditEvent(opts.auditPath, {
        timestamp: new Date().toISOString(), action: "task.failed", runId: currentState.runId,
        taskId: task.id, phaseId: entry.phaseId, note: message,
      });
      return currentState;
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }

    // Record a failed attempt (either the harness failed or the output gate
    // rejected a hollow "success"). Exhausting retries marks the task failed.
    const failTask = (msg: string): WorkflowState => {
      console.error(`[engine] Task ${task.id} FAILED after ${attempt + 1} attempt(s): ${msg}`);
      currentState = markTaskFailed(currentState, task.id, msg);
      currentState.tasks[task.id] = { ...currentState.tasks[task.id]!, failureKind: result.failureKind ?? "retryable" };
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

    if (opts.signal?.aborted) return cancelAttempt();

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

    if (attempt === opts.maxRetries || result.failureKind === "configuration" ||
        result.failureKind === "exception" || result.failureKind === "cancelled") {
      return failTask(result.errorMessage ?? result.stderr);
    }
  }

  return currentState;
}

async function preflightOwners(
  manifest: ExecutionManifest, state: WorkflowState, opts: EngineOptions,
): Promise<AgentDescriptor[]> {
  try {
    const { discoverForgeRepo } = await import("../../forge-execution-adapter/scripts/discovery.ts");
    const { agents } = discoverForgeRepo(opts.repoRoot, manifest.harnessRoot);
    const selected = scopedTaskSet(state.selection);
    const unresolved = flattenManifest(manifest).filter(({ task }) =>
      (!selected || selected.has(task.id)) && !isTaskDone(state.tasks[task.id]?.status) &&
      !findAgentForTask(agents, task.ownerAgent));
    if (unresolved.length > 0) {
      throw new Error(`Missing required owners: ${unresolved.map(({ task }) => `${task.id} (${task.ownerAgent ?? "unassigned"})`).join(", ")}. Restore agent files or correct ownerAgent and recompile.`);
    }
    for (const { task } of flattenManifest(manifest)) {
      if ((selected && !selected.has(task.id)) || isTaskDone(state.tasks[task.id]?.status)) continue;
      assertTaskCapabilities(task, opts.harness);
      prepareTaskRequest({ agent: findAgentForTask(agents, task.ownerAgent)!, task,
        repoRoot: opts.repoRoot, defaultModel: opts.harness.defaultModel, timeoutMs: opts.taskTimeoutMs,
        maxRetries: opts.maxRetries });
    }
    return agents;
  } catch (error) {
    const message = `Owner preflight failed: ${error instanceof Error ? error.message : String(error)}`;
    const failed = { ...state, status: "failed" as const, blockers: [...state.blockers, message] };
    saveState(opts.statePath, failed);
    syncProgressMd(opts.progressPath, failed, manifest);
    writeAuditEvent(opts.auditPath, { timestamp: new Date().toISOString(), action: "run.failed", runId: state.runId, note: message });
    throw new Error(message, { cause: error });
  }
}

// ─── Main engine loop ─────────────────────────────────────────────────────────

async function runEngineSession(opts: EngineOptions): Promise<WorkflowState> {
  const manifest = loadManifest(opts.manifestPath);
  const graphWarnings = validateManifestDependencies(manifest);
  for (const warning of graphWarnings) console.warn(`[engine] Warning: ${warning}`);

  let state = loadState(opts.statePath)
    ?? initState(manifest, opts.manifestPath, opts.harness.name);
  const reconciledState = reconcileState(state, manifest);
  const wasReconciled = reconciledState !== state;
  state = reconciledState;
  if (wasReconciled) {
    saveState(opts.statePath, state);
    writeAuditEvent(opts.auditPath, {
      timestamp: new Date().toISOString(), action: "state.reconciled", runId: state.runId,
      note: `manifest=${manifest.generatedAt}`,
    });
  }
  const selection = resolveSelection(manifest, state, opts);
  state = setSelection(state, selection);

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
    if (isComplete(manifest, state)) {
      console.log("[engine] Workflow already complete. Nothing to do.");
      return state;
    }
    console.log("[engine] Previous run was complete for a different selection. Continuing.");
  }

  if (state.status === "failed") {
    console.log("[engine] Previous run ended in failure. Use `replay` to re-run failed tasks, or `run` to reset.");
  }

  state = { ...state, status: "running", harness: opts.harness.name };
  saveState(opts.statePath, state);
  writeAuditEvent(opts.auditPath, {
    timestamp: new Date().toISOString(),
    action: "run.started",
    runId: state.runId,
    note: `harness=${opts.harness.name}`,
  });

  const agents = await preflightOwners(manifest, state, opts);
  await opts.harness.prepare?.({ repoRoot: opts.repoRoot, runId: state.runId, signal: opts.signal });

  const store = new ArtifactStore({ artifactsPath: opts.artifactsPath });
  // Output attribution compares repository-wide worktree snapshots; running
  // tasks concurrently can attribute another task's file changes to the current
  // task. Keep execution serialized until task-isolated attribution is used.
  let currentPhaseId: string | undefined;

  // Stop signal: the in-process flag (SIGINT/SIGTERM) OR a pause/stop request
  // written to the control file by `workflow-engine pause|stop`. Checked at the
  // top of each wave so a running task finishes before the run pauses.
  const shouldStop = (): boolean =>
    Boolean(opts.pauseRequested || opts.stopRequested?.() || opts.signal?.aborted || readControl(opts.controlPath) !== null);

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

    // Every task starts from the authoritative state; durability and commit
    // attribution must finish before another task can touch the worktree.
    for (const entry of ready) {
      if (shouldStop() || hasFailed(state)) break;
      state = setCurrentPhase(state, entry.phaseId);
      state = await executeTask(entry, agents, state, opts, store, shouldStop);
      saveState(opts.statePath, state);
      syncProgressMd(opts.progressPath, state, manifest);
      if (opts.autoCommit !== false) {
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

async function replayTaskSession(taskId: string, opts: EngineOptions): Promise<WorkflowState> {
  const manifest = loadManifest(opts.manifestPath);
  let state = loadState(opts.statePath);
  if (!state) throw new Error("No workflow state found. Run the engine first.");

  const record = state.tasks[taskId];
  if (!record) throw new Error(`Task '${taskId}' not found in workflow state.`);

  // Reset the task back to pending so the engine can execute it
  state = {
    ...state,
    status: "running",
    harness: opts.harness.name,
    selection: undefined,
    tasks: {
      ...state.tasks,
      [taskId]: {
        ...record, status: "pending", errorMessage: undefined, failureKind: undefined,
        startedAt: undefined, completedAt: undefined,
      },
    },
  };

  const store = new ArtifactStore({ artifactsPath: opts.artifactsPath });
  const phaseId = findPhaseForTask(manifest, taskId);
  const task = findTask(manifest, taskId);
  if (!task || !phaseId) throw new Error(`Task '${taskId}' not found in manifest.`);
  const dependencyIds = expandSelectedTaskIds(manifest, [taskId]).filter((id) => id !== taskId);
  const replayRecords = state.tasks;
  const incomplete = dependencyIds.filter((id) => !isTaskDone(replayRecords[id]?.status));
  if (incomplete.length > 0) throw new Error(`Cannot replay '${taskId}': incomplete dependencies ${incomplete.join(", ")}. Run them first.`);
  const agents = await preflightOwners(manifest, {
    ...state, selection: { mode: "manual", taskIds: [taskId] },
  }, opts);
  saveState(opts.statePath, state);
  if (!opts.signal?.aborted) {
    await opts.harness.prepare?.({ repoRoot: opts.repoRoot, runId: state.runId, signal: opts.signal });
  }

  const entry = { phaseId, phaseIndex: manifest.phases.findIndex((p) => p.id === phaseId), task };
  state = await executeTask(entry, agents, state, opts, store, () => Boolean(opts.signal?.aborted));
  if (opts.signal?.aborted && !isComplete(manifest, state)) {
    state = { ...state, status: "paused" };
    writeAuditEvent(opts.auditPath, {
      timestamp: new Date().toISOString(), action: "run.paused", runId: state.runId,
      note: "Replay cancelled; pending work can be resumed",
    });
    clearControl(opts.controlPath);
  } else if (hasFailed(state)) {
    state = { ...state, status: "failed" };
  } else if (isComplete(manifest, state)) {
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

async function withHarnessLifecycle(opts: EngineOptions, run: () => Promise<WorkflowState>): Promise<WorkflowState> {
  try {
    try {
      return await run();
    } finally {
      await opts.harness.cleanup?.();
    }
  } catch (error) {
    const state = loadState(opts.statePath);
    if (state) {
      const message = error instanceof Error ? error.message : String(error);
      const cancelled = opts.signal?.aborted;
      let failed: WorkflowState = { ...state, status: cancelled ? "paused" : "failed", blockers: [...state.blockers, message] };
      for (const record of Object.values(failed.tasks)) {
        if (record.status === "running") {
          failed = markTaskFailed(failed, record.taskId, message);
          failed.tasks[record.taskId] = { ...failed.tasks[record.taskId]!, failureKind: cancelled ? "cancelled" : "exception",
            ...(cancelled ? { status: "pending", startedAt: undefined, completedAt: undefined } : {}) };
        }
      }
      saveState(opts.statePath, failed);
      syncProgressMd(opts.progressPath, failed, loadManifest(opts.manifestPath));
      writeAuditEvent(opts.auditPath, { timestamp: new Date().toISOString(), action: cancelled ? "run.paused" : "run.failed", runId: state.runId, note: message });
    }
    throw error;
  }
}

export function runEngine(opts: EngineOptions): Promise<WorkflowState> {
  return withHarnessLifecycle(opts, () => runEngineSession(opts));
}

export function replayTask(taskId: string, opts: EngineOptions): Promise<WorkflowState> {
  return withHarnessLifecycle(opts, () => replayTaskSession(taskId, opts));
}
