import test from "node:test";
import assert from "node:assert/strict";
import { shouldDimBoardTask, summarizeBoardTasks } from "./console/dashboard/views/board-model.js";
import type { TaskRow } from "./console/dashboard/types.js";

function task(overrides: Partial<TaskRow> & Pick<TaskRow, "id" | "title">): TaskRow {
  return {
    id: overrides.id,
    title: overrides.title,
    description: "A concise task summary.",
    phaseId: "build",
    phaseTitle: "Build",
    ownerAgent: "Builder",
    effectiveModel: null,
    effectiveFallbackModel: null,
    status: "pending",
    attempt: 0,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    outputFiles: [],
    errorMessage: null,
    artifactId: null,
    inputs: [],
    produces: null,
    dependencies: [],
    expectedOutputs: [],
    validationCommands: [],
    timeoutMs: null,
    approvalRequired: false,
    usage: null,
    requirements: [],
    acceptanceCriteria: [],
    constraints: [],
    references: [],
    validationGaps: [],
    unmetPrerequisites: [],
    ...overrides,
  };
}

test("Board summaries give Kanban and Gantt the same blocker, attention, and next-action cues", () => {
  const summaries = summarizeBoardTasks([
    task({ id: "review", title: "Review acceptance", contractKind: "human-review" }),
    task({ id: "build", title: "Build the feature", unmetPrerequisites: ["review"] }),
    task({ id: "check", title: "Run checks", status: "failed", errorMessage: "Unit checks failed" }),
  ]);

  assert.deepEqual(
    summaries.map(({ id, attention, blocker, nextResponsible, nextAction }) => ({
      id,
      attention,
      blocker,
      nextResponsible,
      nextAction,
    })),
    [
      {
        id: "review",
        attention: "human-review",
        blocker: null,
        nextResponsible: "You",
        nextAction: "Review this Task in Tasks",
      },
      {
        id: "build",
        attention: "blocked",
        blocker: "Waiting for Review acceptance",
        nextResponsible: "Upstream Tasks",
        nextAction: "Complete the prerequisite in Tasks",
      },
      {
        id: "check",
        attention: "failed",
        blocker: "Unit checks failed",
        nextResponsible: "You",
        nextAction: "Review the failure in Tasks",
      },
    ],
  );
  assert.equal(shouldDimBoardTask(summaries[0]!, ["failed"]), true);
  assert.equal(shouldDimBoardTask(summaries[2]!, ["failed"]), false);
  assert.equal(shouldDimBoardTask(summaries[1]!, []), false);
});
