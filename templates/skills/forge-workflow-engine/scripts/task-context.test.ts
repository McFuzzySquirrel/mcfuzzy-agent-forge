import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveHumanTask, humanTaskApproved, taskReferenceContext, writeHumanReviewEvidence } from "./task-context.ts";
import { prepareTaskRequest } from "./request.ts";
import type { ManifestTask, AgentDescriptor } from "./types.ts";

const agent: AgentDescriptor = { name: "worker", path: "worker.md", description: "", rawBody: "", constraints: [], expertise: [], collaboration: [] };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "task-context-"));
  writeFileSync(join(root, "requirements.md"), "FR-1: Reject files over 10 MB.");
  const task: ManifestTask = { id: "upload", title: "Upload", description: "Validate uploads", ownerAgent: "worker", dependencies: [], expectedOutputs: ["upload.ts"], validationCommands: ["npm test"], sourceLines: [], approvalRequired: false, contract: { version: 1, kind: "implementation", requirements: ["FR-1"], acceptanceCriteria: ["Oversize input rejected before extraction"], constraints: ["No data exposure"], references: ["requirements.md"] } };
  return { root, task };
}
test("repository instructions preserve mandatory task fields and reference paths", () => {
  const { root, task } = fixture();
  const request = prepareTaskRequest({ repoRoot: root, agent, task });
  for (const text of ["FR-1", "requirements.md", "Oversize input rejected", "No data exposure", "forge-result"]) assert.ok(request.instructions.includes(text));
  assert.ok(!request.instructions.includes("Reject files over 10 MB"));
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

test("scoped human reviews ignore sibling edits but invalidate on selected requirement changes", () => {
  const { root, task } = fixture();
  const source = (rule: string, sibling: string) => `# Requirements\n## Upload\n${rule}\n## Other work\n${sibling}\n`;
  writeFileSync(join(root, "requirements.md"), source("Reject over 10 MB.", "Unrelated task."));
  task.contract = { ...task.contract!, kind: "human-review", reviewFile: "reviews/upload.json", references: ["requirements.md#Upload"] };
  delete task.ownerAgent;
  task.expectedOutputs = [];
  task.validationCommands = [];
  writeFileSync(join(root, "evidence.md"), "Reviewed upload limit.");
  approveHumanTask(root, task, "Reviewer", ["evidence.md"]);
  writeFileSync(join(root, "requirements.md"), source("Reject over 10 MB.", "Changed unrelated task."));
  assert.equal(humanTaskApproved(root, task), true);
  writeFileSync(join(root, "requirements.md"), source("Reject over 20 MB.", "Changed unrelated task."));
  assert.equal(humanTaskApproved(root, task), false);
});

test("Console-style review evidence is accepted by the canonical attestation", () => {
  const { root, task } = fixture();
  task.contract = { ...task.contract!, kind: "human-review", reviewFile: "reviews/upload.json" };
  delete task.ownerAgent;
  task.expectedOutputs = [];
  task.validationCommands = [];
  const evidence = writeHumanReviewEvidence(root, task, "Console Reviewer", "Checked the upload workflow and approved the acceptance criteria.");
  assert.equal(evidence, "docs/reviews/upload-console-review.md");
  approveHumanTask(root, task, "Console Reviewer", [evidence]);
  assert.equal(humanTaskApproved(root, task), true);
});
