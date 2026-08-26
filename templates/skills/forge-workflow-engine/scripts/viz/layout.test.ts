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

test("layout places each task in its phase and spreads tasks along the branch line", () => {
  const manifest = makeManifest([
    makePhase("1", [makeTask("1.1"), makeTask("1.2"), makeTask("1.3")]),
  ]);
  const layout = layoutManifest(manifest, { width: 1000, height: 600, phaseHeight: 180, branchSpan: 300 });

  assert.equal(layout.phases.length, 1);
  assert.equal(layout.tasks.length, 3);
  assert.equal(layout.trunkX, 500);

  // First and last tasks sit on opposite ends of the branch line.
  const [a, b, c] = layout.tasks;
  assert.ok(a.x < b.x && b.x < c.x);
  assert.ok(a.x < layout.trunkX && c.x > layout.trunkX);
  // All tasks in the same phase share the same y (branch line + offset).
  assert.equal(a.y, b.y);
  assert.equal(b.y, c.y);
});

test("layout grows upward: later phases are above earlier phases", () => {
  const manifest = makeManifest([
    makePhase("1", [makeTask("1.1")]),
    makePhase("2", [makeTask("2.1")], ["1"]),
  ]);
  const layout = layoutManifest(manifest, { width: 1000, height: 600, phaseHeight: 180, bottomMargin: 100 });

  const p1 = layout.phases.find((p) => p.id === "1")!;
  const p2 = layout.phases.find((p) => p.id === "2")!;
  assert.ok(p2.y < p1.y, "phase 2 should sit above phase 1");

  const t1 = layout.tasks.find((t) => t.id === "1.1")!;
  const t2 = layout.tasks.find((t) => t.id === "2.1")!;
  assert.ok(t2.y < t1.y);
  assert.equal(layout.trunkBottom, 500);
});

test("layout emits dependency, artifact, and phase edges", () => {
  const manifest = makeManifest([
    makePhase("1", [
      makeTask("1.1", [], { produces: "work.1.1" }),
      makeTask("1.2", ["1.1"], { inputs: ["work.1.1"], produces: "work.1.2" }),
    ]),
    makePhase("2", [makeTask("2.1", ["1.2"])], ["1"]),
  ]);
  const layout = layoutManifest(manifest);

  const kinds = layout.edges.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ["artifact", "dependency", "dependency", "phase"]);

  const artifact = layout.edges.find((e) => e.kind === "artifact")!;
  assert.equal(artifact.from, "1.1");
  assert.equal(artifact.to, "1.2");

  const phase = layout.edges.find((e) => e.kind === "phase")!;
  assert.equal(phase.from, "1.2");
  assert.equal(phase.to, "2.1");
});

test("layout ignores dependencies that reference unknown tasks", () => {
  const manifest = makeManifest([
    makePhase("1", [makeTask("1.1", ["ghost"])]),
  ]);
  const layout = layoutManifest(manifest);
  assert.deepEqual(layout.edges, []);
});
