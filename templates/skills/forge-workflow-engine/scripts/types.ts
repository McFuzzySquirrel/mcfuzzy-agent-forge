import type { AgentDescriptor, ExecutionManifest, ManifestTask, TaskCapability } from "../../forge-execution-adapter/scripts/types.ts";

export type { AgentDescriptor, ExecutionManifest, ManifestTask, TaskCapability };

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
  failureKind?: TaskFailureKind;
  attemptHistory?: TaskAttemptSummary[];
  /** ID of the artifact produced by this task, if any */
  artifactId?: string;
  /** IDs of artifacts consumed as input context for this task */
  inputArtifactIds?: string[];
  /** Nonblocking checks the agent reported as not run (from forge-result.validationLimitations) */
  validationLimitations?: string[];
  /** Cumulative token/cost usage across every attempt of this task. */
  usage?: TaskUsage;
}

export interface TaskAttemptSummary {
  attempt: number;
  outcome: "passed" | "failed" | "cancelled";
  resultPath: string;
  reason?: string;
  /** Usage reported for this attempt; accumulated onto the task record. */
  usage?: TaskUsage;
}

/**
 * Token/cost usage reported by a harness for one invocation.
 *
 * A harness that reports no usage yields `{ source: "unavailable", note }`
 * rather than zero counts, so the Console can distinguish "not reported" from
 * "used nothing". `credits` is a harness-specific unit (e.g. Copilot AI
 * Credits) and is never presented as USD.
 */
export interface TaskUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  /** Monetary cost in USD, when the harness reports it. */
  costUsd?: number;
  /** Harness-specific credits (e.g. Copilot AI Credits); not USD. */
  credits?: number;
  source: "harness" | "unavailable";
  note?: string;
}

export interface TaskGateResult {
  gate: "harness" | "outputs" | "handoff" | "requirements" | "validation";
  status: "passed" | "failed" | "skipped";
  reason?: string;
  evidence?: string[];
}

// ─── Workflow run state ───────────────────────────────────────────────────────

export type RunStatus = "running" | "paused" | "complete" | "failed";
export type PhaseStatus = "pending" | "running" | "validating" | "complete" | "failed";

export interface PhaseRecord {
  phaseId: string;
  status: PhaseStatus;
  contractFingerprint: string;
  updatedAt: string;
  validationEvidence?: string[];
  errorMessage?: string;
}

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
  /** Durable phase-level completion gates; absent in state files written before phase gates. */
  phases?: Record<string, PhaseRecord>;
  blockers: string[];
  auditLog: AuditEvent[];
  selection?: TaskSelection;
  /**
   * Native harness session IDs keyed by phase id, populated when
   * `--session-scope phase` reuses one conversation per phase. Absent from
   * state files written before session reuse existed; readers must default.
   */
  sessions?: Record<string, string>;
}

// ─── Harness adapter interface ────────────────────────────────────────────────

export interface TaskResult {
  success: boolean;
  outputFiles: string[];
  stdout: string;
  stderr: string;
  durationMs: number;
  errorMessage?: string;
  failureKind?: TaskFailureKind;
  /** Native harness session ID a capture-strategy adapter assigns to the conversation. */
  sessionId?: string;
  /** Token/cost usage this invocation reported, if any. */
  usage?: TaskUsage;
}

export type TaskFailureKind = "retryable" | "configuration" | "exception" | "timeout" | "cancelled";
export type DeepReadonly<T> = { readonly [K in keyof T]: DeepReadonly<T[K]> };

export interface TaskAttemptRequest {
  readonly agent: DeepReadonly<AgentDescriptor>;
  readonly task: DeepReadonly<ManifestTask>;
  readonly effectiveModel?: string;
  /**
   * Root the task's harness, output verification, and validation commands run
   * in. Equal to the engine's `repoRoot` for a sequential run, and to a
   * per-task `git worktree` sandbox when tasks run concurrently, so
   * `expectedOutputs` and `outputFiles` always resolve against the tree the
   * agent actually edited. See ADR-056.
   */
  readonly repoRoot: string;
  readonly contextBlock: string;
  readonly requiredCapabilities: readonly TaskCapability[];
  readonly attempt: Readonly<{ number: number; maxRetries: number; runId: string }>;
  readonly budget: Readonly<{ timeoutMs: number }>;
  readonly instructions: string;
  readonly signal?: AbortSignal;
  /**
   * Native harness session ID to resume/continue. When set, the adapter threads
   * it through its session-resume flags so tasks in the same phase share one
   * conversation. See `HarnessAdapter.sessionStrategy`.
   */
  readonly sessionId?: string;
  /**
   * When true, CLI harness adapters stream stdout/stderr activity into the
   * engine log as it arrives. Command invocation logging is always on.
   */
  readonly logHarnessActivity?: boolean;
}

export interface HarnessRunContext {
  readonly repoRoot: string;
  readonly runId: string;
  readonly signal?: AbortSignal;
}

/**
 * How a harness reuses one conversation across tasks when `--session-scope
 * phase` is enabled.
 *
 * - `deterministic`: the harness accepts a caller-chosen session ID and creates
 *   the conversation on first use. The engine generates an ID once per phase.
 * - `capture`: the harness assigns its own ID on the first task; the engine
 *   reads it back from the result and reuses it for the rest of the phase.
 *
 * Adapters without a strategy run one fresh, isolated session per task (the
 * default behavior; see ADR-058).
 */
export interface SessionResumeStrategy {
  readonly kind: "deterministic" | "capture";
  /** CLI flags that resume (or create, for deterministic) the session `sessionId`. */
  readonly resumeFlags: (sessionId: string) => string[];
  /** Generate a fresh native ID for a new phase session (deterministic only). */
  readonly newSessionId?: () => string;
  /** Extract the native ID a capture harness assigned (capture only). */
  readonly captureSessionId?: (result: TaskResult) => string | undefined;
}

export interface HarnessAdapter {
  readonly name: string;
  /**
   * Whether the transport tolerates concurrent invocations. Required, but not
   * sufficient: the engine additionally isolates every concurrent task in its
   * own git worktree, so repository-level isolation never rests on the adapter.
   */
  readonly supportsConcurrency: boolean;
  readonly capabilities: readonly TaskCapability[];
  readonly defaultModel?: string;
  /** Session-reuse support; absent means one fresh session per task. */
  readonly sessionStrategy?: SessionResumeStrategy;
  prepare?(context: HarnessRunContext): Promise<void>;
  cleanup?(): Promise<void>;
  invoke(request: TaskAttemptRequest): Promise<TaskResult>;
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
   * Maximum number of ready tasks dispatched at once. `1` (the default) is
   * fully sequential. Above `1` the engine only parallelizes a harness that
   * declares `supportsConcurrency`, and each task then runs in its own
   * `git worktree` so output attribution, validation, and auto-commit stay
   * exact. See ADR-056.
   */
  maxConcurrency: number;
  /**
   * Session granularity for the run. `"phase"` reuses one harness conversation
   * across all tasks in a phase (a new conversation begins at each phase
   * boundary), while `"task"` (the default) runs a fresh session per task.
   * Phase sessions require `--concurrency 1` and a harness that declares a
   * `sessionStrategy`; the engine refuses loudly otherwise.
   */
  sessionScope: "task" | "phase";
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
   * When true (`--log-harness-activity` / `FORGE_ENGINE_LOG_HARNESS_ACTIVITY=1`),
   * CLI harness stdout/stderr is streamed into the engine log as it arrives.
   * Defaults to `false`; command invocation logging is always enabled.
   */
  logHarnessActivity: boolean;
  /**
   * Auto-commit the working tree after each task completes (one commit per task,
   * completed before starting the next task). Defaults to
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
  /** Immediate cancellation, distinct from graceful pause/stop after a task. */
  signal?: AbortSignal;
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
    | "task.cancelled"
    | "task.retrying"
    | "task.attempt.finished"
    | "task.skipped"
    | "task.committed"
    | "phase.started"
    | "phase.complete"
    | "state.saved"
    | "artifact.created"
     | "context.projected"
     | "state.reconciled";
  runId?: string;
  taskId?: string;
  phaseId?: string;
  attempt?: number;
  outputFiles?: string[];
  durationMs?: number;
  resultPath?: string;
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
  /** Token/cost usage for the invocation this event describes, when reported. */
  usage?: TaskUsage;
}
