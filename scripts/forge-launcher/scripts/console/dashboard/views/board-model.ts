import type { TaskRow } from "../types.js";
import type { BoardStatusFilter } from "./board-preferences.js";

export type BoardTaskAttention = "blocked" | "failed" | "human-review" | null;

export interface BoardTaskSummary {
  id: string;
  title: string;
  summary: string;
  phaseId: string;
  phaseTitle: string;
  status: string;
  ownerAgent: string | null;
  nextResponsible: string;
  nextAction: string;
  attention: BoardTaskAttention;
  attentionCue: string | null;
  blocker: string | null;
  dependencies: string[];
  artifactInputs: string[];
  artifactId: string | null;
  artifactType: string | null;
  outputFiles: string[];
}

export function summarizeBoardTasks(tasks: readonly TaskRow[]): BoardTaskSummary[] {
  const titles = new Map(tasks.map((task) => [task.id, task.title]));
  return tasks.map((task) => {
    const prerequisites = task.unmetPrerequisites.map((id) => titles.get(id) ?? id);
    const failed = task.status === "failed";
    const blocked = !failed && prerequisites.length > 0;
    const humanReview = !failed && !blocked && task.contractKind === "human-review" && task.status !== "complete" && task.status !== "skipped";
    const attention: BoardTaskAttention = failed ? "failed" : blocked ? "blocked" : humanReview ? "human-review" : null;
    const blocker = failed
      ? task.errorMessage ?? "Task failed. See Tasks for details."
      : blocked
        ? `Waiting for ${prerequisites.join(", ")}`
        : null;
    const nextAction = failed
      ? "Review the failure in Tasks"
      : blocked
        ? "Complete the prerequisite in Tasks"
        : humanReview
          ? "Review this Task in Tasks"
          : task.status === "pending"
            ? "Ready to start"
            : task.status === "running"
              ? "Work is in progress"
              : task.status === "complete"
                ? "Task complete"
                : task.status === "skipped"
                  ? "Review why this Task was skipped in Tasks"
                  : "Review this Task in Tasks";
    const attentionCue = attention === "failed"
      ? `Failed: ${blocker}`
      : attention === "blocked"
        ? `Blocked: ${blocker}`
        : attention === "human-review"
          ? "Human review is ready."
          : null;

    return {
      id: task.id,
      title: task.title,
      summary: task.description || "No summary provided.",
      phaseId: task.phaseId,
      phaseTitle: task.phaseTitle,
      status: task.status,
      ownerAgent: task.ownerAgent,
      nextResponsible: attention === "failed" || attention === "human-review"
        ? "You"
        : attention === "blocked"
          ? "Upstream Tasks"
          : task.ownerAgent ?? "Forge",
      nextAction,
      attention,
      attentionCue,
      blocker,
      dependencies: [...task.dependencies],
      artifactInputs: [...task.inputs],
      artifactId: task.artifactId,
      artifactType: task.produces,
      outputFiles: [...task.outputFiles],
    };
  });
}

export function boardTaskChangeAnnouncement(
  previous: readonly BoardTaskSummary[],
  current: readonly BoardTaskSummary[],
): string | null {
  const previousById = new Map(previous.map((task) => [task.id, task]));
  const changes: string[] = [];
  for (const task of current) {
    const before = previousById.get(task.id);
    if (!before) continue;
    if (task.status === "failed" && before.status !== "failed") {
      changes.push(`${task.title} failed.`);
      continue;
    }
    if (before.attention === "blocked" && task.attention !== "blocked") {
      changes.push(`${task.title} is no longer blocked.`);
    }
    if (task.attention === "human-review" && before.attention !== "human-review") {
      changes.push(`${task.title} is ready for Human review.`);
    }
  }
  if (changes.length === 0) return null;
  return changes.slice(0, 3).join(" ") + (changes.length > 3 ? ` ${changes.length - 3} more Task updates.` : "");
}

export function shouldDimBoardTask(task: BoardTaskSummary, statuses: readonly BoardStatusFilter[]): boolean {
  return statuses.length > 0 && !statuses.includes(task.status as BoardStatusFilter);
}
