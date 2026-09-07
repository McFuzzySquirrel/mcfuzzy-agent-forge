import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTaskBlocks, taskPath } from "./task-contract.ts";
import type { ManifestTask } from "./types.ts";
import { resolvedReferenceBlocks } from "./requirement-sources.ts";
import { parseFeatureGraph, type FeatureNode } from "./compiler.ts";
import { documentIntegrity } from "./document-integrity.ts";

export interface PrdValidation {
  outputs: string[];
  errors: string[];
  warnings: string[];
  taskCount: number;
  sourceLayout: "features";
}

export function validatePrd(repoRoot: string, options: { featureFiles?: string[]; requireContracts?: boolean } = {}): PrdValidation {
  const root = realpathSync(repoRoot);
  const result: PrdValidation = { outputs: [], errors: [], warnings: [], taskCount: 0, sourceLayout: "features" };
  const read = (file: string): string => {
    taskPath(file);
    const full = join(root, file);
    const rel = relative(root, realpathSync(full));
    if (rel === ".." || rel.startsWith(`..\\`) || rel.startsWith("../") || isAbsolute(rel)) throw new Error(`File escapes repository: ${file}`);
    if (!statSync(full).isFile()) throw new Error(`Expected a file: ${file}`);
    const text = readFileSync(full, "utf8");
    if (!text.trim()) throw new Error(`Empty file: ${file}`);
    return text;
  };
  const featureDir = join(root, "docs/features");
  const featureFiles = existsSync(featureDir) ? readdirSync(featureDir).filter((file) => file.endsWith(".md")).map((file) => `docs/features/${file}`) : [];
  let files: string[];
  let features: FeatureNode[] = [];
  try {
    if (!existsSync(join(root, "docs/PRD.md"))) throw new Error("Missing docs/PRD.md. Every solution requires a product vision and at least one feature.");
    if (!featureFiles.length) throw new Error("Every solution requires non-empty docs/features/*.md files.");
    if (options.featureFiles) {
      if (!options.featureFiles.length || options.featureFiles.some((file) => !/^docs\/features\/[^/]+\.md$/.test(file))) throw new Error("Select at least one canonical docs/features/*.md file.");
      for (const file of options.featureFiles) if (!featureFiles.includes(file)) throw new Error(`Missing selected feature '${file}'.`);
    }
    const vision = read("docs/PRD.md");
    const warnings: string[] = [];
    features = parseFeatureGraph(vision, featureFiles.map((file) => join(root, file)), root, join(root, "docs"), warnings);
    if (options.requireContracts !== false) result.errors.push(...warnings);
    const names = new Set(features.map((feature) => feature.name));
    if (names.size !== features.length) result.errors.push("Duplicate feature names in dependency table.");
    if (new Set(features.map((feature) => feature.file)).size !== features.length) result.errors.push("Duplicate feature files in dependency table.");
    for (const feature of features) {
      if (!featureFiles.some((file) => join(root, file) === feature.file)) result.errors.push(`Feature '${feature.name}' must reference a docs/features/*.md file.`);
      for (const dependency of feature.dependencies) if (!names.has(dependency)) result.errors.push(`Feature '${feature.name}' has unknown dependency '${dependency}'.`);
    }
    for (const file of featureFiles) if (!features.some((feature) => feature.file === join(root, file))) result.errors.push(`Feature file '${file}' is missing from the vision dependency table.`);
    if (!options.featureFiles) result.outputs.push("docs/PRD.md");
    files = featureFiles;
  } catch (error) {
    result.errors.push(`${String(error)} Run forge-build-prd to author features, or forge-decompose-prd to convert a supplied legacy document. Legacy PRDs are source material only.`);
    return result;
  }
  const tasks = new Map<string, ManifestTask>();
  const tasksByFile = new Map<string, string[]>();
  const phaseDependencies = new Map<string, string[]>();
  for (const file of files) {
    try {
      const text = read(file);
      if ((!options.featureFiles || options.featureFiles.includes(file)) && !result.outputs.includes(file)) result.outputs.push(file);
      const lines = text.split(/\r?\n/);
      let fence = false;
      let inPhase = false;
      let phaseLevel = 0;
      let phaseTasks: string[] = [];
      let priorPhaseTasks: string[] = [];
      let found = 0;
      let phaseName = "";
      const checkPhase = (): void => {
        if (inPhase && !phaseTasks.length && options.requireContracts !== false) result.errors.push(`${file}: ${phaseName} contains no valid structured tasks.`);
      };
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!;
        const heading = !fence ? line.match(/^(#{1,6})\s+(.+)$/) : null;
        if (heading) {
          if (/^Phase\s+\d+\b/i.test(heading[2]!)) {
            checkPhase();
            priorPhaseTasks = [...priorPhaseTasks, ...phaseTasks];
            phaseTasks = [];
            inPhase = true;
            phaseName = heading[2]!;
            phaseLevel = heading[1]!.length;
          } else if (heading[1]!.length <= phaseLevel) {
            checkPhase();
            inPhase = false;
          }
        }
        if (!fence && line.trim() === "```forge-task") {
          const start = index;
          while (++index < lines.length && lines[index]!.trim() !== "```") { }
          const location = `${file}:${start + 1}`;
          if (!inPhase) result.errors.push(`${location}: forge-task must be inside a Phase N heading.`);
          try {
            const task = parseTaskBlocks(lines.slice(start, index + 1).join("\n"), [], { plannedOwners: true, repoRoot: root })![0]!;
            found++;
            if (tasks.has(task.id)) throw new Error(`Duplicate global task ID '${task.id}'.`);
            tasks.set(task.id, task);
            tasksByFile.set(file, [...tasksByFile.get(file) ?? [], task.id]);
            phaseDependencies.set(task.id, priorPhaseTasks);
            phaseTasks.push(task.id);
            resolvedReferenceBlocks(root, task.contract!.references);
            for (const output of task.expectedOutputs) {
              if ((existsSync(join(root, output)) && statSync(join(root, output)).isDirectory()) || (!basename(output).includes(".") && !["Dockerfile", "Makefile", "LICENSE"].includes(basename(output)))) throw new Error(`Output '${output}' must name a concrete deliverable file, not a directory.`);
            }
          } catch (error) { result.errors.push(`${location}: ${String(error)}`); }
          continue;
        }
        if (/^\s*```/.test(line)) fence = !fence;
        if (!fence && inPhase && /^\s*[-*]\s+\[[ x]\]/i.test(line) && text.includes("```forge-task")) result.errors.push(`${file}:${index + 1}: Do not mix task checkboxes with structured tasks.`);
      }
      checkPhase();
      if (!found && options.requireContracts !== false) result.errors.push(`${file}: No valid structured tasks found; author bounded forge-task blocks inside Phase N headings.`);
    } catch (error) { result.errors.push(`${file}: ${String(error)}`); }
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const featureActive = new Set<string>();
  const featureVisited = new Set<string>();
  const visitFeature = (feature: FeatureNode): void => {
    if (featureActive.has(feature.name)) throw new Error(`Feature dependency cycle at '${feature.name}'.`);
    if (featureVisited.has(feature.name)) return;
    featureActive.add(feature.name);
    for (const name of feature.dependencies) {
      const dependency = features.find((entry) => entry.name === name);
      if (!dependency) continue;
      visitFeature(dependency);
      const dependencyTasks = tasksByFile.get(relative(root, dependency.file).replace(/\\/g, "/")) ?? [];
      for (const id of tasksByFile.get(relative(root, feature.file).replace(/\\/g, "/")) ?? []) phaseDependencies.set(id, [...phaseDependencies.get(id) ?? [], ...dependencyTasks]);
    }
    featureActive.delete(feature.name);
    featureVisited.add(feature.name);
  };
  try { features.forEach(visitFeature); } catch (error) { result.errors.push(String(error)); }
  const visit = (id: string): void => {
    if (active.has(id)) throw new Error(`Task dependency cycle at '${id}'.`);
    if (visited.has(id)) return;
    active.add(id);
    const task = tasks.get(id)!;
    for (const dependency of [...task.dependencies, ...phaseDependencies.get(id) ?? []]) {
      if (!tasks.has(dependency)) {
        result.errors.push(`Task '${id}' has unknown dependency '${dependency}'.`);
      } else visit(dependency);
    }
    active.delete(id);
    visited.add(id);
  };
  try { for (const id of tasks.keys()) visit(id); } catch (error) { result.errors.push(String(error)); }
  try {
    const documents = new Map(["docs/PRD.md", ...featureFiles].map((file) => [file, read(file)]));
    const integrity = documentIntegrity(root, documents, [...tasks.values()]);
    result.errors.push(...integrity.errors);
    result.warnings.push(...integrity.warnings);
  } catch (error) { result.errors.push(String(error)); }
  result.taskCount = options.featureFiles ? options.featureFiles.reduce((count, file) => count + (tasksByFile.get(file)?.length ?? 0), 0) : tasks.size;
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const result = validatePrd(args[0] ?? process.cwd(), { featureFiles: args.includes("--feature") ? args.filter((arg, index) => args[index - 1] === "--feature") : undefined, requireContracts: !args.includes("--allow-legacy") });
    console.log(JSON.stringify(result));
    process.exitCode = result.errors.length ? 1 : 0;
  } catch (error) { console.error(String(error)); process.exitCode = 1; }
}