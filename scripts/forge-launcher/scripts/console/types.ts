// ─── Forge Console JSON contract ──────────────────────────────────────────────
//
// These are the wire types the console server emits and the browser client
// consumes. The client keeps an identical copy under dashboard/types.ts; keep
// the two in sync.

export interface AuditEvent {
  timestamp: string;
  action: string;
  runId?: string;
  taskId?: string;
  phaseId?: string;
  note?: string;
  durationMs?: number;
  artifactId?: string;
  reductionPercent?: number;
  outputFiles?: string[];
}

export interface TaskRecord {
  taskId: string;
  status: string;
  ownerAgent?: string;
  startedAt?: string;
  completedAt?: string;
  attempt: number;
  outputFiles: string[];
  agentOutput?: string;
  errorMessage?: string;
  artifactId?: string;
  inputArtifactIds?: string[];
}

export interface WorkflowState {
  runId: string;
  startedAt: string;
  lastUpdatedAt: string;
  manifestPath: string;
  manifestVersion: string;
  harness: string;
  status: string;
  currentPhase?: string;
  tasks: Record<string, TaskRecord>;
  blockers: string[];
  selection?: { mode: ExecutionMode; scope?: SelectionScope; taskIds: string[] };
}

export interface ManifestTask {
  id: string;
  title: string;
  description: string;
  ownerAgent?: string;
  dependencies: string[];
  expectedOutputs: string[];
  validationCommands: string[];
  approvalRequired: boolean;
  sourceLines?: string[];
  inputs?: string[];
  produces?: string;
  timeoutMs?: number;
}

export interface ManifestPhase {
  id: string;
  title: string;
  description: string;
  feature?: string;
  ownerAgents: string[];
  dependencies: string[];
  approvalRequired: boolean;
  tasks: ManifestTask[];
}

export interface ExecutionManifest {
  version: string;
  generatedAt: string;
  granularity?: string;
  sourceLayout?: string;
  repoRoot: string;
  harnessRoot: string;
  prdPath: string;
  progressPath: string;
  auditPath: string;
  validationCommands: string[];
  approvalGates: { preflight: boolean; betweenPhases: boolean };
  phases: ManifestPhase[];
  warnings: string[];
}

export interface RunCounts {
  pending: number;
  running: number;
  complete: number;
  failed: number;
  skipped: number;
}

export interface RunSummary {
  runId: string;
  status: string;
  startedAt: string | null;
  lastUpdatedAt: string | null;
  completedDurationMs: number;
  currentPhase: string | null;
  currentPhaseTitle: string | null;
  counts: RunCounts;
  total: number;
  blockers: string[];
}

export interface ManifestSummary {
  version: string;
  generatedAt: string;
  granularity?: string;
  phases: number;
  tasks: number;
}

export interface Summary {
  repoRoot: string;
  repoName: string;
  harness: string | null;
  hasIdea: boolean;
  hasPrd: boolean;
  hasVision: boolean;
  hasFeatures: boolean;
  hasTeam: boolean;
  hasManifest: boolean;
  manifest: ManifestSummary | null;
  run: RunSummary | null;
  live: boolean;
  control: string | null;
  logExists: boolean;
  defaultTimeoutMs: number | null;
  /** Auto-commit after each completed task (engine-config; default on). */
  autoCommit: boolean;
  /** Max agents to run in parallel (engine-config; 0 or absent means engine default). */
  concurrency: number;
  /** Auto runs the full ready workflow; manual runs only the selected task set. */
  executionMode: ExecutionMode;
  /** How the current manual task set was selected. */
  selectionScope: SelectionScope | null;
  /** Explicit task ids to run when executionMode is "manual". */
  selectedTaskIds: string[];
  /** Convenience count for UI labels. */
  selectedTaskCount: number;
  /** Most recent background job associated with this repo, if any. */
  job: BackgroundJob | null;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string;
  phaseId: string;
  phaseTitle: string;
  ownerAgent: string | null;
  status: string;
  attempt: number;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  outputFiles: string[];
  errorMessage: string | null;
  artifactId: string | null;
  inputs: string[];
  produces: string | null;
  dependencies: string[];
  expectedOutputs: string[];
  validationCommands: string[];
  timeoutMs: number | null;
  approvalRequired: boolean;
}

export interface ArtifactMeta {
  artifactId: string;
  type: string;
  category: string;
  taskId: string;
  producedBy: string;
  status: string;
  summary: string;
  confidence?: number;
  createdAt: string;
  filesChanged: string[];
  inputs: string[];
}

export interface ArtifactIndex {
  artifacts: ArtifactMeta[];
  types: string[];
}

export interface DocEntry {
  id: string;
  kind: string;
  title: string;
  relPath: string;
  exists: boolean;
}

export interface DocsIndex {
  entries: DocEntry[];
}

export interface AgentInfo {
  name: string;
  description: string;
  model?: string;
  modelFallback?: string;
  path: string;
  relPath: string;
  expertise: string[];
  collaboration: string[];
  constraints: string[];
}

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  relPath: string;
  /** Whether the skill was bootstrapped from the forge templates ("forge") or generated for the project ("project"). */
  category: "forge" | "project";
}

export interface TeamIndex {
  harnessRoot: string | null;
  agents: AgentInfo[];
  skills: SkillInfo[];
}

export interface Actions {
  canRun: boolean;
  canResume: boolean;
  canPause: boolean;
  canStop: boolean;
  failedTasks: string[];
}

export interface ProjectInfo {
  path: string;
  name: string;
  harness?: string;
  createdAt?: string;
  lastOpenedAt?: string;
  stage: string;
  job?: BackgroundJob | null;
}

export interface ProjectsIndex {
  projects: ProjectInfo[];
  current: string | null;
}

export interface LogsResponse {
  lines: string[];
  truncated: boolean;
}

export interface FileContent {
  path: string;
  content: string;
}

export type ControlAction = "run" | "resume" | "pause" | "stop" | "replay" | "draft-prd" | "draft-team" | "compile-manifest" | "feature-prd" | "feature-increment";

export type ExecutionMode = "auto" | "manual";
export type SelectionScope = "single" | "range" | "list";

export type BackgroundJobType =
  | "create-project"
  | "bootstrap"
  | "feature-prd"
  | "feature-increment"
  | "draft-prd"
  | "draft-team"
  | "compile-manifest"
  | "engine-run"
  | "engine-resume"
  | "engine-replay";

export type BackgroundJobStatus = "running" | "complete" | "failed" | "paused";

export interface BackgroundJob {
  id: string;
  type: BackgroundJobType;
  repoPath: string;
  pid?: number;
  taskId?: string;
  logPath?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  status: BackgroundJobStatus;
  message: string;
  run?: boolean;
}

export interface ControlResult {
  ok: boolean;
  message: string;
  pid?: number;
  job?: BackgroundJob;
}

export interface TimeoutUpdateResult {
  ok: boolean;
  message: string;
  taskId?: string;
  affected?: number;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  harness?: string;
  visibility?: string;
  parentDir?: string;
  idea: string;
  autoDraft?: boolean;
  /** Max agents to run in parallel (0 means engine default). */
  concurrency?: number;
  /** Server-side path of an existing PRD file to copy into the new repo as docs/PRD.md. */
  prdPath?: string;
  /** Server-side paths of research/seed docs to copy into the new repo's docs/research/. */
  researchPaths?: string[];
}

export interface UploadResult {
  ok: boolean;
  path?: string;
  name?: string;
  message?: string;
}

export interface LaunchCliResult {
  ok: boolean;
  launched?: boolean;
  cli?: string;
  command?: string;
  message?: string;
}

export interface CreateProjectResult {
  ok: boolean;
  message: string;
  repoDir?: string;
  logFile?: string;
  pid?: number;
  job?: BackgroundJob;
}

export interface SelectResult {
  ok: boolean;
  repoRoot?: string;
  message?: string;
}

export interface OpenResult {
  ok: boolean;
  message?: string;
}
