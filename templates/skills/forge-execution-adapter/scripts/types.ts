export type HarnessRoot = ".agents" | ".github" | ".claude" | ".opencode";

export interface AgentDescriptor {
  name: string;
  description: string;
  path: string;
  model?: string;
  modelFallback?: string;
  expertise: string[];
  collaboration: string[];
  constraints: string[];
  rawBody: string;
}

export interface SkillDescriptor {
  name: string;
  description: string;
  path: string;
  references: string[];
  scripts: string[];
  assets: string[];
}

export interface ForgeRepo {
  repoRoot: string;
  harnessRoot: HarnessRoot;
  agentRoot: string;
  skillRoot: string;
  /** Compile source layout: monolithic `docs/PRD.md`, or decomposed vision + features. */
  sourceLayout: "monolithic" | "features";
  prdPath: string;
  /** `docs/product-vision.md` when the repo is decomposed. */
  visionPath: string;
  /** `docs/features/*.md` in lexical order when the repo is decomposed. */
  featurePaths: string[];
  progressPath: string;
  auditPath: string;
  manifestPath: string;
  agents: AgentDescriptor[];
  skills: SkillDescriptor[];
  warnings: string[];
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
  sourceLines: string[];
  /**
   * Artifact types this task consumes as input context.
   * Example: ["solution.architecture", "solution.requirement"]
   */
  inputs?: string[];
  /**
   * Artifact type this task must produce when it completes successfully.
   * Example: "implementation.result"
   */
  produces?: string;
  /**
   * Optional per-task timeout in milliseconds. Overrides the workflow engine's
   * global default (`--task-timeout-ms` / `FORGE_ENGINE_TASK_TIMEOUT_MS`).
   */
  timeoutMs?: number;
}

export interface ManifestPhase {
  id: string;
  title: string;
  description: string;
  /** Owning feature name in feature mode (e.g. "Budgets"); absent for monolithic. */
  feature?: string;
  ownerAgents: string[];
  dependencies: string[];
  approvalRequired: boolean;
  tasks: ManifestTask[];
}

export interface ExecutionManifest {
  version: "1.0";
  generatedAt: string;
  /** Task decomposition granularity used when compiling the manifest. */
  granularity?: "coarse" | "fine";
  /** Compile source: monolithic `docs/PRD.md` or decomposed vision + features. */
  sourceLayout?: "monolithic" | "features";
  repoRoot: string;
  harnessRoot: HarnessRoot;
  /** The document the build is compiled from (PRD, or vision when decomposed). */
  prdPath: string;
  /** `docs/product-vision.md` in feature mode. */
  visionPath?: string;
  /** Feature names in dependency (execution) order, feature mode only. */
  featureOrder?: string[];
  /** Where the deterministic agent-responsibility matrix was written. */
  responsibilityMatrixPath?: string;
  progressPath: string;
  auditPath: string;
  validationCommands: string[];
  approvalGates: {
    preflight: boolean;
    betweenPhases: boolean;
  };
  phases: ManifestPhase[];
  warnings: string[];
}

export type ProgressStatus = "In Progress" | "Paused" | "Complete";

export interface CompletedTaskRecord {
  taskId: string;
  label: string;
  agent?: string;
  files: string[];
}

export interface ProgressState {
  phase: string;
  status: ProgressStatus;
  prdPath: string;
  lastUpdated: string;
  completed: CompletedTaskRecord[];
  currentTaskId?: string;
  blockers: string[];
  notes: string[];
}

export interface AuditEvent {
  timestamp: string;
  action: string;
  taskId?: string;
  phaseId?: string;
  files?: string[];
  note?: string;
}

// ─── Artifact types ───────────────────────────────────────────────────────────

/**
 * The three semantic categories of artifact, as described in the research doc.
 *
 * - decision  : "What are we building and why?" (requirements, architecture, ADRs)
 * - work      : "What has been done?" (implementation result, test result, review)
 * - evidence  : "How do we know?" (test output, lint, diff, screenshots)
 */
export type ArtifactCategory = "decision" | "work" | "evidence";

/**
 * A compact, typed hand-off object produced by one agent task and consumed
 * (via projection) by subsequent tasks.  The artifact is the token firewall
 * between agents: the next agent receives only the artifact summary + the
 * fields it needs, not the full previous conversation.
 */
export interface Artifact {
  /** Unique identifier, e.g. "architecture-001" */
  artifactId: string;
  /** Dot-separated type, e.g. "solution.architecture" */
  type: string;
  /** Semantic category */
  category: ArtifactCategory;
  /** Task that produced this artifact */
  taskId: string;
  /** Agent that produced this artifact */
  producedBy: string;
  /** ISO timestamp */
  createdAt: string;
  /** complete | failed */
  status: "complete" | "failed";
  /**
   * One-sentence human-readable summary.  This is the field that most
   * downstream agents will receive — it is deliberately terse.
   */
  summary: string;
  /** Confidence score 0–1, optional */
  confidence?: number;
  /** Artifact IDs that were consumed as input to produce this artifact */
  inputs: string[];
  /** Files changed / created by the producing task */
  filesChanged: string[];
  /**
   * The structured payload.  Kept separate from summary so that downstream
   * agents can request only the fields they need (context projection).
   */
  payload: Record<string, unknown>;
  /** Suggested follow-on actions for the workflow engine */
  nextActions: string[];
}

/**
 * A projected (trimmed) view of one or more artifacts, assembled by the
 * workflow engine before handing context to an agent.  Only the fields
 * required by the receiving task are included.
 */
export interface ArtifactProjection {
  taskId: string;
  projectedAt: string;
  artifacts: Array<{
    artifactId: string;
    type: string;
    summary: string;
    confidence?: number;
    selectedFields: Record<string, unknown>;
  }>;
  /** Estimated token count of the full source artifacts */
  sourceTokenEstimate: number;
  /** Estimated token count of this projection */
  projectedTokenEstimate: number;
}
