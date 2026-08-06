import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { AuditEvent, CompletedTaskRecord, ExecutionManifest, ManifestTask, ProgressState } from "./types.ts";

function flattenTasks(manifest: ExecutionManifest): Array<{ phaseId: string; phaseTitle: string; task: ManifestTask }> {
  return manifest.phases.flatMap((phase) => phase.tasks.map((task) => ({ phaseId: phase.id, phaseTitle: phase.title, task })));
}

function labelFor(task: ManifestTask, phaseId: string): string {
  return `Phase ${phaseId}, Task ${task.id}: ${task.description}`;
}

export function parseProgress(path: string, manifest: ExecutionManifest): ProgressState {
  if (!existsSync(path)) {
    const first = flattenTasks(manifest)[0];
    return {
      phase: first?.phaseTitle ?? "Not Started",
      status: "In Progress",
      prdPath: manifest.prdPath,
      lastUpdated: new Date().toISOString(),
      completed: [],
      currentTaskId: first?.task.id,
      blockers: [],
      notes: [],
    };
  }

  const markdown = readFileSync(path, "utf8");
  const completed: CompletedTaskRecord[] = [];
  const completedPattern = /- \[x\] Phase ([^,]+), Task ([^:]+): (.+?)(?: \(@([^\)]+)\))?(?:\s*\n\s*- Files: (.+))?/g;
  for (const match of markdown.matchAll(completedPattern)) {
    completed.push({
      taskId: match[2]!.trim(),
      label: `Phase ${match[1]!.trim()}, Task ${match[2]!.trim()}: ${match[3]!.trim()}`,
      agent: match[4]?.trim(),
      files: match[5] ? match[5].split(/,\s*/).filter(Boolean) : [],
    });
  }

  const phase = markdown.match(/\*\*Phase\*\*: (.+)/)?.[1]?.trim() ?? "Unknown";
  const status = (markdown.match(/\*\*Status\*\*: (.+)/)?.[1]?.trim() as ProgressState["status"] | undefined) ?? "In Progress";
  const prdPath = markdown.match(/\*\*PRD\*\*: (.+)/)?.[1]?.trim() ?? manifest.prdPath;
  const lastUpdated = markdown.match(/\*\*Last Updated\*\*: (.+)/)?.[1]?.trim() ?? new Date().toISOString();
  const currentTaskId = markdown.match(/- \[ \] Phase [^,]+, Task ([^:]+):/)?.[1]?.trim();
  const blockersBlock = markdown.match(/## Blockers\n([\s\S]*?)(?=\n## |$)/m)?.[1] ?? "";
  const notesBlock = markdown.match(/## Notes\n([\s\S]*?)(?=\n## |$)/m)?.[1] ?? "";

  return {
    phase,
    status,
    prdPath,
    lastUpdated,
    completed,
    currentTaskId,
    blockers: blockersBlock.split("\n").map((line) => line.replace(/^-\s*/, "").trim()).filter((line) => line && line !== "None"),
    notes: notesBlock.split("\n").map((line) => line.replace(/^-\s*/, "").trim()).filter(Boolean),
  };
}

function nextIncompleteTask(manifest: ExecutionManifest, completedIds: Set<string>) {
  return flattenTasks(manifest).find(({ task }) => !completedIds.has(task.id));
}

export function writeProgress(path: string, manifest: ExecutionManifest, state: ProgressState): void {
  mkdirSync(dirname(path), { recursive: true });
  const completedIds = new Set(state.completed.map((item) => item.taskId));
  const current = state.currentTaskId
    ? flattenTasks(manifest).find(({ task }) => task.id === state.currentTaskId)
    : nextIncompleteTask(manifest, completedIds);
  const remainingPhases = manifest.phases.filter((phase) => phase.tasks.some((task) => !completedIds.has(task.id)));

  const lines = [
    "# Project Progress",
    "",
    "## Current State",
    `**Phase**: ${state.phase}`,
    `**Status**: ${state.status}`,
    `**Last Updated**: ${state.lastUpdated}`,
    `**PRD**: ${state.prdPath}`,
    "",
    "## Completed Tasks",
    ...(state.completed.length > 0
      ? state.completed.flatMap((item) => {
          const detail = [`- [x] ${item.label}${item.agent ? ` (@${item.agent})` : ""}`];
          if (item.files.length > 0) detail.push(`  - Files: ${item.files.join(", ")}`);
          return detail;
        })
      : ["- None"]),
    "",
    "## Current Task",
    ...(current
      ? [
          `- [ ] ${labelFor(current.task, current.phaseId)}${current.task.ownerAgent ? ` (@${current.task.ownerAgent})` : ""}`,
          "  - Status: In progress",
        ]
      : ["- [x] All manifest tasks completed"]),
    "",
    "## Remaining",
    ...(remainingPhases.length > 0
      ? remainingPhases.map((phase) => `- [ ] Phase ${phase.id}: ${phase.title}`)
      : ["- [x] No remaining phases"]),
    "",
    "## Blockers",
    ...(state.blockers.length > 0 ? state.blockers.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Notes",
    ...(state.notes.length > 0 ? state.notes.map((item) => `- ${item}`) : ["- Manifest-backed execution state"]),
    "",
  ];

  writeFileSync(path, lines.join("\n"), "utf8");
}

export function checkpointTask(
  manifest: ExecutionManifest,
  state: ProgressState,
  taskId: string,
  files: string[] = [],
  note?: string,
): ProgressState {
  const allTasks = flattenTasks(manifest);
  const entry = allTasks.find(({ task }) => task.id === taskId);
  if (!entry) throw new Error(`Unknown task id '${taskId}'.`);
  if (state.completed.some((item) => item.taskId === taskId)) return state;

  const completed = [
    ...state.completed,
    {
      taskId,
      label: labelFor(entry.task, entry.phaseId),
      agent: entry.task.ownerAgent,
      files,
    },
  ];
  const completedIds = new Set(completed.map((item) => item.taskId));
  const next = nextIncompleteTask(manifest, completedIds);
  const phase = next?.phaseTitle ?? entry.phaseTitle;

  return {
    ...state,
    phase,
    status: next ? "In Progress" : "Complete",
    completed,
    currentTaskId: next?.task.id,
    lastUpdated: new Date().toISOString(),
    notes: note ? [...state.notes, note] : state.notes,
  };
}

export function appendAuditEvent(path: string, event: AuditEvent): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
}
