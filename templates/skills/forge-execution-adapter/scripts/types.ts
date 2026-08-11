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
  prdPath: string;
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
}

export interface ManifestPhase {
  id: string;
  title: string;
  description: string;
  ownerAgents: string[];
  dependencies: string[];
  approvalRequired: boolean;
  tasks: ManifestTask[];
}

export interface ExecutionManifest {
  version: "1.0";
  generatedAt: string;
  repoRoot: string;
  harnessRoot: HarnessRoot;
  prdPath: string;
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
