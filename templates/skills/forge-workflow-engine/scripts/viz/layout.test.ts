import assert from "node:assert/strict";
import test from "node:test";

import { layoutManifest } from "./layout.ts";
import type { ExecutionManifest, ManifestTask } from "../../../forge-execution-adapter/scripts/types.ts";

type ManifestPhase = ExecutionManifest["phases"][number];

function makeTask(id: string, dependencies: string[] = [], extra: Partial<ManifestTask> = {}): ManifestTask {
  return {
    id,
    title: `Task ${id}`,
    description: `Task ${id} description`,
    dependencies,
    expectedOutputs: [],
    validationCommands: [],
    approvalRequired: false,
    sourceLines: [],
    ...extra,
  };
}

function makePhase(id: string, tasks: ManifestTask[], dependencies: string[] = []): ManifestPhase {
  return {
    id,
    title: `Phase ${id}`,
    description: "",
    ownerAgents: [],
    dependencies,
    approvalRequired: false,
    tasks,
  };
}

function makeManifest(phases: ManifestPhase[]): ExecutionManifest {
  return {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    repoRoot: "/tmp",
    harnessRoot: ".opencode",
    prdPath: "/tmp/docs/PRD.md",
    progressPath: "/tmp/docs/PROGRESS.md",
    auditPath: "/tmp/docs/EXECUTION-AUDIT.jsonl",
    validationCommands: [],
    approvalGates: { preflight: true, betweenPhases: true },
    phases,
    warnings: [],
  };
}

test("layout has four equal, ordered status columns after the label rail", () => {
  const manifest = makeManifest([makePhase("1", [makeTask("1.1")])]);
  const layout = layoutManifest(manifest, { width: 1000, height: 600, labelWidth: 150, padX: 10 });

  assert.equal(layout.columns.length, 4);
  assert.deepEqual(
    layout.columns.map((c) => c.key),
    ["pending", "running", "complete", "failed"],
  );
  assert.deepEqual(
    layout.columns.map((c) => c.label),
    ["To Do", "In Progress", "Done", "Failed"],
  );
  assert.ok(layout.columns[0]!.x >= 150, "first column starts after the label rail");
  for (let i = 1; i < layout.columns.length; i += 1) {
    assert.ok(layout.columns[i]!.x > layout.columns[i - 1]!.x, "columns are ordered left-to-right");
  }
  const widths = new Set(layout.columns.map((c) => c.width));
  assert.equal(widths.size, 1, "all columns share the same width");
});

test("layout creates one band per phase, stacked top-to-bottom", () => {
  const manifest = makeManifest([
    makePhase("1", [makeTask("1.1")]),
    makePhase("2", [makeTask("2.1")], ["1"]),
  ]);
  const layout = layoutManifest(manifest, { width: 1000, height: 600, topMargin: 80 });

  assert.equal(layout.phases.length, 2);
  const p1 = layout.phases.find((p) => p.id === "1")!;
  const p2 = layout.phases.find((p) => p.id === "2")!;
  assert.ok(p2.y > p1.y, "phase 2 band sits below phase 1 band");
  assert.equal(p1.height, p2.height);
  assert.equal(layout.tasks.length, 2);
  assert.equal(layout.tasks[0]!.phaseId, "1");
  assert.equal(layout.tasks[1]!.phaseId, "2");
});

test("layout emits dependency and artifact edges and skips phase edges", () => {
  const manifest = makeManifest([
    makePhase("1", [
      makeTask("1.1", [], { produces: "work.1.1" }),
      makeTask("1.2", ["1.1"], { inputs: ["work.1.1"], produces: "work.1.2" }),
    ]),
    makePhase("2", [makeTask("2.1", ["1.2"])], ["1"]),
  ]);
  const layout = layoutManifest(manifest);

  const kinds = layout.edges.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ["artifact", "dependency", "dependency"]);

  const artifact = layout.edges.find((e) => e.kind === "artifact")!;
  assert.equal(artifact.from, "1.1");
  assert.equal(artifact.to, "1.2");

  const dep = layout.edges.find((e) => e.from === "1.2")!;
  assert.equal(dep.to, "2.1");
});

test("layout ignores dependencies that reference unknown tasks", () => {
  const manifest = makeManifest([
    makePhase("1", [makeTask("1.1", ["ghost"])]),
  ]);
  const layout = layoutManifest(manifest);
  assert.deepEqual(layout.edges, []);
});
