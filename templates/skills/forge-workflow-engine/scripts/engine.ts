import { readFileSync } from "node:fs";

import type {
  AgentDescriptor,
  AuditEvent,
  ExecutionMode,
  EngineOptions,
  ExecutionManifest,
  ManifestTask,
  SelectionScope,
  TaskAttemptSummary,
  TaskGateResult,
  TaskRecord,
  TaskResult,
  TaskStatus,
  TaskSelection,
  WorkflowState,
} from "./types.ts";

import {
  appendAuditEvent,
  auditPath as defaultAuditPath,
  completeRecord,
  failRecord,
  findPhaseForTask,
  findTask,
  initState,
  loadState,
  reconcileState,
  saveState,
  setCurrentPhase,
  setSelection,
  startRecord,
  statePath as defaultStatePath,
  syncProgressMd,
  withTaskRecord,
  writeAuditEvent,
} from "./state.ts";

import { ArtifactStore } from "./artifacts.ts";
import { commitTaskWork } from "./commit.ts";
import { captureWorktree, diffWorktree, runTaskValidation, verifyTaskResult } from "./verify.ts";
import { clearControl, readControl } from "./control.ts";
import { assertTaskCapabilities, prepareTaskRequest } from "./request.ts";
import { humanTaskApproved, taskReferenceContext } from "./task-context.ts";
import { readTaskHandoff } from "./task-result.ts";
import { writeTaskAttempt } from "./task-execution.ts";
import {
  clearSandboxRoot,
  createSandbox,
  destroySandbox,
  integrateSandbox,
  preflightSandboxMode,
  sandboxProvidedPaths,
  sandboxRoot,
  sweepStaleSandboxes,
} from "./sandbox.ts";

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

/**
 * Serializes work behind a promise chain. The engine uses one queue so that
 * state persistence, sandbox integration, and git auto-commit never interleave:
 * a task may run concurrently with its siblings, but the engine itself is a
 * single writer.
 */
export function createSerialQueue(): { run<T>(work: () => Promise<T> | T): Promise<T> } {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run(work) {
      const result = tail.then(work, work);
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}

export interface ConcurrencyDecision {
  /** The value the operator asked for, after parsing. */
  requested: number;
  /** The value the engine will actually dispatch with. */
  effective: number;
  /** True when concurrent tasks each run in their own git worktree sandbox. */
  sandboxMode: boolean;
  /** Set when the request had to be reduced, with the reason. */
  notice?: string;
}

/**
 * The single source of truth for how many tasks run at once. The CLI uses it for
 * the pre-run summary and the keep-alive decision, the engine for dispatch, so
 * the three can never disagree about whether sandboxes are in play.
 */
export function resolveConcurrency(options: { maxConcurrency: number; supportsConcurrency: boolean }): ConcurrencyDecision {
  const requested = Number.isFinite(options.maxConcurrency) ? Math.floor(options.maxConcurrency) : 1;
  const wanted = Math.max(1, requested);
  if (wanted > 1 && !options.supportsConcurrency) {
    return {
      requested,
      effective: 1,
      sandboxMode: false,
      notice: `Harness does not support concurrent task execution; --concurrency ${wanted} falls back to 1.`,
    };
  }
  return { requested, effective: wanted, sandboxMode: wanted > 1 };
}

function loadManifest(path: string): ExecutionManifest {
  const manifest = JSON.parse(readFileSync(path, "utf8")) as ExecutionManifest;
  if (manifest.sourceLayout !== "features") throw new Error("Feature-based manifest required. Convert legacy requirements into docs/PRD.md + docs/features/*.md and recompile before execution.");
  return manifest;
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
// ─── Single-task executor ─────────────────────────────────────────────────────

/**
 * What a finished task reports back to the engine.
 *
 * The engine is the only writer of `WorkflowState`: a task owns one
 * `TaskRecord`, hands it to `env.checkpoint` for durability while it runs, and
 * returns it here. It never derives a whole state from a snapshot, which is
 * what previously lost updates when more than one task ran at a time.
 */
export interface TaskOutcome {
  taskId: string;
  record: TaskRecord;
  /** The task asked the run to pause (human review, control file, signal). */
  pauseRequested?: boolean;
  /** Sandbox the task ran in; the engine integrates from it before destroying it. */
  sandboxPath?: string;
  /** Repository-relative paths the task changed inside its sandbox. */
  changedPaths?: string[];
  /**
   * Artifact the task synthesised before the engine integrated its work. If
   * integration then fails, the artifact is downgraded so downstream tasks
   * never consume output that was never merged.
   */
  artifactId?: string;
}

interface TaskEnvironment {
  agents: AgentDescriptor[];
  opts: EngineOptions;
  store: ArtifactStore;
  shouldStop: () => boolean;
  runId: string;
  /** Root that owns engine state, artifacts, and evidence files. */
  engineRoot: string;
  /**
   * Root the harness, output verification, and validation commands run in.
   * Equal to `engineRoot` unless the task has its own sandbox.
   */
  workspaceRoot: string;
  /** Single-writer durability hook owned by the engine. */
  checkpoint: (record: TaskRecord) => Promise<void>;
}

async function executeTask(
  entry: FlatTask,
  initial: TaskRecord,
  env: TaskEnvironment,
): Promise<TaskOutcome> {
  const { task } = entry;
  const { opts, store, workspaceRoot: workspace, engineRoot } = env;

  if (task.contract?.kind === "human-review") {
    // Human review never touches the worktree: it reads operator evidence from
    // the engine root, so it is never sandboxed.
    if (env.shouldStop()) return { taskId: task.id, record: initial };
    taskReferenceContext(engineRoot, task);
    if (!humanTaskApproved(engineRoot, task)) {
      const note = `Human review required for '${task.id}'. Record operator evidence with workflow-engine approve-task, then resume. --yes does not approve human work.`;
      console.log(`[engine] ${note}`);
      const paused = { ...initial, errorMessage: note };
      await env.checkpoint(paused);
      return { taskId: task.id, record: paused, pauseRequested: true };
    }
    const artifact = task.produces ? store.write({ type: task.produces, category: "work", taskId: task.id, producedBy: "human-reviewer", status: "complete", summary: `Operator evidence verified for ${task.title}`, filesChanged: [task.contract.reviewFile!], inputs: [], payload: { reviewFile: task.contract.reviewFile }, nextActions: [] }) : undefined;
    writeAuditEvent(opts.auditPath, { timestamp: new Date().toISOString(), action: "task.complete", runId: env.runId, taskId: task.id, note: `Human attestation: ${task.contract.reviewFile}` });
    const completed = completeRecord(startRecord(initial), [task.contract.reviewFile!], "Human review approved with evidence.", artifact?.artifactId);
    await env.checkpoint(completed);
    return { taskId: task.id, record: completed, artifactId: artifact?.artifactId };
  }

  const agent = findAgentForTask(env.agents, task.ownerAgent);

  // A stop/pause was requested while this task was queued in the current wave.
  // Leave it pending so the run resumes it later instead of starting it.
  if (env.shouldStop()) {
    console.log(`[engine] Stop requested before task ${task.id} started; leaving it pending.`);
    return { taskId: task.id, record: initial };
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
        runId: env.runId,
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

  let current = startRecord(initial);
  // Persist the "running" status so snapshots/dashboards (and reconnects) see
  // in-flight work instead of a stale "pending". Safe on restart: runEngine
  // normalizes any leftover "running" tasks back to "pending" on load.
  await env.checkpoint(current);
  writeAuditEvent(opts.auditPath, {
    timestamp: new Date().toISOString(),
    action: "task.started",
    runId: env.runId,
    taskId: task.id,
    phaseId: entry.phaseId,
    attempt: current.attempt,
  });

  // Output-verification baseline: a snapshot of the working tree taken before
  // the harness runs. It supports both the no-op heuristic and Git-based
  // output-file enrichment for in-place edits, even when --allow-noop disables
  // only the no-op rejection check. Taken after sandbox seeding, so seeded
  // engine metadata never counts as task work.
  const baseline = await captureWorktree(workspace);

  console.log(`[engine] Starting task ${task.id}: ${task.title} (@${agent.name})`);

  const cancelAttempt = async (): Promise<TaskOutcome> => {
    current = {
      ...current,
      status: "pending", startedAt: undefined, completedAt: undefined,
      errorMessage: "Task cancelled", failureKind: "cancelled",
    };
    writeAuditEvent(opts.auditPath, {
      timestamp: new Date().toISOString(), action: "task.cancelled", runId: env.runId, taskId: task.id,
      note: "Attempt cancelled; task remains pending for resume",
    });
    await env.checkpoint(current);
    return { taskId: task.id, record: current, pauseRequested: true };
  };

  const leavePending = async (note: string): Promise<TaskOutcome> => {
    current = { ...current, status: "pending", startedAt: undefined, errorMessage: note };
    await env.checkpoint(current);
    return { taskId: task.id, record: current, pauseRequested: true };
  };

  let previousAttempt = current.attemptHistory?.at(-1);
  let previousFailure = current.errorMessage ?? previousAttempt?.reason;
  let previousResultPath = previousAttempt?.resultPath;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt += 1) {
    if (attempt > 0) {
      // A stop/pause arrived during the failed attempt. Do not start another
      // retry; reset the task back to pending so the run resumes it later.
      if (env.shouldStop()) {
        console.log(`[engine] Stop requested between attempts for task ${task.id}; leaving it pending.`);
        return leavePending("Stop requested between attempts");
      }
      console.log(`[engine] Retrying task ${task.id} (attempt ${attempt + 1}/${opts.maxRetries + 1})`);
      writeAuditEvent(opts.auditPath, {
        timestamp: new Date().toISOString(),
        action: "task.retrying",
        runId: env.runId,
        taskId: task.id,
        attempt: current.attempt + 1,
        note: previousFailure,
        resultPath: previousResultPath,
      });
      await sleep(opts.retryDelayMs);
      if (env.shouldStop()) return leavePending("Stop requested before retry");
      current = startRecord(current);
      await env.checkpoint(current);
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
        agent, task, repoRoot: workspace, contextBlock,
        defaultModel: opts.harness.defaultModel, timeoutMs: opts.taskTimeoutMs,
        maxRetries: opts.maxRetries, attempt: current.attempt,
        previousFailure, previousResultPath,
        runId: env.runId, signal: opts.signal,
        logHarnessActivity: opts.logHarnessActivity,
      }));
    } catch (error) {
      const message = `Adapter exception: ${error instanceof Error ? error.message : String(error)}`;
      result = { success: false, outputFiles: [], stdout: "", stderr: "", durationMs: Date.now() - invokeStart,
        errorMessage: message, failureKind: opts.signal?.aborted ? "cancelled" : "exception" };
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }

    const gates: TaskGateResult[] = (["harness", "outputs", "handoff", "requirements", "validation"] as const)
      .map((gate) => ({ gate, status: "skipped", reason: "Not reached" }));
    const setGate = (gate: TaskGateResult["gate"], status: TaskGateResult["status"], reason?: string, evidence?: string[]) => {
      Object.assign(gates.find((entry) => entry.gate === gate)!, { status, reason, evidence });
    };
    const recordAttempt = async (outcome: TaskAttemptSummary["outcome"], reason?: string) => {
      const resultPath = writeTaskAttempt(engineRoot, {
        runId: env.runId, taskId: task.id, attempt: current.attempt, outcome, reason, result, gates,
      });
      current = {
        ...current,
        attemptHistory: [...(current.attemptHistory ?? []), { attempt: current.attempt, outcome, reason, resultPath }],
        errorMessage: reason,
      };
      await env.checkpoint(current);
      writeAuditEvent(opts.auditPath, {
        timestamp: new Date().toISOString(), action: "task.attempt.finished", runId: env.runId,
        taskId: task.id, phaseId: entry.phaseId, attempt: current.attempt, durationMs: result.durationMs,
        note: reason ?? "All applicable completion gates passed", resultPath,
      });
      previousFailure = reason;
      previousResultPath = resultPath;
      console.log(`[engine] Task ${task.id} attempt ${current.attempt} ${outcome}: ${reason ?? "completion gates passed"} (result ${resultPath})`);
    };

    // Record a failed attempt (either the harness failed or the output gate
    // rejected a hollow "success"). Exhausting retries marks the task failed.
    const failTask = async (msg: string): Promise<TaskOutcome> => {
      console.error(`[engine] Task ${task.id} FAILED after ${attempt + 1} attempt(s): ${msg}`);
      current = { ...failRecord(current, msg), failureKind: result.failureKind ?? "retryable" };
      await env.checkpoint(current);
      writeAuditEvent(opts.auditPath, {
        timestamp: new Date().toISOString(),
        action: "task.failed",
        runId: env.runId,
        taskId: task.id,
        phaseId: entry.phaseId,
        durationMs: result.durationMs,
        note: msg,
      });
      return { taskId: task.id, record: current };
    };

    if (opts.signal?.aborted) {
      setGate("harness", "failed", "Task cancelled");
      await recordAttempt("cancelled", "Task cancelled");
      return cancelAttempt();
    }

    setGate("harness", result.success ? "passed" : "failed", result.success ? undefined : result.errorMessage ?? result.stderr);

    if (result.success) {
      // ── Output verification: never report a task complete with no evidence ─
      const verified = await verifyTaskResult(task, result, baseline, {
        repoRoot: workspace,
        allowNoop: opts.allowNoop,
        runValidation: Boolean(task.contract) || opts.runValidation,
      });
      setGate("outputs", verified.ok ? "passed" : "failed", verified.reason);
      let failReason = verified.ok ? undefined : verified.reason;
      let validationEvidence: string[] | undefined;
      let validationLimitations: string[] | undefined;
      if (!failReason && task.contract) {
        const report = readTaskHandoff(result.stdout);
        const handoff = report.handoff;
        if (!handoff) failReason = report.error;
        setGate("handoff", handoff ? "passed" : "failed", handoff ? undefined : failReason);
        if (handoff) {
          validationLimitations = handoff.validationLimitations;
          if (handoff.unresolved.length) failReason = `Unresolved task requirements: ${handoff.unresolved.join("; ")}`;
          setGate("requirements", failReason ? "failed" : "passed", failReason);
        }
      } else if (!task.contract) {
        setGate("handoff", "skipped", "Legacy task has no structured contract");
        setGate("requirements", "skipped", "Legacy task has no structured contract");
      }

      if (!failReason && (task.contract || opts.runValidation)) {
        const validation = await runTaskValidation(task, workspace, task.timeoutMs ?? opts.taskTimeoutMs);
        if (!validation.ok) failReason = validation.reason;
        else validationEvidence = task.validationCommands.map((command) => `${command}: exit 0 (engine-verified)`);
        setGate("validation", task.validationCommands.length ? (validation.ok ? "passed" : "failed") : "skipped",
          task.validationCommands.length ? validation.reason : "No manifest validation commands", validationEvidence);
      } else if (!task.contract && !opts.runValidation) {
        setGate("validation", "skipped", "Legacy validation disabled");
      }

      if (failReason) {
        await recordAttempt("failed", failReason);
        if (attempt === opts.maxRetries) return failTask(failReason);
        continue; // hollow success → retry
      }

      // ── Enrich output files from git diff ─────────────────────────────────
      // Adapters only check `expectedOutputs` for output files, which misses
      // files the agent modified in place.  Diff the worktree against the
      // pre-task baseline to capture every file that changed during this task
      // and merge with any files the adapter already reported.  In sandbox mode
      // the workspace holds this task alone, so the diff is exact.
      let changedPaths: string[] | undefined;
      if (baseline) {
        const after = await captureWorktree(workspace);
        const gitChanged = diffWorktree(baseline, after);
        if (gitChanged.length > 0) {
          const merged = new Set([...result.outputFiles, ...gitChanged]);
          result = { ...result, outputFiles: [...merged] };
          changedPaths = gitChanged;
        }
      }

      await recordAttempt("passed");

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
          validationEvidence,
          inputArtifactIds,
        });
        artifactId = artifact.artifactId;

        writeAuditEvent(opts.auditPath, {
          timestamp: new Date().toISOString(),
          action: "artifact.created",
          runId: env.runId,
          taskId: task.id,
          artifactId: artifact.artifactId,
          artifactType: artifact.type,
          inputArtifacts: inputArtifactIds,
        });

        console.log(`[engine] Artifact created: ${artifact.artifactId} (${artifact.type})`);
      }

      current = completeRecord(
        current,
        result.outputFiles,
        result.stdout,
        artifactId,
        inputArtifactIds.length > 0 ? inputArtifactIds : undefined,
        validationLimitations,
      );
      await env.checkpoint(current);
      writeAuditEvent(opts.auditPath, {
        timestamp: new Date().toISOString(),
        action: "task.complete",
        runId: env.runId,
        taskId: task.id,
        phaseId: entry.phaseId,
        outputFiles: result.outputFiles,
        durationMs: result.durationMs,
      });
      console.log(`[engine] Task ${task.id} complete (${result.durationMs}ms)`);
      return { taskId: task.id, record: current, changedPaths, artifactId };
    }

    await recordAttempt(result.failureKind === "cancelled" ? "cancelled" : "failed", result.errorMessage ?? result.stderr);
    if (attempt === opts.maxRetries || result.failureKind === "configuration" ||
        result.failureKind === "exception" || result.failureKind === "cancelled") {
      return failTask(result.errorMessage ?? result.stderr);
    }
  }

  return { taskId: task.id, record: current };
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
      task.contract?.kind !== "human-review" &&
      !findAgentForTask(agents, task.ownerAgent));
    if (unresolved.length > 0) {
      throw new Error(`Missing required owners: ${unresolved.map(({ task }) => `${task.id} (${task.ownerAgent ?? "unassigned"})`).join(", ")}. Restore agent files or correct ownerAgent and recompile.`);
    }
    for (const { task } of flattenManifest(manifest)) {
      if ((selected && !selected.has(task.id)) || isTaskDone(state.tasks[task.id]?.status)) continue;
      if (task.contract?.kind === "human-review") {
        taskReferenceContext(opts.repoRoot, task);
        continue;
      }
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

  const invalidated = new Set(flattenManifest(manifest).filter(({ task }) =>
    task.contract?.kind === "human-review" && isTaskDone(state.tasks[task.id]?.status) && !humanTaskApproved(opts.repoRoot, task),
  ).map(({ task }) => task.id));
  let previousSize = -1;
  while (previousSize !== invalidated.size) {
    previousSize = invalidated.size;
    for (const { task, phaseIndex } of flattenManifest(manifest)) {
      const dependencies = [...task.dependencies, ...manifest.phases[phaseIndex]!.dependencies.flatMap((id) => manifest.phases.find((phase) => phase.id === id)?.tasks.map((entry) => entry.id) ?? [])];
      if (dependencies.some((id) => invalidated.has(id))) invalidated.add(task.id);
    }
  }
  if (invalidated.size) {
    state = { ...state, status: "paused", tasks: { ...state.tasks } };
    for (const id of invalidated) state.tasks[id] = { ...state.tasks[id]!, status: "pending", completedAt: undefined, errorMessage: "Human review evidence changed; review and dependent work must be revalidated." };
    saveState(opts.statePath, state);
  }

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
  const concurrency = resolveConcurrency({
    maxConcurrency: opts.maxConcurrency,
    supportsConcurrency: opts.harness.supportsConcurrency,
  });
  if (concurrency.notice) console.warn(`[engine] ${concurrency.notice}`);

  if (concurrency.sandboxMode) {
    const preflight = await preflightSandboxMode(opts.repoRoot);
    if (!preflight.ok) {
      const message = preflight.reason ?? "Parallel task execution is not available in this repository.";
      console.error(`[engine] ${message}`);
      state = { ...state, status: "failed", blockers: [...state.blockers, message] };
      saveState(opts.statePath, state);
      syncProgressMd(opts.progressPath, state, manifest);
      writeAuditEvent(opts.auditPath, { timestamp: new Date().toISOString(), action: "run.failed", runId: state.runId, note: message });
      clearControl(opts.controlPath);
      return state;
    }
    await sweepStaleSandboxes(opts.repoRoot);
    console.log(`[engine] Parallel execution: up to ${concurrency.effective} tasks at once, each in its own git worktree under ${sandboxRoot(opts.repoRoot)}/.`);
  }

  let currentPhaseId: string | undefined;
  // One writer for the whole run: state, sandbox integration, and auto-commit
  // are serialized so concurrent tasks can never interleave git or state writes.
  const queue = createSerialQueue();

  // Stop signal: the in-process flag (SIGINT/SIGTERM) OR a pause/stop request
  // written to the control file by `workflow-engine pause|stop`. Checked at the
  // top of each wave so a running task finishes before the run pauses.
  const shouldStop = (): boolean =>
    Boolean(state.status === "paused" || opts.pauseRequested || opts.stopRequested?.() || opts.signal?.aborted || readControl(opts.controlPath) !== null);

  /**
   * Terminal bookkeeping for one task, run on the engine's single writer queue:
   * copy the task's work back from its sandbox, merge its record, persist, and
   * commit exactly that task's work.
   */
  const finishTask = async (entry: FlatTask, outcome: TaskOutcome, claimed: Set<string>): Promise<void> => {
    let final = outcome;
    if (concurrency.sandboxMode && outcome.sandboxPath && outcome.changedPaths?.length && outcome.record.status === "complete") {
      const integration = await integrateSandbox({
        repoRoot: opts.repoRoot,
        sandbox: outcome.sandboxPath,
        paths: outcome.changedPaths,
        claimed,
      });
      if (integration.conflicts.length > 0) {
        const reason = `Concurrent write overlap on ${integration.conflicts.join(", ")}: another task in this wave already changed these paths. Declare a dependency between the tasks or give them disjoint outputs, then replay this task.`;
        console.error(`[engine] Task ${outcome.taskId} FAILED: ${reason}`);
        writeAuditEvent(opts.auditPath, {
          timestamp: new Date().toISOString(), action: "task.failed", runId: state.runId,
          taskId: outcome.taskId, phaseId: entry.phaseId, note: reason,
        });
        final = { ...outcome, record: { ...failRecord(outcome.record, reason), failureKind: "configuration" } };
        // The task synthesised its artifact before the engine could integrate
        // its work, so the artifact now describes output that was never merged.
        // Downgrade it rather than letting a later task consume it.
        const artifact = outcome.artifactId ? store.read(outcome.artifactId) : null;
        if (artifact) {
          store.write({
            ...artifact,
            status: "failed",
            summary: `Task ${outcome.taskId} was not integrated: ${reason}`,
            filesChanged: [],
          });
        }
      }
    }

    state = withTaskRecord(state, final.record);
    if (final.pauseRequested) state = { ...state, status: "paused" };
    saveState(opts.statePath, state);
    syncProgressMd(opts.progressPath, state, manifest);

    if (opts.autoCommit !== false && final.record.status === "complete") {
      const sha = await commitTaskWork(
        outcome.taskId,
        entry.task.title,
        opts.repoRoot,
        opts.commitMessageTemplate,
      );
      if (sha) {
        writeAuditEvent(opts.auditPath, {
          timestamp: new Date().toISOString(),
          action: "task.committed",
          runId: state.runId,
          taskId: outcome.taskId,
          commitSha: sha,
        });
        console.log(`[engine] Task ${outcome.taskId} committed (${sha.slice(0, 7)})`);
      }
    }
  };

  const runEntry = async (entry: FlatTask, claimed: Set<string>): Promise<void> => {
    // A stop/pause (or an earlier failure in this wave) leaves queued tasks
    // pending so a later run resumes them instead of starting them now.
    if (shouldStop() || hasFailed(state)) return;
    const record = state.tasks[entry.task.id]!;
    const checkpoint = (next: TaskRecord) => queue.run(async () => {
      state = withTaskRecord(state, next);
      saveState(opts.statePath, state);
    });

    const humanReview = entry.task.contract?.kind === "human-review";
    const useSandbox = concurrency.sandboxMode && !humanReview;
    let sandboxPath: string | undefined;
    let provided: string[] = [];
    try {
      if (useSandbox) {
        const sandbox = await createSandbox(opts.repoRoot, entry.task.id, { signal: opts.signal });
        sandboxPath = sandbox.path;
        provided = sandboxProvidedPaths(sandbox);
      }
      const outcome = await executeTask(entry, record, {
        agents,
        opts,
        store,
        shouldStop,
        runId: state.runId,
        engineRoot: opts.repoRoot,
        workspaceRoot: sandboxPath ?? opts.repoRoot,
        checkpoint,
      });
      await queue.run(() => finishTask(entry, {
        ...outcome,
        sandboxPath,
        // Nothing the engine put in the sandbox is the task's work, so it can
        // never be attributed to the task or merged back into the repository.
        changedPaths: outcome.changedPaths?.filter((path) => !provided.some((p) => path === p || path.startsWith(`${p}/`))),
      }, claimed));
    } finally {
      if (sandboxPath) await destroySandbox(opts.repoRoot, sandboxPath);
    }
  };

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

    // Paths already integrated by a task in this wave, so two concurrent tasks
    // that touched the same file fail loudly instead of losing an edit.
    const claimed = new Set<string>();
    await mapLimit(ready, concurrency.effective, (entry) => runEntry(entry, claimed));
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

  // No task is in flight once the dispatcher returns, so the sandbox root can
  // go: a finished run must leave nothing behind in the repository.
  if (concurrency.sandboxMode) await clearSandboxRoot(opts.repoRoot);

  saveState(opts.statePath, state);
  syncProgressMd(opts.progressPath, state, manifest);
  return state;
}

// ─── Replay a single failed task ──────────────────────────────────────────────

async function replayTaskSession(taskId: string, opts: EngineOptions): Promise<WorkflowState> {
  const manifest = loadManifest(opts.manifestPath);
  const loaded = loadState(opts.statePath);
  if (!loaded) throw new Error("No workflow state found. Run the engine first.");
  let state: WorkflowState = loaded;

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
  const incomplete = dependencyIds.filter((id) => {
    const dependency = findTask(manifest, id);
    return !isTaskDone(replayRecords[id]?.status) || (dependency?.contract?.kind === "human-review" && !humanTaskApproved(opts.repoRoot, dependency));
  });
  if (incomplete.length > 0) throw new Error(`Cannot replay '${taskId}': incomplete dependencies ${incomplete.join(", ")}. Run them first.`);
  const agents = await preflightOwners(manifest, {
    ...state, selection: { mode: "manual", taskIds: [taskId] },
  }, opts);
  saveState(opts.statePath, state);
  if (!opts.signal?.aborted) {
    await opts.harness.prepare?.({ repoRoot: opts.repoRoot, runId: state.runId, signal: opts.signal });
  }

  const entry = { phaseId, phaseIndex: manifest.phases.findIndex((p) => p.id === phaseId), task };
  // A replay is a single task, so it always runs in the engine root: there is
  // nothing to overlap and the operator expects to see the work in place.
  const checkpoint = (next: TaskRecord) => {
    state = withTaskRecord(state, next);
    saveState(opts.statePath, state);
  };
  const outcome = await executeTask(entry, state.tasks[taskId]!, {
    agents,
    opts,
    store,
    shouldStop: () => Boolean(opts.signal?.aborted),
    runId: state.runId,
    engineRoot: opts.repoRoot,
    workspaceRoot: opts.repoRoot,
    checkpoint: async (next) => { checkpoint(next); },
  });
  state = withTaskRecord(state, outcome.record);
  if (outcome.pauseRequested) state = { ...state, status: "paused" };
  if ((state.status === "paused" || opts.signal?.aborted) && !isComplete(manifest, state)) {
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
          failed = withTaskRecord(failed, failRecord(record, message));
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
