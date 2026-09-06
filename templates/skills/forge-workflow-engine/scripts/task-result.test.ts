import assert from "node:assert/strict";
import test from "node:test";
import { parseTaskHandoff } from "./task-result.ts";
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