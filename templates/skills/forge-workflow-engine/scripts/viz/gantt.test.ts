import assert from "node:assert/strict";
import test from "node:test";

import { buildAxis, estimateDuration, layoutGantt, xFor, type GanttBar } from "./gantt.ts";
import { prerequisites, unmetPrerequisites } from "../task-graph.ts";
import type { ExecutionManifest, ManifestTask, TaskContract } from "../../../forge-execution-adapter/scripts/types.ts";

type ManifestPhase = ExecutionManifest["phases"][number];

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = Date.parse("2026-03-02T09:00:00.000Z");

function at(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString();
}

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

function reviewTask(id: string, dependencies: string[] = []): ManifestTask {
  const contract: TaskContract = { version: 1, kind: "human-review", requirements: [], acceptanceCriteria: ["Reviewed"], constraints: [], references: [] };
  return makeTask(id, dependencies, { contract, approvalRequired: true });
}

function makePhase(id: string, tasks: ManifestTask[], dependencies: string[] = []): ManifestPhase {
  return { id, title: `Phase ${id}`, description: "", ownerAgents: [], dependencies, approvalRequired: false, tasks };
}

function makeManifest(phases: ManifestPhase[]): ExecutionManifest {
  return {
    version: "1.0",
    generatedAt: new Date(T0).toISOString(),
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

const bar = (layout: ReturnType<typeof layoutGantt>, taskId: string): GanttBar => {
  const found = layout.bars.find((entry) => entry.taskId === taskId);
  assert.ok(found, `expected a bar for ${taskId}`);
  return found;
};

// ─── The engine's dispatch rule is the one we schedule from ──────────────────

test("a phase dependency brings in every task of the depended-on phase", () => {
  const manifest = makeManifest([
    makePhase("a", [makeTask("a.1"), makeTask("a.2")]),
    makePhase("b", [makeTask("b.1", [], {})], ["a"]),
  ]);
  assert.deepEqual(prerequisites(manifest, "b.1"), ["a.1", "a.2"]);
});

test("prerequisites and unmetPrerequisites agree, differing only by completion", () => {
  const manifest = makeManifest([
    makePhase("a", [makeTask("a.1"), makeTask("a.2")]),
    makePhase("b", [makeTask("b.1")], ["a"]),
  ]);
  const state = {
    startedAt: at(0),
    tasks: {
      "a.1": { status: "complete", startedAt: at(0), completedAt: at(MINUTE) },
      "a.2": { status: "pending" },
    },
  };
  assert.deepEqual(unmetPrerequisites(manifest, state as never, "b.1"), ["a.2"]);
  assert.equal(unmetPrerequisites(manifest, state as never, "b.1").length < prerequisites(manifest, "b.1").length, true);
});

test("an unknown task has no prerequisites", () => {
  assert.deepEqual(prerequisites(makeManifest([makePhase("a", [makeTask("a.1")])]), "nope"), []);
});

test("a prerequisite outside this manifest is dropped rather than stalling the schedule", () => {
  const manifest = makeManifest([makePhase("a", [makeTask("a.1", ["ghost"])])]);
  const layout = layoutGantt(manifest, null, { nowMs: T0, defaultDurationMs: MINUTE });
  // The task still gets a bar, rather than disappearing or hanging off the axis.
  assert.equal(layout.bars.length, 1);
  assert.ok(Number.isFinite(bar(layout, "a.1").endMs));
});

// ─── Estimate ladder ──────────────────────────────────────────────────────────

test("an estimate prefers the task's own observed attempts", () => {
  const task = makeTask("t", [], { ownerAgent: "ui-engineer" });
  const observed = new Map([["t", [5 * MINUTE, 7 * MINUTE, 9 * MINUTE]]]);
  const ownerMedian = new Map([["ui-engineer", 30 * MINUTE]]);
  assert.deepEqual(estimateDuration(task, observed, ownerMedian, MINUTE), { durationMs: 7 * MINUTE, source: "audit" });
});

test("with no history for the task, the estimate falls back to its agent", () => {
  const task = makeTask("t", [], { ownerAgent: "ui-engineer" });
  const ownerMedian = new Map([["ui-engineer", 22 * MINUTE]]);
  assert.deepEqual(estimateDuration(task, new Map(), ownerMedian, MINUTE), { durationMs: 22 * MINUTE, source: "owner" });
});

test("with nothing observed at all, the estimate is the declared default", () => {
  const task = makeTask("t", [], { ownerAgent: "ui-engineer" });
  assert.deepEqual(estimateDuration(task, new Map(), new Map(), 7 * MINUTE), { durationMs: 7 * MINUTE, source: "default" });
});

test("nonsense durations are discarded rather than becoming a zero-length bar", () => {
  const task = makeTask("t");
  const observed = new Map([["t", [0, -5, Number.NaN]]]);
  assert.deepEqual(estimateDuration(task, observed, new Map(), 4 * MINUTE), { durationMs: 4 * MINUTE, source: "default" });
});

test("a median of an even sample averages the middle pair", () => {
  const task = makeTask("t");
  const observed = new Map([["t", [2 * MINUTE, 4 * MINUTE]]]);
  assert.equal(estimateDuration(task, observed, new Map(), MINUTE).durationMs, 3 * MINUTE);
});

// ─── Forecast scheduling ──────────────────────────────────────────────────────

test("a never-run build forecasts every task from the run start", () => {
  const manifest = makeManifest([
    makePhase("a", [makeTask("a.1", [], { ownerAgent: "core" }), makeTask("a.2", ["a.1"], { ownerAgent: "core" })]),
  ]);
  const layout = layoutGantt(manifest, { startedAt: at(0) }, {
    nowMs: T0,
    defaultDurationMs: 10 * MINUTE,
    observedDurationsMs: { "a.1": [10 * MINUTE], "a.2": [5 * MINUTE] },
  });
  assert.equal(bar(layout, "a.1").startMs, T0);
  assert.equal(bar(layout, "a.1").endMs, T0 + 10 * MINUTE);
  // a.2 waits for a.1 to finish, not merely to start.
  assert.equal(bar(layout, "a.2").startMs, T0 + 10 * MINUTE);
  assert.equal(bar(layout, "a.2").endMs, T0 + 15 * MINUTE);
  assert.ok(layout.bars.every((entry) => entry.kind === "planned"));
});

test("a still-running dependency is projected forward, not treated as finished", () => {
  const manifest = makeManifest([
    makePhase("a", [makeTask("a.1", [], { ownerAgent: "core" }), makeTask("a.2", ["a.1"], { ownerAgent: "core" })]),
  ]);
  const layout = layoutGantt(manifest, {
    startedAt: at(0),
    tasks: { "a.1": { status: "running", startedAt: at(5 * MINUTE) } },
  }, { nowMs: T0 + 6 * MINUTE, defaultDurationMs: 10 * MINUTE, observedDurationsMs: { "a.1": [10 * MINUTE] } });
  // a.1 has run 1 of its estimated 10 minutes, so it is projected to finish at
  // 5+10=15min. Scheduling a.2 at "now" would claim a dependency can complete
  // the moment we happened to look at the board.
  assert.equal(bar(layout, "a.1").endMs, T0 + 15 * MINUTE);
  assert.equal(bar(layout, "a.2").startMs, T0 + 15 * MINUTE);
});

test("a completed task is not re-scheduled and does not claim a worker", () => {
  const manifest = makeManifest([
    makePhase("a", [makeTask("a.1", [], { ownerAgent: "core" }), makeTask("a.2", [], { ownerAgent: "core" })]),
  ]);
  const layout = layoutGantt(manifest, {
    startedAt: at(0),
    tasks: { "a.1": { status: "complete", startedAt: at(0), completedAt: at(10 * MINUTE) } },
  }, { nowMs: T0 + 11 * MINUTE, defaultDurationMs: 10 * MINUTE });
  assert.equal(bar(layout, "a.1").kind, "actual");
  assert.equal(bar(layout, "a.1").estimateSource, "actual");
  // The forecast continues from the last real activity — a.1 finishing — not
  // from whenever the reader happened to open the board.
  assert.equal(bar(layout, "a.2").startMs, T0 + 10 * MINUTE);
});

test("serial concurrency runs independent tasks one after another", () => {
  const manifest = makeManifest([
    makePhase("a", [
      makeTask("a.1", [], { ownerAgent: "core" }),
      makeTask("a.2", [], { ownerAgent: "core" }),
      makeTask("a.3", [], { ownerAgent: "core" }),
    ]),
  ]);
  const layout = layoutGantt(manifest, { startedAt: at(0) }, {
    nowMs: T0, defaultDurationMs: 10 * MINUTE, concurrency: 1,
    observedDurationsMs: { "a.1": [10 * MINUTE], "a.2": [10 * MINUTE], "a.3": [10 * MINUTE] },
  });
  assert.equal(bar(layout, "a.1").startMs, T0);
  assert.equal(bar(layout, "a.2").startMs, T0 + 10 * MINUTE);
  assert.equal(bar(layout, "a.3").startMs, T0 + 20 * MINUTE);
  assert.equal(layout.forecastEndMs, T0 + 30 * MINUTE);
});

test("parallel concurrency overlaps independent tasks instead of queueing them", () => {
  const manifest = makeManifest([
    makePhase("a", [
      makeTask("a.1", [], { ownerAgent: "core" }),
      makeTask("a.2", [], { ownerAgent: "ui" }),
      makeTask("a.3", [], { ownerAgent: "qa" }),
    ]),
  ]);
  const layout = layoutGantt(manifest, { startedAt: at(0) }, {
    nowMs: T0, defaultDurationMs: 10 * MINUTE, concurrency: 2,
    observedDurationsMs: { "a.1": [10 * MINUTE], "a.2": [10 * MINUTE], "a.3": [10 * MINUTE] },
  });
  // Two workers, so the first two start together and the third waits for a slot.
  assert.equal(bar(layout, "a.1").startMs, T0);
  assert.equal(bar(layout, "a.2").startMs, T0);
  assert.equal(bar(layout, "a.3").startMs, T0 + 10 * MINUTE);
  // And the build therefore finishes earlier than it would serially.
  assert.equal(layout.forecastEndMs, T0 + 20 * MINUTE);
});

test("the run's configured concurrency shortens the forecast, never lengthens it", () => {
  const manifest = makeManifest([
    makePhase("a", [makeTask("a.1", [], { ownerAgent: "core" }), makeTask("a.2", [], { ownerAgent: "core" })]),
  ]);
  const options = { nowMs: T0, defaultDurationMs: 10 * MINUTE, observedDurationsMs: { "a.1": [10 * MINUTE], "a.2": [10 * MINUTE] } };
  const serial = layoutGantt(manifest, { startedAt: at(0) }, { ...options, concurrency: 1 });
  const parallel = layoutGantt(manifest, { startedAt: at(0) }, { ...options, concurrency: 4 });
  assert.ok(parallel.forecastEndMs < serial.forecastEndMs);
});

// ─── Actual bars ──────────────────────────────────────────────────────────────

test("a started task renders as an actual bar bounded by its forecast", () => {
  const manifest = makeManifest([makePhase("a", [makeTask("a.1", [], { ownerAgent: "core" })])]);
  const layout = layoutGantt(manifest, {
    startedAt: at(0),
    tasks: { "a.1": { status: "running", startedAt: at(2 * MINUTE) } },
  }, { nowMs: T0 + 7 * MINUTE, defaultDurationMs: 10 * MINUTE });
  const running = bar(layout, "a.1");
  assert.equal(running.kind, "actual");
  assert.equal(running.startMs, T0 + 2 * MINUTE);
  // Two minutes in, ten estimated: the bar shows where the task is projected to
  // land, so the now-line can be drawn against it while the run is live.
  assert.equal(running.endMs, T0 + 12 * MINUTE);
});

test("an unstarted task is still scheduled, so the board is not blank before a run", () => {
  const manifest = makeManifest([makePhase("a", [makeTask("a.1")])]);
  const layout = layoutGantt(manifest, null, { nowMs: T0, defaultDurationMs: MINUTE });
  assert.equal(layout.bars.length, 1);
  assert.equal(layout.bars[0]!.kind, "planned");
});

// ─── Critical path ────────────────────────────────────────────────────────────

test("the critical path follows phase dependencies into the next phase", () => {
  const manifest = makeManifest([
    // Phase A: 5 + 60 + 5. Phase B: 30 + 30, and depends on phase A, so its
    // first task waits for *all* of A. The longest chain therefore runs straight
    // through both phases rather than stopping at the phase boundary.
    makePhase("a", [
      makeTask("a.1", [], { ownerAgent: "core" }),
      makeTask("a.2", ["a.1"], { ownerAgent: "core" }),
      makeTask("a.3", ["a.2"], { ownerAgent: "core" }),
    ]),
    makePhase("b", [
      makeTask("b.1", [], { ownerAgent: "ui" }),
      makeTask("b.2", ["b.1"], { ownerAgent: "ui" }),
    ], ["a"]),
  ]);
  const layout = layoutGantt(manifest, { startedAt: at(0) }, {
    nowMs: T0,
    concurrency: 1,
    observedDurationsMs: {
      "a.1": [5 * MINUTE], "a.2": [HOUR], "a.3": [5 * MINUTE],
      "b.1": [30 * MINUTE], "b.2": [30 * MINUTE],
    },
  });
  assert.deepEqual(layout.criticalPath, ["a.1", "a.2", "a.3", "b.1", "b.2"]);
  assert.ok(layout.bars.every((entry) => entry.critical));
});

test("an off-path task is not marked critical even when it is in the same phase", () => {
  const manifest = makeManifest([
    makePhase("a", [
      makeTask("a.1", [], { ownerAgent: "core" }),
      makeTask("a.2", ["a.1"], { ownerAgent: "core" }),
      makeTask("side", [], { ownerAgent: "docs" }),
    ]),
  ]);
  const layout = layoutGantt(manifest, { startedAt: at(0) }, {
    nowMs: T0,
    concurrency: 1,
    observedDurationsMs: { "a.1": [5 * MINUTE], "a.2": [HOUR], side: [MINUTE] },
  });
  assert.deepEqual(layout.criticalPath, ["a.1", "a.2"]);
  assert.equal(bar(layout, "side").critical, false);
});

test("at serial concurrency the forecast end equals the critical path's total", () => {
  const manifest = makeManifest([
    makePhase("a", [makeTask("a.1", [], { ownerAgent: "core" }), makeTask("a.2", ["a.1"], { ownerAgent: "core" })]),
  ]);
  const layout = layoutGantt(manifest, { startedAt: at(0) }, {
    nowMs: T0, concurrency: 1,
    observedDurationsMs: { "a.1": [10 * MINUTE], "a.2": [30 * MINUTE] },
  });
  assert.equal(layout.forecastEndMs, T0 + 40 * MINUTE);
  assert.deepEqual(layout.criticalPath, ["a.1", "a.2"]);
  assert.ok(Number.isFinite(xFor(layout, layout.forecastEndMs)));
});

test("finished work contributes no remaining time to the critical path", () => {
  const manifest = makeManifest([
    makePhase("a", [makeTask("a.1", [], { ownerAgent: "core" }), makeTask("a.2", ["a.1"], { ownerAgent: "core" })]),
  ]);
  const layout = layoutGantt(manifest, {
    startedAt: at(0),
    tasks: { "a.1": { status: "complete", startedAt: at(0), completedAt: at(HOUR) } },
  }, { nowMs: T0 + HOUR, concurrency: 1, observedDurationsMs: { "a.2": [5 * MINUTE] } });
  // a.1 stays on the path — it really does lead into the remaining work — but
  // contributes zero, so the path's remaining time is a.2's 5 minutes alone.
  assert.ok(layout.criticalPath.includes("a.2"));
  assert.equal(layout.criticalPath.at(-1), "a.2");
  assert.equal(layout.forecastEndMs, T0 + HOUR + 5 * MINUTE);
});

// ─── Milestones, rows and rollups ────────────────────────────────────────────

test("a human review renders as a zero-length milestone at its finish", () => {
  const manifest = makeManifest([
    makePhase("a", [makeTask("a.1", [], { ownerAgent: "core" }), reviewTask("a.2", ["a.1"])]),
  ]);
  const layout = layoutGantt(manifest, { startedAt: at(0) }, {
    nowMs: T0, concurrency: 1, observedDurationsMs: { "a.1": [10 * MINUTE] },
  });
  const gate = bar(layout, "a.2");
  assert.equal(gate.milestone, true);
  assert.equal(gate.startMs, gate.endMs);
  assert.equal(gate.durationMs, 0);
  // It still waits for its prerequisite before it can be reviewed.
  assert.equal(gate.endMs, T0 + 10 * MINUTE);
});

test("rows group tasks under their phase and never overlap", () => {
  const manifest = makeManifest([
    makePhase("a", [makeTask("a.1"), makeTask("a.2")]),
    makePhase("b", [makeTask("b.1")]),
  ]);
  const layout = layoutGantt(manifest, null, { nowMs: T0, defaultDurationMs: MINUTE });
  assert.deepEqual(layout.rows.filter((row) => row.kind === "phase").map((row) => row.id), ["a", "b"]);
  for (let i = 1; i < layout.rows.length; i += 1) {
    assert.ok(layout.rows[i]!.y > layout.rows[i - 1]!.y, "rows must advance downward");
  }
  const firstTask = layout.rows.find((row) => row.id === "a.1")!;
  assert.equal(firstTask.kind, "task");
  assert.equal(firstTask.phaseRow, 0);
});

test("the first row clears the time-axis gutter", () => {
  const layout = layoutGantt(makeManifest([makePhase("a", [makeTask("a.1")])]), null, {
    nowMs: T0, defaultDurationMs: MINUTE, axisHeight: 34,
  });
  // Tick labels and day rules are drawn in this band, so a phase rollup at y=0
  // would sit underneath them.
  assert.equal(layout.axisHeight, 34);
  assert.ok(layout.rows[0]!.y >= layout.axisHeight);
  assert.ok(layout.height > layout.rows.at(-1)!.y);
});

test("a phase rollup spans its tasks and is flagged critical when it holds the path", () => {
  const manifest = makeManifest([
    makePhase("a", [makeTask("a.1", [], { ownerAgent: "core" }), makeTask("a.2", ["a.1"], { ownerAgent: "core" })]),
  ]);
  const layout = layoutGantt(manifest, { startedAt: at(0) }, {
    nowMs: T0, concurrency: 1, observedDurationsMs: { "a.1": [10 * MINUTE], "a.2": [HOUR] },
  });
  assert.equal(layout.phaseBars.length, 1);
  const rollup = layout.phaseBars[0]!;
  assert.equal(rollup.phaseId, "a");
  assert.equal(rollup.startMs, T0);
  assert.equal(rollup.endMs, T0 + 10 * MINUTE + HOUR);
  assert.equal(rollup.critical, true);
});

test("an empty phase produces no rollup", () => {
  const layout = layoutGantt(makeManifest([makePhase("empty", [])]), null, { nowMs: T0 });
  assert.deepEqual(layout.phaseBars, []);
});

// ─── Edges ────────────────────────────────────────────────────────────────────

test("edges come from the dispatch rule and record whether they are satisfied", () => {
  const manifest = makeManifest([
    makePhase("a", [makeTask("a.1"), makeTask("a.2")]),
    makePhase("b", [makeTask("b.1")], ["a"]),
  ]);
  const layout = layoutGantt(manifest, {
    startedAt: at(0),
    tasks: { "a.1": { status: "complete", startedAt: at(0), completedAt: at(MINUTE) }, "a.2": { status: "pending" } },
  }, { nowMs: T0, defaultDurationMs: MINUTE });
  assert.equal(layout.edges.length, 2, "b.1 depends on both a.1 and a.2 via the phase dependency");
  assert.deepEqual(layout.edges.find((edge) => edge.to === "b.1" && edge.from === "a.1")?.satisfied, true);
  assert.deepEqual(layout.edges.find((edge) => edge.to === "b.1" && edge.from === "a.2")?.satisfied, false);
});

test("a skipped task counts as done for scheduling", () => {
  const manifest = makeManifest([
    makePhase("a", [makeTask("a.1"), makeTask("a.2", ["a.1"])]),
  ]);
  const layout = layoutGantt(manifest, {
    startedAt: at(0),
    tasks: { "a.1": { status: "skipped" } },
  }, { nowMs: T0, concurrency: 1, defaultDurationMs: MINUTE });
  // a.1 is finished, so a.2 is scheduled from now rather than waiting on it.
  assert.equal(bar(layout, "a.2").startMs, T0);
});

// ─── Axis ─────────────────────────────────────────────────────────────────────

test("the axis picks a granularity that suits the span", () => {
  assert.ok(buildAxis(T0, T0 + 20 * MINUTE).ticks.length >= 1);
  const hourly = buildAxis(T0, T0 + 8 * HOUR);
  assert.ok(hourly.ticks.length <= 12);
  const daily = buildAxis(T0, T0 + 30 * 24 * HOUR);
  assert.ok(daily.ticks.every((tick) => /^\d+\/\d+$/.test(tick.label)), "long spans label by day");
});

test("the axis still labels a span shorter than one step", () => {
  const axis = buildAxis(T0, T0 + 1000);
  assert.equal(axis.ticks.length, 1);
});

test("ticks land inside the axis range", () => {
  const axis = buildAxis(T0, T0 + 3 * HOUR);
  for (const tick of axis.ticks) {
    assert.ok(tick.at >= axis.min && tick.at <= axis.max, `tick ${new Date(tick.at).toISOString()} outside the range`);
  }
});

test("midnight is marked so it can be drawn as a full-height rule", () => {
  const midnight = Date.parse("2026-03-02T00:00:00.000Z");
  const axis = buildAxis(midnight - 12 * HOUR, midnight + 12 * HOUR);
  assert.ok(axis.ticks.some((tick) => tick.dayBoundary));
});

// ─── Geometry ─────────────────────────────────────────────────────────────────

test("xFor maps the axis range across the plot area", () => {
  const layout = layoutGantt(makeManifest([makePhase("a", [makeTask("a.1")])]), { startedAt: at(0) }, {
    nowMs: T0, defaultDurationMs: MINUTE, width: 1000,
  });
  const min = layout.axis.min;
  const max = layout.axis.max;
  assert.equal(xFor(layout, min), layout.plot.left);
  assert.ok(Math.abs(xFor(layout, max) - (layout.plot.left + layout.plot.width)) < 0.001);
  assert.ok(xFor(layout, (min + max) / 2) > layout.plot.left);
});

test("the layout survives JSON serialisation, which is how the board receives it", () => {
  const layout = layoutGantt(
    makeManifest([makePhase("a", [makeTask("a.1", [], { ownerAgent: "core" })])]),
    { startedAt: at(0) },
    { nowMs: T0, defaultDurationMs: MINUTE },
  );
  // A closure on the payload would be dropped by JSON.stringify and arrive as
  // undefined, so the layout must stay plain data all the way to the renderer.
  const round = JSON.parse(JSON.stringify(layout)) as typeof layout;
  assert.equal(xFor(round, round.axis.min), round.plot.left);
  assert.ok(round.bars.length > 0);
  assert.ok(Number.isFinite(round.bars[0]!.startMs));
});

test("a bar never ends before it starts", () => {
  const manifest = makeManifest([
    makePhase("a", [makeTask("a.1", [], { ownerAgent: "core" }), reviewTask("a.2", ["a.1"])]),
  ]);
  const layout = layoutGantt(manifest, {
    startedAt: at(0),
    tasks: { "a.1": { status: "complete", startedAt: at(0), completedAt: at(0) } },
  }, { nowMs: T0, concurrency: 1, defaultDurationMs: MINUTE });
  for (const entry of layout.bars) {
    assert.ok(entry.endMs >= entry.startMs, `${entry.taskId} ends before it starts`);
  }
});

test("a finished run's axis covers the run, not the weeks since it ended", () => {
  const manifest = makeManifest([makePhase("a", [makeTask("a.1", [], { ownerAgent: "core" })])]);
  // The run finished an hour ago; "now" is a week later because the Console was
  // reopened. Stretching the axis to now would compress the whole build.
  const layout = layoutGantt(manifest, {
    startedAt: at(0),
    tasks: { "a.1": { status: "complete", startedAt: at(60 * MINUTE), completedAt: at(70 * MINUTE) } },
  }, { nowMs: T0 + 7 * 24 * HOUR });
  assert.equal(layout.bars.every((entry) => entry.kind === "actual"), true, "nothing left to forecast");
  assert.equal(layout.axis.max, T0 + 70 * MINUTE);
  assert.ok(layout.axis.max < layout.nowMs, "the axis stops at the run, not at the present");
});

test("a run with work outstanding keeps the axis reaching now", () => {
  const manifest = makeManifest([
    makePhase("a", [makeTask("a.1", [], { ownerAgent: "core" }), makeTask("a.2", ["a.1"], { ownerAgent: "core" })]),
  ]);
  const layout = layoutGantt(manifest, {
    startedAt: at(0),
    tasks: { "a.1": { status: "complete", startedAt: at(0), completedAt: at(10 * MINUTE) } },
  }, { nowMs: T0 + 20 * MINUTE, defaultDurationMs: 10 * MINUTE, observedDurationsMs: { "a.2": [10 * MINUTE] } });
  assert.equal(layout.bars.some((entry) => entry.kind === "planned"), true);
  assert.ok(layout.axis.max >= layout.nowMs);
});

test("a run untouched for days stays on its own window instead of stretching to the present", () => {
  const manifest = makeManifest([
    makePhase("a", [
      makeTask("a.1", [], { ownerAgent: "core" }),
      makeTask("a.2", ["a.1"], { ownerAgent: "core" }),
      makeTask("a.3", ["a.2"], { ownerAgent: "core" }),
    ]),
  ]);
  // The Console is reopened eight days after the last recorded activity. A task
  // is still marked running and two are still pending, which is stale state.
  const lastActivity = T0 + 3 * HOUR;
  const layout = layoutGantt(manifest, {
    startedAt: at(0),
    tasks: {
      "a.1": { status: "complete", startedAt: at(0), completedAt: at(HOUR) },
      "a.2": { status: "running", startedAt: at(HOUR) },
    },
  }, {
    nowMs: T0 + 8 * 24 * HOUR,
    defaultDurationMs: 30 * MINUTE,
    observedDurationsMs: { "a.1": [HOUR] },
  });
  // Everything the chart shows belongs to the run itself.
  assert.ok(layout.axis.max < T0 + 24 * HOUR, "the axis must not reach the present");
  assert.ok(layout.axis.max >= lastActivity - HOUR);
  // And the running task's bar is bounded by its own forecast rather than
  // stretching across the idle gap.
  const running = bar(layout, "a.2");
  assert.equal(running.kind, "actual");
  assert.ok(running.endMs - running.startMs <= 2 * HOUR, "a stale running bar spans its estimate, not a week");
  // The now-line is outside the axis, which is how the staleness shows.
  assert.ok(layout.nowMs > layout.axis.max);
});

test("an empty manifest still produces a drawable layout", () => {
  const layout = layoutGantt(makeManifest([]), null, { nowMs: T0 });
  assert.deepEqual(layout.rows, []);
  assert.deepEqual(layout.bars, []);
  assert.ok(layout.height > 0);
  assert.ok(Number.isFinite(xFor(layout, T0)));
});