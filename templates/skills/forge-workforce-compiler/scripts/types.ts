export type HarnessRoot = ".agents" | ".github" | ".claude" | ".opencode";

export interface AgentDescriptor {
  name: string;
  description: string;
  path: string;
  model?: string;
  modelFallback?: string;
  rawBody: string;
}

export interface SkillDescriptor {
  name: string;
  description: string;
  path: string;
}

export interface ForgeRepo {
  repoRoot: string;
  harnessRoot: HarnessRoot;
  agentRoot: string;
  skillRoot: string;
  manifestPath: string;
  progressPath: string;
  statePath: string;
  auditPath: string;
  agents: AgentDescriptor[];
  skills: SkillDescriptor[];
  warnings: string[];
}

export interface ExecutionManifest {
  version: string;
  repoRoot: string;
  harnessRoot: HarnessRoot;
  phases: ManifestPhase[];
  warnings: string[];
}

export interface ManifestPhase {
  id: string;
  title: string;
  tasks: ManifestTask[];
}

export interface ManifestTask {
  id: string;
  title: string;
  description: string;
  ownerAgent?: string;
  expectedOutputs: string[];
  dependencies: string[];
}

export interface WorkforceCompileOptions {
  packageId?: string;
  packageName?: string;
  packageVersion?: string;
  workflowId?: string;
  outputDir?: string;
}

export interface WorkforceCompileResult {
  workforceDir: string;
  workforceManifestPath: string;
  workflowPath: string;
  bridgePath: string;
  warnings: string[];
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}
