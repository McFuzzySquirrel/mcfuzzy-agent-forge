import type { AgentDescriptor, ExecutionManifest, ManifestTask } from "../../forge-execution-adapter/scripts/types.ts";

export type { AgentDescriptor, ExecutionManifest, ManifestTask };

/** Default per-task timeout (10 minutes), matching the previous hardcoded value. */
export const DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000;

// ─── Task execution status ────────────────────────────────────────────────────

export type TaskStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export interface TaskRecord {
  taskId: string;
  status: TaskStatus;
  ownerAgent?: string;
  startedAt?: string;
  completedAt?: string;
  attempt: number;
  outputFiles: string[];
  agentOutput?: string;
  errorMessage?: string;
  /** ID of the artifact produced by this task, if any */
  artifactId?: string;
  /** IDs of artifacts consumed as input context for this task */
  inputArtifactIds?: string[];
}

// ─── Workflow run state ───────────────────────────────────────────────────────

export type RunStatus = "running" | "paused" | "complete" | "failed";

export interface WorkflowState {
  runId: string;
  startedAt: string;
  lastUpdatedAt: string;
  manifestPath: string;
  manifestVersion: string;
  harness: string;
  status: RunStatus;
  currentPhase?: string;
  tasks: Record<string, TaskRecord>;
  blockers: string[];
  auditLog: AuditEvent[];
}

// ─── Harness adapter interface ────────────────────────────────────────────────

export interface TaskResult {
  success: boolean;
  outputFiles: string[];
  stdout: string;
  stderr: string;
  durationMs: number;
  errorMessage?: string;
}

export interface HarnessAdapter {
  name: string;
  /**
   * True when the adapter can be safely invoked concurrently (stateless and
   * non-blocking).  The engine only parallelizes ready tasks when the selected
   * harness opts in; otherwise it forces sequential execution.
   */
  supportsConcurrency: boolean;
  invoke(
    agent: AgentDescriptor,
    task: ManifestTask,
    context: WorkflowState,
    repoRoot: string,
    /**
     * Optional pre-rendered context projection markdown block.
     * When provided by the engine, the adapter prepends this to the
     * user prompt so the agent sees only the projected artifact summary
     * rather than the full workflow state.
     */
    contextBlock?: string,
    /**
     * Effective per-task timeout in milliseconds. Computed by the engine as
     * `task.timeoutMs ?? opts.taskTimeoutMs`. Adapters should use this instead
     * of a hardcoded timeout; `undefined` means "use the adapter default".
     */
    timeoutMs?: number,
  ): Promise<TaskResult>;
}

// ─── Engine options ───────────────────────────────────────────────────────────

export interface EngineOptions {
  repoRoot: string;
  manifestPath: string;
  statePath: string;
  progressPath: string;
  auditPath: string;
  /** Absolute path to docs/artifacts directory (artifact store root) */
  artifactsPath: string;
  harness: HarnessAdapter;
  maxRetries: number;
  retryDelayMs: number;
  /** Interval (ms) between heartbeat lines while a task is executing; 0 disables. */
  heartbeatMs: number;
  /**
   * Maximum number of ready tasks to execute concurrently. Values <= 1 run
   * sequentially (the previous behavior). Ignored when the harness does not
   * declare `supportsConcurrency`.
   */
  maxConcurrency: number;
  /**
   * Default per-task timeout in milliseconds, used when a task does not declare
   * its own `timeoutMs`. Defaults to `DEFAULT_TASK_TIMEOUT_MS`.
   */
  taskTimeoutMs: number;
  /**
   * Output-verification gate. When `false` (default, strict) a task whose
   * `expectedOutputs` are missing, or (when it declares none) that produced no
   * file changes and only trivial agent output, is treated as a failed attempt
   * and retried / marked failed — it is never reported complete. Set `true`
   * (`--allow-noop` / `FORGE_ENGINE_ALLOW_NOOP=1`) to skip the no-op heuristic
   * (the expected-output check stays).
   */
  allowNoop: boolean;
  /**
   * When `true` (`--run-validation` / `FORGE_ENGINE_RUN_VALIDATION=1`), execute
   * each task's manifest `validationCommands` (cwd = repo root) after the
   * harness call and require them to pass before the task is marked complete.
   */
  runValidation: boolean;
  pauseRequested: boolean;
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export interface AuditEvent {
  timestamp: string;
  action:
    | "run.started"
    | "run.paused"
    | "run.resumed"
    | "run.complete"
    | "run.failed"
    | "task.started"
    | "task.complete"
    | "task.failed"
    | "task.retrying"
    | "task.skipped"
    | "phase.started"
    | "phase.complete"
    | "state.saved"
    | "artifact.created"
    | "context.projected";
  runId?: string;
  taskId?: string;
  phaseId?: string;
  attempt?: number;
  outputFiles?: string[];
  durationMs?: number;
  note?: string;
  /** Populated for artifact.created events */
  artifactId?: string;
  artifactType?: string;
  inputArtifacts?: string[];
  /** Populated for context.projected events */
  sourceTokenEstimate?: number;
  projectedTokenEstimate?: number;
  reductionPercent?: number;
}
