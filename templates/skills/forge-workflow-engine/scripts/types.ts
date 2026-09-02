import type { AgentDescriptor, ExecutionManifest, ManifestTask } from "../../forge-execution-adapter/scripts/types.ts";

export type { AgentDescriptor, ExecutionManifest, ManifestTask };

/** Default per-task timeout (10 minutes), matching the previous hardcoded value. */
export const DEFAULT_TASK_TIMEOUT_MS = 10 * 60 * 1000;

/** Default heartbeat interval (60s) while a task is executing; 0 disables. */
export const DEFAULT_HEARTBEAT_MS = 60 * 1000;

// ─── Task execution status ────────────────────────────────────────────────────

export type TaskStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export type ExecutionMode = "auto" | "manual";
export type SelectionScope = "single" | "range" | "list";

export interface TaskSelection {
  mode: ExecutionMode;
  scope?: SelectionScope;
  taskIds: string[];
}

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
  selection?: TaskSelection;
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
    /**
     * Maximum retries the engine allows for this task before marking it failed
     * (`opts.maxRetries`). Provided so prompt-building adapters can tell the
     * agent its retry budget (e.g. that hollow/invalid results are re-run).
     */
    maxRetries?: number,
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
  /** Absolute path to docs/engine-control.json (pause/stop request channel). */
  controlPath: string;
  /** Absolute path to docs/engine.pid (the engine's own PID, for `stop`). */
  pidPath: string;
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
  /**
   * Auto-commit the working tree after each task completes (one commit per task,
   * sequenced after the wave merge so it is safe with concurrency). Defaults to
   * `true`; set `false` (`--no-auto-commit` / `FORGE_ENGINE_AUTO_COMMIT=0`) to
   * disable. Commit failures are logged and never fail the task or the run.
   */
  autoCommit?: boolean;
  /**
   * Commit message template with `{taskId}` / `{taskTitle}` placeholders.
   * Default: `feat(forge-engine): complete task {taskId} - {taskTitle}`.
   */
  commitMessageTemplate?: string;
  executionMode?: ExecutionMode;
  selectionScope?: SelectionScope;
  selectedTaskIds?: string[];
  pauseRequested: boolean;
  /**
   * In-process stop flag (e.g. set by SIGINT/SIGTERM handlers). The engine
   * checks this alongside the control file at the top of each task wave and
   * stops gracefully (state saved as `paused`) when true. When absent, the
   * control file alone drives stopping.
   */
  stopRequested?: () => boolean;
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
    | "task.committed"
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
  /** Populated for task.committed events */
  commitSha?: string;
  /** Populated for context.projected events */
  sourceTokenEstimate?: number;
  projectedTokenEstimate?: number;
  reductionPercent?: number;
}
