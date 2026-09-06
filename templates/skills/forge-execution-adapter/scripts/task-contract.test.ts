import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskBlocks, taskPath } from "./task-contract.ts";
import type { AgentDescriptor } from "./types.ts";

const agent: AgentDescriptor = { name: "api-engineer", path: "agents/api.md", description: "API", rawBody: "", expertise: [], collaboration: [], constraints: [] };
const value = {
  id: "API-1", title: "Validate uploads", description: "Reject invalid uploads before extraction.", ownerAgent: "api-engineer",
  dependencies: [], expectedOutputs: ["src/upload.ts"], validationCommands: ["npm test"],
  contract: { version: 1, kind: "implementation", requirements: ["FR-1: Limit uploads to 10 MB"], acceptanceCriteria: ["Oversized uploads never reach extraction"], constraints: ["No real customer data"], references: ["docs/PRD.md"] },
};
const block = (task: unknown) => "```forge-task\n" + JSON.stringify(task) + "\n```";

test("structured tasks preserve fields without title truncation, path inference or splitting", () => {
  const tasks = parseTaskBlocks(block({ ...value, title: "WCAG 2.2: Validation" }), [agent])!;
  assert.equal(tasks[0]!.title, "WCAG 2.2: Validation");
  assert.deepEqual(tasks[0]!.expectedOutputs, ["src/upload.ts"]);
  assert.deepEqual(tasks[0]!.contract, value.contract);
});
test("structured tasks reject missing validation and unknown owners", () => {
  assert.throws(() => parseTaskBlocks(block({ ...value, validationCommands: [] }), [agent]), /validationCommands/);
  assert.throws(() => parseTaskBlocks(block(value), []), /implementation owner/);
});
test("structured tasks separate references, outputs and human review", () => {
  assert.throws(() => parseTaskBlocks(block({ ...value, expectedOutputs: ["docs/PRD.md"] }), [agent]), /reference inputs/);
  const task = { ...value, ownerAgent: undefined, expectedOutputs: [], validationCommands: [], contract: { ...value.contract, kind: "human-review", reviewFile: "docs/reviews/API-1.json" } };
  assert.equal(parseTaskBlocks(block(task), [])![0]!.contract!.kind, "human-review");
  assert.throws(() => parseTaskBlocks(block({ ...task, ownerAgent: agent.name }), [agent]), /agent owners/);
  assert.throws(() => parseTaskBlocks(block({ ...task, expectedOutputs: ["result.txt"] }), []), /expected outputs/);
  assert.throws(() => parseTaskBlocks(block({ ...value, id: "../../outside" }), [agent]), /Task id/);
  assert.throws(() => taskPath("../outside.md"), /repository-relative/);
  assert.throws(() => taskPath("C:\\outside.md"), /repository-relative/);
});