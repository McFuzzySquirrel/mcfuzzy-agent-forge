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

export type ControlAction = "run" | "resume" | "pause" | "stop" | "replay" | "draft-prd" | "draft-team";

export interface ControlResult {
  ok: boolean;
  message: string;
  pid?: number;
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
}

export interface CreateProjectResult {
  ok: boolean;
  message: string;
  repoDir?: string;
  logFile?: string;
  pid?: number;
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
