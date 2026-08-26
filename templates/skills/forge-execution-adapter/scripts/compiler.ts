import { readFileSync } from "node:fs";

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
  const taskId = nextUniqueTaskId(phaseId, tasks, taskIdFromText(text, phaseId, tasks.length));
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

export function compileExecutionManifest(repo: ForgeRepo, options: CompileOptions = {}): ExecutionManifest {
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
