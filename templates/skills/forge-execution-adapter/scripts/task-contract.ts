import { isAbsolute, posix, win32 } from "node:path";
import type { AgentDescriptor, ManifestTask, TaskContract } from "./types.ts";
import { referenceParts, resolveRequirement } from "./requirement-sources.ts";

export function taskPath(value: string): string {
  if (!value.trim() || value.includes("\\") || isAbsolute(value) || win32.isAbsolute(value) || value.includes(":") || value.split("/").includes("..") || posix.normalize(value) !== value || value === ".") {
    throw new Error(`Task path must be a normalized repository-relative file path: '${value}'.`);
  }
  return value;
}

function strings(value: unknown, field: string, required = false): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry.trim()) || (required && !value.length)) {
    throw new Error(`Task contract '${field}' must be ${required ? "a nonempty" : "an"} array of nonempty strings.`);
  }
  return [...new Set(value as string[])];
}

export function validateTaskContract(task: ManifestTask): void {
  const contract = task.contract;
  if (!contract) return;
  if (Object.keys(contract).some((field) => !["version", "kind", "requirements", "acceptanceCriteria", "constraints", "references", "reviewFile"].includes(field))) throw new Error("Unknown task contract field.");
  if (contract.version !== 1 || !["implementation", "human-review"].includes(contract.kind)) throw new Error(`Invalid task contract for '${task.id}'.`);
  for (const field of ["requirements", "acceptanceCriteria"] as const) strings(contract[field], field, true);
  strings(contract.constraints, "constraints");
  strings(contract.references, "references", true).forEach(referenceParts);
  strings(task.expectedOutputs, "expectedOutputs").forEach(taskPath);
  strings(task.validationCommands, "validationCommands", contract.kind === "implementation");
  strings(task.dependencies, "dependencies");
  if (!task.id?.trim() || !task.title?.trim() || !task.description?.trim()) throw new Error("Task id, title and description are required.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(task.id)) throw new Error("Task id must contain only letters, digits, dots, underscores and hyphens.");
  if (contract.kind === "implementation" && (!task.ownerAgent?.trim() || !task.expectedOutputs.length)) throw new Error(`Implementation task '${task.id}' requires an explicit owner and outputs.`);
  if (contract.kind === "implementation" && contract.reviewFile !== undefined) throw new Error("Implementation tasks cannot declare human review files.");
  if (contract.kind === "implementation" && task.expectedOutputs.some((path) => contract.references.some((reference) => referenceParts(reference).path === path))) throw new Error(`Task '${task.id}' must distinguish reference inputs from outputs.`);
  if (contract.kind === "human-review") {
    if (task.ownerAgent !== undefined || task.expectedOutputs.length) throw new Error("Human review tasks cannot declare agent owners or expected outputs.");
    if (!contract.reviewFile) throw new Error(`Human task '${task.id}' requires reviewFile.`);
    taskPath(contract.reviewFile);
    if (contract.references.some((reference) => referenceParts(reference).path === contract.reviewFile)) throw new Error("Human review file cannot overwrite a reference input.");
    if (task.expectedOutputs.includes(contract.reviewFile)) throw new Error("Human review evidence cannot be an agent output.");
    if (task.validationCommands.length) throw new Error("Human review tasks cannot execute validation commands.");
  }
}

export function parseTaskBlocks(body: string, agents: AgentDescriptor[], options: { plannedOwners?: boolean; repoRoot?: string } = {}): ManifestTask[] | undefined {
  if (!body.includes("```forge-task")) return undefined;
  const tasks: ManifestTask[] = [];
  const remainder = body.replace(/```forge-task\s*\r?\n([\s\S]*?)```/g, (_block, json: string) => {
    const value = JSON.parse(json) as Record<string, unknown>;
    const allowed = new Set(["id", "title", "description", "ownerAgent", "dependencies", "expectedOutputs", "validationCommands", "contract", "timeoutMs"]);
    if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("Unknown structured task field.");
    for (const field of ["id", "title", "description"] as const) if (typeof value[field] !== "string") throw new Error(`Task '${field}' must be a string.`);
    if (!value.contract || typeof value.contract !== "object") throw new Error("Structured task requires contract.");
    const authored = value.contract as Record<string, unknown>;
    if (authored.version === 2) {
      if (!options.repoRoot) throw new Error("Version 2 task contracts require a repository root for canonical resolution.");
      if (Object.keys(authored).some((field) => !["version", "kind", "requirements", "requirementRefs", "acceptanceCriteria", "constraints", "constraintRefs", "references", "reviewFile"].includes(field))) throw new Error("Unknown task contract field.");
      const requirementRefs = strings(authored.requirementRefs, "requirementRefs");
      const constraintRefs = strings(authored.constraintRefs, "constraintRefs");
      value.contract = {
        version: 1,
        kind: authored.kind,
        requirements: [...new Set([...strings(authored.requirements, "requirements"), ...requirementRefs.map((reference) => resolveRequirement(options.repoRoot!, reference, "requirement"))])],
        acceptanceCriteria: strings(authored.acceptanceCriteria, "acceptanceCriteria", true),
        constraints: [...new Set([...strings(authored.constraints, "constraints"), ...constraintRefs.map((reference) => resolveRequirement(options.repoRoot!, reference, "constraint"))])],
        references: [...new Set([...strings(authored.references, "references"), ...requirementRefs, ...constraintRefs])],
        ...(authored.reviewFile !== undefined ? { reviewFile: authored.reviewFile } : {}),
      };
    }
    if (value.ownerAgent !== undefined && typeof value.ownerAgent !== "string") throw new Error("Task ownerAgent must be a string.");
    if (value.timeoutMs !== undefined && (typeof value.timeoutMs !== "number" || !Number.isFinite(value.timeoutMs) || value.timeoutMs <= 0)) throw new Error("Task timeout must be positive.");
    const task: ManifestTask = {
      id: value.id as string, title: value.title as string, description: value.description as string,
      ownerAgent: value.ownerAgent as string | undefined,
      dependencies: strings(value.dependencies, "dependencies"),
      expectedOutputs: strings(value.expectedOutputs, "expectedOutputs"),
      validationCommands: strings(value.validationCommands, "validationCommands"),
      contract: value.contract as unknown as TaskContract,
      requiredCapabilities: ["repository-tools"], approvalRequired: false, sourceLines: [],
      produces: `work.${String(value.id).toLowerCase()}`, inputs: [],
      ...(value.timeoutMs !== undefined ? { timeoutMs: value.timeoutMs as number } : {}),
    };
    validateTaskContract(task);
    if (task.contract!.kind === "implementation" && (["forge-team-builder", "project-orchestrator", "workflow-orchestrator"].includes(task.ownerAgent!.toLowerCase()) || (!options.plannedOwners && !agents.some((agent) => agent.name === task.ownerAgent)))) {
      throw new Error(`Task '${task.id}' requires generated implementation owner '${task.ownerAgent}'.`);
    }
    tasks.push(task);
    return "";
  });
  if (!tasks.length || remainder.includes("```forge-task") || /^\s*[-*]\s+\[[ x]\]/m.test(remainder)) throw new Error("Do not mix structured task blocks and task checkboxes in a phase.");
  return tasks;
}