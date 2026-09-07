import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskHandoff, readTaskHandoff } from "./task-result.ts";
import { ArtifactStore } from "./artifacts.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("structured handoff projects actual outcomes rather than startup output", () => {
  const store = new ArtifactStore({ artifactsPath: mkdtempSync(join(tmpdir(), "handoff-")) });
  const handoff = { summary: "Implemented atomic posting", decisions: ["One transaction per posting"], interfaces: ["PostingService.Post"], tests: ["dotnet test: passed"], unresolved: [] };
  const output = "startup logs\n".repeat(100) + "```forge-result\n" + JSON.stringify(handoff) + "\n```";
  assert.deepEqual(parseTaskHandoff(output), handoff);
  store.synthesise({ type: "work.post", taskId: "post", taskTitle: "Posting", taskDescription: "Implement posting", producedBy: "worker", outputFiles: ["Posting.cs"], agentOutput: output, inputArtifactIds: [] });
  const rendered = store.renderProjection(store.project({ taskId: "next", inputTypes: ["work.post"] }));
  assert.ok(rendered.includes("One transaction per posting"));
  assert.ok(rendered.includes("dotnet test: passed"));
  assert.ok(!rendered.includes("startup logs"));
  assert.ok(!rendered.includes("90%"));
});
test("malformed or unverified handoffs are not accepted", () => {
  assert.equal(parseTaskHandoff("all done"), undefined);
  assert.equal(parseTaskHandoff('```forge-result\n{"summary":"Done"}\n```'), undefined);
});

test("minimal reports and bank-style summary lists normalize without losing blockers", () => {
  for (const summary of ["Scaffold verified", ["Scaffold verified", "Required checks passed"]]) {
    const output = '```forge-result\n' + JSON.stringify({ summary, unresolved: [] }) + '\n```';
    const handoff = parseTaskHandoff(output)!;
    assert.equal(handoff.summary, Array.isArray(summary) ? summary.join("\n") : summary);
    assert.deepEqual(handoff.tests, []);
    assert.deepEqual(handoff.decisions, []);
    assert.deepEqual(handoff.interfaces, []);
  }
  const blocked = parseTaskHandoff('```forge-result\n{"summary":["Work remains"],"unresolved":["Required check not run"]}\n```');
  assert.deepEqual(blocked?.unresolved, ["Required check not run"]);
});

test("report errors identify missing fields, invalid types, JSON and oversized reports", () => {
  assert.match(readTaskHandoff("Done").error!, /Missing fenced/);
  assert.match(readTaskHandoff('```forge-result\nnot JSON\n```').error!, /invalid JSON/);
  for (const value of [null, [], 1]) assert.match(readTaskHandoff('```forge-result\n' + JSON.stringify(value) + '\n```').error!, /JSON object/);
  for (const summary of [[], [""], [42], "", null]) {
    assert.match(readTaskHandoff('```forge-result\n' + JSON.stringify({ summary, unresolved: [] }) + '\n```').error!, /summary/);
  }
  assert.match(readTaskHandoff('```forge-result\n{"summary":"Done"}\n```').error!, /unresolved/);
  assert.match(readTaskHandoff('```forge-result\n{"summary":"Done","unresolved":[],"tests":"passed"}\n```').error!, /tests/);
  assert.match(readTaskHandoff('```forge-result\n' + JSON.stringify({ summary: "x".repeat(16001), unresolved: [] }) + '\n```').error!, /16000/);
});

test("handoffs distinguish blockers from optional nonblocking caveats", () => {
  const handoff = { summary: "Built scaffold", decisions: [], interfaces: [], tests: ["npm test: exit 0"], unresolved: [], warnings: ["Changes await engine auto-commit"], validationLimitations: ["Hosted CI has not run; local required checks passed"] };
  const output = (value: unknown) => "```forge-result\n" + JSON.stringify(value) + "\n```";
  assert.deepEqual(parseTaskHandoff(output(handoff)), handoff);
  const store = new ArtifactStore({ artifactsPath: mkdtempSync(join(tmpdir(), "handoff-caveats-")) });
  store.synthesise({ type: "work.scaffold", taskId: "scaffold", taskTitle: "Scaffold", taskDescription: "Build scaffold", producedBy: "worker", outputFiles: [], agentOutput: output(handoff), inputArtifactIds: [], validationEvidence: ["npm test: exit 0 (engine-verified)"] });
  const projection = store.renderProjection(store.project({ taskId: "next", inputTypes: ["work.scaffold"] }));
  assert.ok(projection.includes(handoff.warnings[0]!));
  assert.ok(projection.includes(handoff.validationLimitations[0]!));
  assert.deepEqual(parseTaskHandoff(output({ ...handoff, unresolved: ["Required guard was not verified"] }))?.unresolved, ["Required guard was not verified"]);
  for (const field of ["warnings", "validationLimitations"]) {
    for (const invalid of [null, "note", [""], [42]]) {
      assert.equal(parseTaskHandoff(output({ ...handoff, [field]: invalid })), undefined);
    }
  }
});