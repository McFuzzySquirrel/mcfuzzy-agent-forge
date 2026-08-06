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
      .filter((part) => part.length >= 3),
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

function extractTasks(
  phaseTitle: string,
  phaseBody: string,
  phaseId: string,
  agents: AgentDescriptor[],
  validationCommands: string[],
  warnings: string[],
): ManifestTask[] {
  const tasks: ManifestTask[] = [];
  const lines = phaseBody.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    if (!/^(-|\*|\d+\.)\s+/.test(line)) continue;
    const cleaned = line.replace(/^(-|\*|\d+\.)\s+/, "").trim();
    if (/^(acceptance criteria|validation|dependencies)\b/i.test(cleaned)) continue;
    const taskId = taskIdFromText(cleaned, phaseId, tasks.length);
    const owner = chooseOwner(cleaned, agents);
    if (owner.warning) warnings.push(owner.warning);
    tasks.push({
      id: taskId,
      title: cleaned.split(/[:.]/)[0]!.trim(),
      description: cleaned,
      ownerAgent: owner.owner,
      dependencies: tasks.length > 0 ? [tasks[tasks.length - 1]!.id] : [],
      expectedOutputs: extractPaths(cleaned),
      validationCommands,
      approvalRequired: false,
      sourceLines: [cleaned],
    });
  }

  if (tasks.length === 0) {
    const summary = lines.find((line) => !/^#+\s+/.test(line)) ?? phaseTitle;
    const owner = chooseOwner(summary, agents);
    if (owner.warning) warnings.push(owner.warning);
    tasks.push({
      id: `${phaseId}.1`,
      title: summary.slice(0, 80),
      description: summary,
      ownerAgent: owner.owner,
      dependencies: [],
      expectedOutputs: extractPaths(phaseBody),
      validationCommands,
      approvalRequired: false,
      sourceLines: [summary],
    });
    warnings.push(`Phase ${phaseId} had no explicit task bullets; created a single synthesized task.`);
  }

  return tasks;
}

export function compileExecutionManifest(repo: ForgeRepo): ExecutionManifest {
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
    const tasks = extractTasks(block.title, block.body, phaseId, repo.agents, validationCommands, warnings);
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
