import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { AgentDescriptor, ExecutionManifest, ForgeRepo, ManifestPhase, ManifestTask } from "./types.ts";

interface HeadingBlock {
  level: number;
  title: string;
  body: string;
}

function parseHeadings(markdown: string): HeadingBlock[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: HeadingBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (!match) continue;

    const level = match[1]!.length;
    const title = match[2]!.trim();
    let end = index + 1;
    while (end < lines.length) {
      const next = lines[end]!;
      const nextMatch = next.match(/^(#{1,6})\s+(.+)$/);
      if (nextMatch && nextMatch[1]!.length <= level) break;
      end += 1;
    }

    blocks.push({
      level,
      title,
      body: lines.slice(index + 1, end).join("\n").trim(),
    });
  }

  return blocks;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((part) => part.length >= 2),
  );
}

function overlapScore(taskText: string, agent: AgentDescriptor): number {
  const taskWords = tokenize(taskText);
  const agentWords = tokenize([
    agent.name,
    agent.description,
    ...agent.expertise,
    ...agent.collaboration,
    ...agent.constraints,
  ].join(" "));

  let score = 0;
  for (const word of taskWords) {
    if (agentWords.has(word)) score += 1;
  }
  if (taskText.toLowerCase().includes(agent.name.toLowerCase())) score += 3;
  return score;
}

function fallbackOwner(agents: AgentDescriptor[]): string | undefined {
  const orchestrator = agents.find((agent) => /orchestrator/i.test(agent.name));
  return orchestrator?.name ?? agents[0]?.name;
}

function chooseOwner(taskText: string, agents: AgentDescriptor[]): { owner?: string; warning?: string } {
  let best: { agent?: AgentDescriptor; score: number } = { score: 0 };
  let second = 0;

  for (const agent of agents) {
    const score = overlapScore(taskText, agent);
    if (score > best.score) {
      second = best.score;
      best = { agent, score };
    } else if (score > second) {
      second = score;
    }
  }

  if (!best.agent || best.score === 0) {
    const fallback = fallbackOwner(agents);
    if (fallback) {
      return { owner: fallback, warning: `No confident owner match for task '${taskText}' → defaulting to '${fallback}'` };
    }
    return { warning: `No confident owner match for task: ${taskText}` };
  }

  if (best.score - second <= 1) {
    return { owner: best.agent.name, warning: `Weak owner match for task '${taskText}' → ${best.agent.name}` };
  }

  return { owner: best.agent.name };
}

function extractCommands(markdown: string): string[] {
  const commands = new Set<string>();
  for (const match of markdown.matchAll(/```(?:bash|sh|shell|powershell)?\n([\s\S]*?)```/g)) {
    const block = match[1] ?? "";
    for (const line of block.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (/^(npm|pnpm|yarn|bun|go|cargo|dotnet|pytest|python|uv|poetry|make)\b/.test(trimmed)) {
        commands.add(trimmed);
      }
    }
  }
  for (const match of markdown.matchAll(/`([^`]+)`/g)) {
    const command = match[1]!.trim();
    if (/^(npm|pnpm|yarn|bun|go|cargo|dotnet|pytest|python|uv|poetry|make)\b/.test(command)) {
      commands.add(command);
    }
  }
  return [...commands];
}

function extractPaths(text: string): string[] {
  const seen = new Set<string>();
  const push = (value: string) => {
    if (value.includes(" ")) return;
    if (!/[./]/.test(value) && !/\.[A-Za-z0-9_-]+$/.test(value)) return;
    seen.add(value.replace(/^`|`$/g, ""));
  };

  for (const match of text.matchAll(/`([^`]+\.[A-Za-z0-9_-]+)`/g)) push(match[1]!);
  for (const match of text.matchAll(/(?:^|\s)([A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+)(?=$|[\s,;])/g)) push(match[1]!);
  return [...seen];
}

function phaseIdFromTitle(title: string, fallbackIndex: number): string {
  const match = title.match(/phase\s+([a-z]?\d+)/i);
  return match ? match[1]!.toUpperCase() : String(fallbackIndex + 1);
}

function taskIdFromText(text: string, phaseId: string, taskIndex: number): string {
  const match = text.match(/task\s+([a-z]?\d+(?:\.\d+)?)/i);
  if (match) return match[1]!.toUpperCase();
  return `${phaseId}.${taskIndex + 1}`;
}

/**
 * Derive a stable artifact type for a task. Every compiled task declares a
 * `produces` type so the workflow engine's artifact store synthesises a work
 * artifact on success (the artifact layer is on by default, not opt-in).
 *
 * "1.1" → "work.1.1"  (subdirectory: "work-1-1")
 */
function producesFor(taskId: string): string {
  return `work.${taskId.toLowerCase()}`;
}

interface BulletLine {
  indent: number;
  text: string;
}

interface BulletGroup {
  /** Top-level bullet text; treated as a container when it has children. */
  header?: string;
  /** Indented sub-bullet texts (only meaningful in fine granularity mode). */
  children: string[];
}

const bulletRe = /^(\s*)([-*]|\d+[.)])\s+(.*)$/;
const skipTaskLineRe = /^(acceptance criteria|validation|dependencies)\b/i;
const SPLIT_LENGTH = 160;
const MIN_FRAGMENT_LENGTH = 25;

/** Strip a leading task-id label (e.g. "Task 1.1:", "Task 2:") from text. */
function stripTaskLabel(text: string): string {
  return text.replace(/^task\s+[a-z]?\d+(?:\.\d+)*[:.]?\s*/i, "").trim();
}

/**
 * Conservatively split an oversized bullet into chained task fragments.
 * Splits at sentence/segment boundaries (`. ` + capital, `; `, em-dash,
 * numbered markers) only when the bullet is long or multi-sentence.
 */
function splitTaskText(text: string): string[] {
  const sentenceBreaks = (text.match(/[.;]\s+(?=[A-Z0-9`"])/g) ?? []).length;
  if (text.length <= SPLIT_LENGTH && sentenceBreaks < 2) return [text];

  const parts = text
    .split(/;\s+|\u2014\s+|\.\s+(?=[A-Z0-9`"])|\)\s+(?=[A-Z])/)
    .map((part) => part.trim())
    .filter(Boolean);

  const merged: string[] = [];
  for (const part of parts) {
    const previous = merged[merged.length - 1];
    if (merged.length > 0 && (part.length < MIN_FRAGMENT_LENGTH || previous.length < MIN_FRAGMENT_LENGTH)) {
      merged[merged.length - 1] = `${previous}; ${part}`;
    } else {
      merged.push(part);
    }
  }
  return merged.length > 0 ? merged : [text];
}

/**
 * Allocate a task id unique within the phase. Prefers the label parsed from the
 * task text (e.g. "Task 1.2:"), but falls back to the next sequential index so
 * a labeled task can never collide with an auto-numbered one.
 */
function nextUniqueTaskId(phaseId: string, tasks: ManifestTask[], preferred?: string): string {
  const taken = new Set(tasks.map((task) => task.id));
  if (preferred && !taken.has(preferred)) return preferred;
  let index = tasks.length + 1;
  let candidate = `${phaseId}.${index}`;
  while (taken.has(candidate)) {
    index += 1;
    candidate = `${phaseId}.${index}`;
  }
  return candidate;
}

function pushTask(
  tasks: ManifestTask[],
  text: string,
  phaseId: string,
  agents: AgentDescriptor[],
  validationCommands: string[],
  warnings: string[],
): void {
  const taskId = nextUniqueTaskId(phaseId, tasks, scopedTaskId(text, phaseId, tasks.length));
  const owner = chooseOwner(text, agents);
  if (owner.warning) warnings.push(owner.warning);
  const previous = tasks[tasks.length - 1];
  tasks.push({
    id: taskId,
    title: text.split(/[:.]/)[0]!.trim(),
    description: text,
    ownerAgent: owner.owner,
    dependencies: previous ? [previous.id] : [],
    expectedOutputs: extractPaths(text),
    validationCommands,
    approvalRequired: false,
    sourceLines: [text],
    produces: producesFor(taskId),
    inputs: previous ? [producesFor(previous.id)] : [],
  });
}

/**
 * Resolve a task id for a phase. A label parsed from the task text (e.g.
 * "Task 1.1:") is honored only when it belongs to this phase (monolithic mode,
 * where the phase id is the leading number). Feature-mode phase ids are
 * feature-prefixed (e.g. "BUDGETS-2"), so the leading number of a repeated
 * label is ignored and the task is auto-numbered under the phase id - keeping
 * task ids globally unique across features.
 */
function scopedTaskId(text: string, phaseId: string, taskIndex: number): string | undefined {
  const preferred = taskIdFromText(text, phaseId, taskIndex);
  return preferred.startsWith(`${phaseId}.`) ? preferred : undefined;
}

function extractTasks(
  phaseTitle: string,
  phaseBody: string,
  phaseId: string,
  agents: AgentDescriptor[],
  validationCommands: string[],
  warnings: string[],
  granularity: "coarse" | "fine",
): ManifestTask[] {
  const tasks: ManifestTask[] = [];

  if (granularity === "coarse") {
    // Legacy behavior: every trimmed bullet line (any indentation) becomes one
    // task, in source order, with no hierarchy and no long-bullet splitting.
    const lines = phaseBody.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      if (!/^(-|\*|\d+\.)\s+/.test(line)) continue;
      const cleaned = line.replace(/^(-|\*|\d+\.)\s+/, "").trim();
      if (skipTaskLineRe.test(cleaned)) continue;
      pushTask(tasks, cleaned, phaseId, agents, validationCommands, warnings);
    }
    if (tasks.length === 0) {
      const summary = phaseBody.split(/\r?\n/).find((line) => !/^#+\s+/.test(line))?.trim() ?? phaseTitle;
      pushTask(tasks, summary, phaseId, agents, validationCommands, warnings);
      warnings.push(`Phase ${phaseId} had no explicit task bullets; created a single synthesized task.`);
    }
    return tasks;
  }

  // Fine granularity: preserve hierarchy so sub-bullets and oversized bullets
  // become their own smaller, chained tasks.
  const groups: BulletGroup[] = [];
  let current: BulletGroup | undefined;

  for (const rawLine of phaseBody.split(/\r?\n/)) {
    const match = rawLine.match(bulletRe);
    if (!match) continue;
    const indent = match[1]!.length;
    const text = match[3]!.trim();
    if (skipTaskLineRe.test(text)) continue;

    if (indent === 0) {
      current = { header: text, children: [] };
      groups.push(current);
    } else if (current && current.header !== undefined && groups[groups.length - 1] === current) {
      current.children.push(text);
    } else {
      // Indented bullet with no preceding top-level bullet: standalone task.
      current = { children: [] };
      groups.push(current);
      current.children.push(text);
    }
  }

  let emitted = 0;
  for (const group of groups) {
    if (group.header !== undefined && group.children.length > 0) {
      // Container bullet: its sub-bullets are the real work. Prefix each
      // sub-task with the container text so prompts stay self-contained
      // (the id label is stripped so taskIdFromText stays unambiguous).
      const context = stripTaskLabel(group.header);
      for (const child of group.children) {
        pushTask(tasks, `${child} (${context})`, phaseId, agents, validationCommands, warnings);
        emitted += 1;
      }
    } else {
      const source = group.header ?? group.children.join("; ");
      if (!source) continue;
      const fragments = splitTaskText(source);
      for (const fragment of fragments) {
        pushTask(tasks, fragment, phaseId, agents, validationCommands, warnings);
        emitted += 1;
      }
      if (fragments.length > 1) {
        const preview = source.length > 60 ? `${source.slice(0, 60)}…` : source;
        warnings.push(
          `Phase ${phaseId} task '${preview}' was split into ${fragments.length} finer-grained tasks.`,
        );
      }
    }
  }

  if (emitted === 0) {
    const summary = phaseBody.split(/\r?\n/).find((line) => !/^#+\s+/.test(line))?.trim() ?? phaseTitle;
    pushTask(tasks, summary, phaseId, agents, validationCommands, warnings);
    warnings.push(`Phase ${phaseId} had no explicit task bullets; created a single synthesized task.`);
  }

  return tasks;
}

export interface CompileOptions {
  /** Task decomposition granularity. `fine` (default) expands sub-bullets and
   *  splits oversized bullets into smaller chained tasks. `coarse` reproduces
   *  the legacy one-bullet-per-task behavior. */
  granularity?: "coarse" | "fine";
}

/** Monolithic mode: compile `## Phase N` headings from a single PRD document. */
function compileMonolithicManifest(repo: ForgeRepo, options: CompileOptions = {}): ExecutionManifest {
  const granularity = options.granularity ?? "fine";
  const prd = readFileSync(repo.prdPath, "utf8");
  const validationCommands = extractCommands(prd);
  const warnings = [...repo.warnings];
  const headings = parseHeadings(prd);
  const phaseBlocks = headings.filter((block) => /^phase\s+[a-z]?\d+/i.test(block.title));

  if (phaseBlocks.length === 0) {
    throw new Error(`No phase headings found in ${repo.prdPath}. Expected headings such as '## Phase 1: Foundation'.`);
  }

  const phases: ManifestPhase[] = phaseBlocks.map((block, index) => {
    const phaseId = phaseIdFromTitle(block.title, index);
    const tasks = extractTasks(block.title, block.body, phaseId, repo.agents, validationCommands, warnings, granularity);
    const ownerAgents = [...new Set(tasks.map((task) => task.ownerAgent).filter((value): value is string => Boolean(value)))];

    return {
      id: phaseId,
      title: block.title,
      description: block.body.split(/\r?\n/).slice(0, 3).join(" ").trim(),
      ownerAgents,
      dependencies: index > 0 ? [phaseIdFromTitle(phaseBlocks[index - 1]!.title, index - 1)] : [],
      approvalRequired: index > 0,
      tasks,
    };
  });

  return {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    granularity,
    sourceLayout: "monolithic",
    repoRoot: repo.repoRoot,
    harnessRoot: repo.harnessRoot,
    prdPath: repo.prdPath,
    progressPath: repo.progressPath,
    auditPath: repo.auditPath,
    validationCommands,
    approvalGates: {
      preflight: true,
      betweenPhases: true,
    },
    phases,
    warnings,
  };
}

export interface FeatureNode {
  name: string;
  file: string;
  dependencies: string[];
}

/**
 * Parse the feature dependency table from the product vision (## 14. Features).
 * Falls back to the sorted feature file list when no table is found.
 */
function parseFeatureGraph(vision: string, featurePaths: string[], repoRoot: string, docsDir: string, warnings: string[]): FeatureNode[] {
  const sections = parseHeadings(vision);
  const featuresSection = sections.find((section) => /^14\.\s*features/i.test(section.title));

  const nodes: FeatureNode[] = [];
  if (featuresSection) {
    const tableRows = featuresSection.body.split(/\r?\n/)
      .filter((line) => line.trim().startsWith("|"))
      .map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()))
      .filter((row) => {
        if (row.length < 4) return false;
        if (/^[-:]+$/.test(row.join(""))) return false; // separator row
        const [n, name] = row;
        if (/^#$/i.test(n)) return false; // header row
        if (/^feature$/i.test(name)) return false; // header row
        return true;
      });
    for (const row of tableRows) {
      const [, name, fileCell, depsCell] = row;
      if (!name || !fileCell) continue;
      const href = /\]\(([^)]+)\)/.exec(fileCell)?.[1] ?? fileCell;
      const file = resolveFeatureFile(href, repoRoot, docsDir, featurePaths);
      if (!file) {
        warnings.push(`Feature '${name}' references unknown file '${href}'; skipping.`);
        continue;
      }
      const dependencies = (depsCell ?? "None")
        .split(/\s*(?:\+|,)\s*/)
        .map((dep) => dep.trim())
        .filter((dep) => dep && dep.toLowerCase() !== "none");
      nodes.push({ name, file, dependencies });
    }
  }

  if (nodes.length === 0) {
    warnings.push("No feature dependency table found in product-vision.md; using feature files in lexical order.");
    for (const file of featurePaths) {
      nodes.push({ name: basename(file, ".md"), file, dependencies: [] });
    }
  }
  return nodes;
}

function resolveFeatureFile(href: string, repoRoot: string, docsDir: string, featurePaths: string[]): string | undefined {
  const cleaned = href.replace(/^\.\//, "");
  for (const base of [docsDir, repoRoot]) {
    const resolved = join(base, cleaned);
    if (existsSync(resolved)) return resolved;
    const match = featurePaths.find((candidate) => candidate === resolved);
    if (match) return match;
  }
  return undefined;
}

/** Stable ordering: topological (dependencies first), falling back to input order on cycles. */
function orderFeatures(nodes: FeatureNode[], warnings: string[]): FeatureNode[] {
  const byName = new Map(nodes.map((node) => [node.name, node]));
  const ordered: FeatureNode[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (node: FeatureNode, chain: string[]): void => {
    if (visited.has(node.name)) return;
    if (visiting.has(node.name)) {
      warnings.push(`Feature dependency cycle detected: ${[...chain, node.name].join(" -> ")}; using document order.`);
      return;
    }
    visiting.add(node.name);
    for (const dep of node.dependencies) {
      const depNode = byName.get(dep);
      if (depNode) visit(depNode, [...chain, node.name]);
    }
    visiting.delete(node.name);
    visited.add(node.name);
    ordered.push(node);
  };

  for (const node of nodes) visit(node, []);
  return ordered;
}

/** Upper-case slug used to tag feature phase ids, e.g. "Budgets" → "BUDGETS". */
function featureCode(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toUpperCase();
}

function pushPhase(
  phases: ManifestPhase[],
  phaseId: string,
  title: string,
  feature: string | undefined,
  description: string,
  tasks: ManifestTask[],
): void {
  const ownerAgents = [...new Set(tasks.map((task) => task.ownerAgent).filter((value): value is string => Boolean(value)))];
  phases.push({
    id: phaseId,
    title,
    feature,
    description,
    ownerAgents,
    dependencies: phases.length > 0 ? [phases[phases.length - 1]!.id] : [],
    approvalRequired: phases.length > 0,
    tasks,
  });
}

/** Synthesize a single phase from a feature doc's Functional Requirements bullets. */
function synthesizeTasksFromFr(
  featureName: string,
  doc: string,
  phaseId: string,
  agents: AgentDescriptor[],
  validationCommands: string[],
  warnings: string[],
  granularity: "coarse" | "fine",
): ManifestTask[] {
  const frSection = parseHeadings(doc).find((section) => /^3\.\s*functional requirements/i.test(section.title));
  const body = frSection?.body ?? "";
  return extractTasks(`Phase 1: ${featureName}`, body, phaseId, agents, validationCommands, warnings, granularity);
}

/** Feature mode: compile phases from docs/features/*.md ordered by the vision dependency graph. */
function compileFeatureManifest(repo: ForgeRepo, options: CompileOptions = {}): ExecutionManifest {
  const granularity = options.granularity ?? "fine";
  const warnings = [...repo.warnings];
  const vision = readFileSync(repo.visionPath, "utf8");
  const validationCommands = extractCommands(vision);
  if (existsSync(repo.prdPath)) {
    for (const command of extractCommands(readFileSync(repo.prdPath, "utf8"))) {
      if (!validationCommands.includes(command)) validationCommands.push(command);
    }
  }

  const nodes = parseFeatureGraph(vision, repo.featurePaths, repo.repoRoot, dirname(repo.visionPath), warnings);
  const ordered = orderFeatures(nodes, warnings);

  const phases: ManifestPhase[] = [];
  for (const feature of ordered) {
    const doc = readFileSync(feature.file, "utf8");
    for (const command of extractCommands(doc)) {
      if (!validationCommands.includes(command)) validationCommands.push(command);
    }

    const code = featureCode(feature.name);
    const phaseBlocks = parseHeadings(doc).filter((block) => /^phase\s+[a-z]?\d+/i.test(block.title));

    if (phaseBlocks.length === 0) {
      warnings.push(`Feature '${feature.name}' has no '## Phase N' implementation phases; synthesizing one from its functional requirements.`);
      const phaseId = `${code}-1`;
      const tasks = synthesizeTasksFromFr(feature.name, doc, phaseId, repo.agents, validationCommands, warnings, granularity);
      if (tasks.length === 0) {
        warnings.push(`Feature '${feature.name}' has no phase or functional-requirement tasks; no tasks emitted.`);
        continue;
      }
      pushPhase(phases, phaseId, `Phase 1: ${feature.name}`, feature.name, feature.name, tasks);
      continue;
    }

    for (const block of phaseBlocks) {
      const phaseId = `${code}-${phaseIdFromTitle(block.title, 0)}`;
      const tasks = extractTasks(block.title, block.body, phaseId, repo.agents, validationCommands, warnings, granularity);
      pushPhase(phases, phaseId, block.title, feature.name, block.body.split(/\r?\n/).slice(0, 3).join(" ").trim(), tasks);
    }
  }

  if (phases.length === 0) {
    throw new Error(`No compilable phases found across ${repo.featurePaths.length} feature docs under docs/features/.`);
  }

  return {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    granularity,
    sourceLayout: "features",
    repoRoot: repo.repoRoot,
    harnessRoot: repo.harnessRoot,
    prdPath: repo.visionPath,
    visionPath: repo.visionPath,
    featureOrder: ordered.map((node) => node.name),
    progressPath: repo.progressPath,
    auditPath: repo.auditPath,
    validationCommands,
    approvalGates: {
      preflight: true,
      betweenPhases: true,
    },
    phases,
    warnings,
  };
}

/** Compile a runnable execution manifest from the repo's PRD representation. */
export function compileExecutionManifest(repo: ForgeRepo, options: CompileOptions = {}): ExecutionManifest {
  return repo.sourceLayout === "features"
    ? compileFeatureManifest(repo, options)
    : compileMonolithicManifest(repo, options);
}

export interface TeamValidation {
  unassignedTasks: string[];
  duplicateFileOwners: { file: string; owners: string[]; tasks: string[] }[];
  orphanAgents: string[];
}

/** Generic forge template agents are not expected to own feature tasks. */
const GENERIC_AGENT_RE = /forge-|orchestrator/i;

/** Deterministic team-validation gate mirroring forge-build-agent-team Step 7. */
export function validateTeam(manifest: ExecutionManifest, agents: AgentDescriptor[]): TeamValidation {
  const unassignedTasks = manifest.phases
    .flatMap((phase) => phase.tasks.filter((task) => !task.ownerAgent))
    .map((task) => task.id);

  const fileOwners = new Map<string, { owners: Set<string>; tasks: string[] }>();
  for (const phase of manifest.phases) {
    for (const task of phase.tasks) {
      for (const file of task.expectedOutputs) {
        const entry = fileOwners.get(file) ?? { owners: new Set<string>(), tasks: [] };
        if (task.ownerAgent) entry.owners.add(task.ownerAgent);
        entry.tasks.push(task.id);
        fileOwners.set(file, entry);
      }
    }
  }
  const duplicateFileOwners = [...fileOwners.entries()]
    .filter(([, entry]) => entry.owners.size > 1)
    .map(([file, entry]) => ({ file, owners: [...entry.owners], tasks: entry.tasks }));

  const owned = new Set(manifest.phases.flatMap((phase) => phase.tasks.map((task) => task.ownerAgent).filter((value): value is string => Boolean(value))));
  const orphanAgents = agents
    .filter((agent) => !GENERIC_AGENT_RE.test(agent.name) && !owned.has(agent.name))
    .map((agent) => agent.name);

  return { unassignedTasks, duplicateFileOwners, orphanAgents };
}

function basename(path: string, ext?: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return ext && base.endsWith(ext) ? base.slice(0, -ext.length) : base;
}

/** Deterministic agent-responsibility matrix, mirroring the prompt-driven artifact. */
export function buildResponsibilityMatrix(manifest: ExecutionManifest, validation: TeamValidation): string {
  const lines: string[] = [];
  const push = (text = "") => lines.push(text);

  push("# Agent Responsibility Matrix");
  push("");
  push(`Generated by forge-execution-adapter at ${manifest.generatedAt}.`);
  push("");
  push(`- **Source layout:** ${manifest.sourceLayout}`);
  push(`- **Source:** ${manifest.prdPath}`);
  if (manifest.visionPath) push(`- **Vision:** ${manifest.visionPath}`);
  push(`- **Manifest:** docs/EXECUTION-MANIFEST.json`);
  if (manifest.featureOrder) push(`- **Feature execution order:** ${manifest.featureOrder.join(" → ")}`);
  push(`- **Phases:** ${manifest.phases.length} · **Tasks:** ${manifest.phases.reduce((n, phase) => n + phase.tasks.length, 0)}`);
  push("");

  push("## Team Validation");
  push("");
  push(`- Unassigned tasks: **${validation.unassignedTasks.length}**`);
  push(`- Duplicate file owners: **${validation.duplicateFileOwners.length}**`);
  push(`- Orphan agents: **${validation.orphanAgents.length}**`);
  if (validation.unassignedTasks.length > 0) push(`  - ${validation.unassignedTasks.join(", ")}`);
  for (const dup of validation.duplicateFileOwners) {
    push(`- Duplicate: \`${dup.file}\` owned by ${dup.owners.join(" and ")} (tasks ${dup.tasks.join(", ")})`);
  }
  if (validation.orphanAgents.length > 0) push(`  - ${validation.orphanAgents.join(", ")}`);
  push("");

  push("## Ownership by Agent");
  push("");
  const byOwner = new Map<string, { phase: string; feature: string; taskId: string; outputs: string[] }[]>();
  for (const phase of manifest.phases) {
    for (const task of phase.tasks) {
      const owner = task.ownerAgent ?? "unassigned";
      const list = byOwner.get(owner) ?? [];
      list.push({ phase: phase.id, feature: phase.feature ?? "", taskId: task.id, outputs: task.expectedOutputs });
      byOwner.set(owner, list);
    }
  }
  for (const [owner, tasks] of [...byOwner.entries()].sort()) {
    push(`### ${owner}`);
    push("");
    push("| Phase | Feature | Task | Outputs |");
    push("|---|---|---|---|");
    for (const task of tasks) {
      push(`| ${task.phase} | ${task.feature || "-"} | ${task.taskId} | ${task.outputs.join(", ") || "-"} |`);
    }
    push("");
  }

  push("## Phase Execution Order");
  push("");
  for (const phase of manifest.phases) {
    push(`1. **${phase.id}** — ${phase.title}${phase.feature ? ` (${phase.feature})` : ""} — owned by ${phase.ownerAgents.join(", ") || "unassigned"}`);
  }
  push("");

  return lines.join("\n");
}

/** Compile + validate + generate the responsibility matrix in one pass. */
export function compileExecutionManifestDetailed(
  repo: ForgeRepo,
  options: CompileOptions = {},
): { manifest: ExecutionManifest; matrix: string; validation: TeamValidation } {
  const manifest = compileExecutionManifest(repo, options);
  const validation = validateTeam(manifest, repo.agents);
  if (validation.unassignedTasks.length > 0) {
    manifest.warnings.push(`Team validation: ${validation.unassignedTasks.length} unassigned task(s): ${validation.unassignedTasks.join(", ")}`);
  }
  for (const dup of validation.duplicateFileOwners) {
    manifest.warnings.push(`Team validation: file '${dup.file}' is owned by multiple agents (${dup.owners.join(", ")}).`);
  }
  if (validation.orphanAgents.length > 0) {
    manifest.warnings.push(`Team validation: ${validation.orphanAgents.length} orphan agent(s) own no tasks: ${validation.orphanAgents.join(", ")}`);
  }
  const matrix = buildResponsibilityMatrix(manifest, validation);
  return { manifest, matrix, validation };
}
