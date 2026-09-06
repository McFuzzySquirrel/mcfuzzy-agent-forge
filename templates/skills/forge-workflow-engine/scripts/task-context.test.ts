import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveHumanTask, humanTaskApproved, taskReferenceContext } from "./task-context.ts";
import { prepareTaskRequest } from "./request.ts";
import type { ManifestTask, AgentDescriptor } from "./types.ts";

const agent: AgentDescriptor = { name: "worker", path: "worker.md", description: "", rawBody: "", constraints: [], expertise: [], collaboration: [] };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "task-context-"));
  writeFileSync(join(root, "requirements.md"), "FR-1: Reject files over 10 MB.");
  const task: ManifestTask = { id: "upload", title: "Upload", description: "Validate uploads", ownerAgent: "worker", dependencies: [], expectedOutputs: ["upload.ts"], validationCommands: ["npm test"], sourceLines: [], approvalRequired: false, contract: { version: 1, kind: "implementation", requirements: ["FR-1"], acceptanceCriteria: ["Oversize input rejected before extraction"], constraints: ["No data exposure"], references: ["requirements.md"] } };
  return { root, task };
}
test("prompt preserves requirements, criteria, constraints and reference contents", () => {
  const { root, task } = fixture();
  const request = prepareTaskRequest({ repoRoot: root, agent, task });
  for (const text of ["FR-1: Reject files over 10 MB", "Oversize input rejected", "No data exposure", "forge-result"]) assert.ok(request.instructions.includes(text));
});
test("missing, escaping and oversized task references fail closed", () => {
  const { root, task } = fixture();
  task.contract!.references = ["../outside.md"];
  assert.throws(() => taskReferenceContext(root, task), /repository-relative/);
  task.contract!.references = ["missing.md"];
  assert.throws(() => taskReferenceContext(root, task));
  writeFileSync(join(root, "large.md"), "a".repeat(129 * 1024));
  task.contract!.references = ["large.md"];
  assert.throws(() => taskReferenceContext(root, task), /128 KiB/);
});
test("human reviews require evidence and invalidate on task, reference or evidence changes", () => {
  const { root, task } = fixture();
  task.contract = { ...task.contract!, kind: "human-review", reviewFile: "reviews/upload.json" };
  delete task.ownerAgent;
  task.validationCommands = [];
  task.expectedOutputs = [];
  writeFileSync(join(root, "evidence.md"), "Reviewed keyboard workflow on desktop and mobile.");
  assert.equal(humanTaskApproved(root, task), false);
  assert.throws(() => prepareTaskRequest({ repoRoot: root, task, agent }), /must not be sent/);
  approveHumanTask(root, task, "Human reviewer", ["evidence.md"]);
  assert.equal(humanTaskApproved(root, task), true);
  task.description += " changed";
  assert.equal(humanTaskApproved(root, task), false);
  approveHumanTask(root, task, "Human reviewer", ["evidence.md"]);
  writeFileSync(join(root, "requirements.md"), "Changed requirement");
  assert.equal(humanTaskApproved(root, task), false);
  approveHumanTask(root, task, "Human reviewer", ["evidence.md"]);
  writeFileSync(join(root, "evidence.md"), "Changed evidence");
  assert.equal(humanTaskApproved(root, task), false);
});