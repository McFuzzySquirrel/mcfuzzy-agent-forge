import { requirementDefinitions, referenceParts, readReference } from "./requirement-sources.ts";
import type { ManifestTask } from "./types.ts";

export function documentIntegrity(repoRoot: string, documents: Map<string, string>, tasks: ManifestTask[], checkCoverage = true): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const definitions = new Map<string, { file: string; kind: string }>();
  const sources = new Map(documents);
  for (const task of tasks) for (const reference of task.contract?.references ?? []) {
    const { path, selector } = referenceParts(reference);
    if (selector && !sources.has(path)) {
      try { sources.set(path, readReference(repoRoot, path)); } catch (error) { errors.push(String(error)); }
    }
  }
  for (const [file, text] of sources) {
    try {
      for (const definition of requirementDefinitions(text)) {
        const previous = definitions.get(definition.id);
        if (previous) errors.push(`Duplicate canonical definition '${definition.id}' in '${previous.file}' and '${file}'. Reference the owning definition instead.`);
        else definitions.set(definition.id, { file, kind: definition.kind });
      }
    } catch (error) { errors.push(`${file}: ${String(error)}`); }
  }
  const covered = new Set(tasks.flatMap((task) => [...task.contract?.requirements ?? [], ...task.contract?.constraints ?? []]).map((text) => text.split(":")[0]!.trim()));
  if (checkCoverage) for (const [id, definition] of definitions) {
    if (definition.kind === "requirement" && !covered.has(id)) errors.push(`Canonical requirement '${id}' in '${definition.file}' is not covered by an active task.`);
  }
  const bodies = new Map<string, string>();
  for (const task of tasks) {
    if (!task.contract) continue;
    const key = JSON.stringify([task.description.trim(), task.contract.kind, task.contract.requirements, task.contract.acceptanceCriteria, task.contract.constraints, task.expectedOutputs, task.validationCommands]);
    const previous = bodies.get(key);
    if (previous) errors.push(`Duplicate active task bodies '${previous}' and '${task.id}'. Declare one task and reference its ID as a dependency.`);
    else bodies.set(key, task.id);
  }
  const prose = new Map<string, string>();
  for (const [file, text] of documents) {
    let repeats = 0;
    const body = text.replace(/```[^\n]*\n[\s\S]*?```/g, "");
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim().replace(/\s+/g, " ");
      if (line.length < 100 || line.startsWith("#") || /^\*\*(Product Vision|Original PRD):/.test(line)) continue;
      if (prose.has(line)) repeats++;
      else prose.set(line, file);
    }
    if (repeats) warnings.push(`${file}: ${repeats} repeated substantive prose line(s); use canonical IDs and links where possible.`);
  }
  return { errors, warnings };
}