import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { allDepsComplete, isComplete, isTaskDone, mapLimit, nextReadyTasks, ownerUniqueReady, replayTask, runEngine, validateManifestDependencies } from "./engine.ts";
import { runCommand } from "./harness/run.ts";
import { readControl, writeControl } from "./control.ts";
import { reconcileState } from "./state.ts";
import type { EngineOptions, ExecutionManifest, HarnessAdapter, ManifestTask, TaskResult, TaskStatus, WorkflowState } from "./types.ts";

type ManifestPhase = ExecutionManifest["phases"][number];

function makeTask(id: string, dependencies: string[] = []): ManifestTask {
  return {
    id,
    title: `Task ${id}`,
    description: `Task ${id} description`,
    dependencies,
    expectedOutputs: [],
    validationCommands: [],
    approvalRequired: false,
    sourceLines: [],
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

test("validateManifestDependencies reports orphan task and phase dependencies", () => {
  const manifest = makeManifest([makePhase("one", [makeTask("one.1", ["missing"]),], ["missing-phase"])]);
  assert.deepEqual(validateManifestDependencies(manifest), [
    "Phase 'one' depends on orphan phase 'missing-phase'.",
    "Task 'one.1' depends on orphan task 'missing'.",
  ]);
});

test("validateManifestDependencies rejects duplicate global task ids", () => {
  const manifest = makeManifest([makePhase("one", [makeTask("same")]), makePhase("two", [makeTask("same")])]);
  assert.throws(() => validateManifestDependencies(manifest), /Duplicate global task id/);
});

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

function makeState(statuses: Record<string, TaskStatus>): WorkflowState {
  const tasks: WorkflowState["tasks"] = {};
  for (const [id, status] of Object.entries(statuses)) {
    tasks[id] = { taskId: id, status, attempt: 0, outputFiles: [] };
  }
  return {
    runId: "test-run",
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    manifestPath: "/tmp/docs/EXECUTION-MANIFEST.json",
    manifestVersion: "1.0",
    harness: "stub",
    status: "running",
    tasks,
    blockers: [],
    auditLog: [],
  };
}

test("isTaskDone treats complete and skipped as done", () => {
  assert.equal(isTaskDone("complete"), true);
  assert.equal(isTaskDone("skipped"), true);
  assert.equal(isTaskDone("pending"), false);
  assert.equal(isTaskDone("running"), false);
  assert.equal(isTaskDone("failed"), false);
  assert.equal(isTaskDone(undefined), false);
});

test("reconcileState preserves completed records and adds pending tasks", () => {
  const old = makeState({ "1.1": "complete" });
  const manifest = makeManifest([makePhase("1", [makeTask("1.1"), makeTask("1.2", ["1.1"])])]);
  const next = reconcileState(old, manifest);
  assert.equal(next.tasks["1.1"]?.status, "complete");
  assert.equal(next.tasks["1.2"]?.status, "pending");
});

test("allDepsComplete accepts skipped dependencies", () => {
  const state = makeState({ "1.1": "complete", "1.2": "skipped" });
  assert.equal(allDepsComplete("1.3", ["1.1", "1.2"], state), true);
  assert.equal(allDepsComplete("1.3", ["1.1", "1.3"], state), false); // 1.3 pending
});

test("nextReadyTasks does not deadlock when a prior phase has a skipped task", () => {
  const manifest = makeManifest([
    makePhase("1", [makeTask("1.1"), makeTask("1.2")]),
    makePhase("2", [makeTask("2.1")], ["1"]),
  ]);
  const state = makeState({ "1.1": "complete", "1.2": "skipped", "2.1": "pending" });

  const ready = nextReadyTasks(manifest, state);
  assert.deepEqual(ready.map((entry) => entry.task.id), ["2.1"]);
});

test("nextReadyTasks blocks a downstream phase while its dependency is pending", () => {
  const manifest = makeManifest([
    makePhase("1", [makeTask("1.1"), makeTask("1.2")]),
    makePhase("2", [makeTask("2.1")], ["1"]),
  ]);
  const state = makeState({ "1.1": "complete", "1.2": "pending", "2.1": "pending" });

  const ready = nextReadyTasks(manifest, state);
  assert.deepEqual(ready.map((entry) => entry.task.id), ["1.2"]);
});

test("nextReadyTasks filters to the manual selection", () => {
  const manifest = makeManifest([
    makePhase("1", [makeTask("1.1"), makeTask("1.2")]),
  ]);
  const state = {
    ...makeState({ "1.1": "pending", "1.2": "pending" }),
    selection: { mode: "manual" as const, scope: "single" as const, taskIds: ["1.2"] },
  };

  const ready = nextReadyTasks(manifest, state);
  assert.deepEqual(ready.map((entry) => entry.task.id), ["1.2"]);
});

test("ownerUniqueReady keeps one task per owner in manifest order", () => {
  const withOwner = (id: string, owner: string) => ({ ...makeTask(id), ownerAgent: owner });
  const ready = [
    { phaseId: "1", phaseIndex: 0, task: withOwner("1.1", "alice") },
    { phaseId: "1", phaseIndex: 0, task: withOwner("1.2", "bob") },
    { phaseId: "1", phaseIndex: 0, task: withOwner("1.3", "alice") },
    { phaseId: "1", phaseIndex: 0, task: withOwner("1.4", "carol") },
    { phaseId: "1", phaseIndex: 0, task: withOwner("1.5", "bob") },
  ] as Parameters<typeof ownerUniqueReady>[0];

  const unique = ownerUniqueReady(ready);
  assert.deepEqual(unique.map((e) => e.task.id), ["1.1", "1.2", "1.4"], "first task per owner wins, in manifest order");
});

test("ownerUniqueReady buckets unassigned tasks together (conservative)", () => {
  const ready = [
    { phaseId: "1", phaseIndex: 0, task: makeTask("1.1") },
    { phaseId: "1", phaseIndex: 0, task: { ...makeTask("1.2"), ownerAgent: "bob" } },
    { phaseId: "1", phaseIndex: 0, task: makeTask("1.3") },
  ] as Parameters<typeof ownerUniqueReady>[0];

  const unique = ownerUniqueReady(ready);
  assert.deepEqual(unique.map((e) => e.task.id), ["1.1", "1.2"], "unassigned tasks share one bucket");
});

test("ownerUniqueReady returns an empty list for an empty frontier", () => {
  assert.deepEqual(ownerUniqueReady([]), []);
});

test("isComplete is true when every task is complete or skipped", () => {
  const manifest = makeManifest([
    makePhase("1", [makeTask("1.1"), makeTask("1.2")]),
    makePhase("2", [makeTask("2.1")], ["1"]),
  ]);

  assert.equal(isComplete(manifest, makeState({ "1.1": "complete", "1.2": "skipped", "2.1": "complete" })), true);
  assert.equal(isComplete(manifest, makeState({ "1.1": "complete", "1.2": "pending", "2.1": "complete" })), false);
});

test("mapLimit preserves result order despite varying completion times", async () => {
  const delays = [30, 5, 10];
  const results = await mapLimit([0, 1, 2], 3, async (i) => {
    await new Promise((resolve) => setTimeout(resolve, delays[i]!));
    return i * 10;
  });
  assert.deepEqual(results, [0, 10, 20]);
});

test("mapLimit never exceeds the concurrency limit but still overlaps", async () => {
  let active = 0;
  let peak = 0;
  const items = Array.from({ length: 8 }, (_, i) => i);

  await mapLimit(items, 3, async (i) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return i;
  });

  assert.ok(peak <= 3, `peak concurrency ${peak} exceeded limit 3`);
  assert.ok(peak >= 2, `expected overlap, saw peak concurrency ${peak}`);
});

test("mapLimit handles an empty array", async () => {
  assert.deepEqual(await mapLimit([], 3, async (x) => x), []);
});

// ─── Configurable task timeout ────────────────────────────────────────────────

class RecordingHarness implements HarnessAdapter {
  readonly name = "recording";
  readonly supportsConcurrency = false;
  timeouts: number[] = [];
  retries: number[] = [];
  taskIds: string[] = [];

  async invoke(
    _agent: Parameters<HarnessAdapter["invoke"]>[0],
    task: ManifestTask,
    _context: WorkflowState,
    _repoRoot: string,
    _contextBlock?: string,
    timeoutMs?: number,
    maxRetries?: number,
  ) {
    this.taskIds.push(task.id);
    this.timeouts.push(timeoutMs ?? -1);
    this.retries.push(maxRetries ?? -1);
    return {
      success: true,
      outputFiles: [],
      stdout: "[recording] ok",
      stderr: "",
      durationMs: 1,
    };
  }
}

/** Harness that calls `onInvoke` when a task starts and blocks until released. */
class GatedHarness implements HarnessAdapter {
  readonly name = "gated";
  readonly supportsConcurrency = false;
  private release: (() => void) | undefined;

  constructor(private readonly onInvoke: () => void) {}

  async invoke(): Promise<TaskResult> {
    this.onInvoke();
    await new Promise<void>((resolve) => { this.release = resolve; });
    return {
      success: true,
      outputFiles: [],
      stdout: "[gated] ok",
      stderr: "",
      durationMs: 1,
    };
  }

  releaseNow(): void {
    this.release?.();
  }
}

/**
 * Concurrency-observing harness. Each invoke blocks until the test releases
 * that task, so the test can control exactly which tasks overlap.
 */
class GatedConcurrentHarness implements HarnessAdapter {
  readonly name = "gated-concurrent";
  readonly supportsConcurrency = true;
  /** Task IDs currently executing (in-flight). */
  active = new Set<string>();
  /** Max number of concurrently executing tasks observed. */
  maxOverlap = 0;
  /** Task IDs that have started, in order. */
  startedOrder: string[] = [];
  private releases = new Map<string, () => void>();
  private startedResolvers = new Map<string, () => void>();

  async invoke(_agent: Parameters<HarnessAdapter["invoke"]>[0], task: ManifestTask): Promise<TaskResult> {
    this.active.add(task.id);
    this.startedOrder.push(task.id);
    this.maxOverlap = Math.max(this.maxOverlap, this.active.size);
    this.startedResolvers.get(task.id)?.();
    await new Promise<void>((resolve) => this.releases.set(task.id, resolve));
    this.active.delete(task.id);
    return {
      success: true,
      outputFiles: [],
      stdout: "[gated-concurrent] ok",
      stderr: "",
      durationMs: 1,
    };
  }

  whenStarted(taskId: string): Promise<void> {
    if (this.startedOrder.includes(taskId)) return Promise.resolve();
    return new Promise((resolve) => this.startedResolvers.set(taskId, resolve));
  }

  release(taskId: string): void {
    this.releases.get(taskId)?.();
  }
}

interface EngineFixture {
  root: string;
  manifestPath: string;
}

function makeEngineFixture(taskOverrides: Partial<ManifestTask> = {}): EngineFixture {
  const root = mkdtempSync(join(tmpdir(), "forge-engine-"));
  mkdirSync(join(root, ".agents", "agents"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });

  writeFileSync(join(root, ".agents", "agents", "worker.md"), `---
name: worker
description: Builds things.
---

## Expertise
- building
`, "utf8");
  writeFileSync(join(root, "docs", "PRD.md"), `# PRD

## Phase 1: Foundation
- Task 1.1: Build a thing
`, "utf8");

  const task: ManifestTask = {
    id: "1.1",
    title: "Build a thing",
    description: "Build a thing",
    ownerAgent: "worker",
    dependencies: [],
    expectedOutputs: [],
    validationCommands: [],
    approvalRequired: false,
    sourceLines: ["- Task 1.1: Build a thing"],
    ...taskOverrides,
  };

  const manifest: ExecutionManifest = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    repoRoot: root,
    harnessRoot: ".agents",
    prdPath: join(root, "docs", "PRD.md"),
    progressPath: join(root, "docs", "PROGRESS.md"),
    auditPath: join(root, "docs", "EXECUTION-AUDIT.jsonl"),
    validationCommands: [],
    approvalGates: { preflight: false, betweenPhases: false },
    phases: [{
      id: "1",
      title: "Foundation",
      description: "",
      ownerAgents: ["worker"],
      dependencies: [],
      approvalRequired: false,
      tasks: [task],
    }],
    warnings: [],
  };

  const manifestPath = join(root, "docs", "EXECUTION-MANIFEST.json");
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
  return { root, manifestPath };
}

function engineOptionsFor(
  fixture: EngineFixture,
  harness: HarnessAdapter,
  taskTimeoutMs: number,
  overrides: Partial<EngineOptions> = {},
) {
  return {
    repoRoot: fixture.root,
    manifestPath: fixture.manifestPath,
    statePath: join(fixture.root, "docs", "WORKFLOW-STATE.json"),
    progressPath: join(fixture.root, "docs", "PROGRESS.md"),
    auditPath: join(fixture.root, "docs", "EXECUTION-AUDIT.jsonl"),
    artifactsPath: join(fixture.root, "docs", "artifacts"),
    controlPath: join(fixture.root, "docs", "engine-control.json"),
    pidPath: join(fixture.root, "docs", "engine.pid"),
    harness,
    maxRetries: 0,
    retryDelayMs: 0,
    heartbeatMs: 0,
    maxConcurrency: 1,
    taskTimeoutMs,
    // These tests target other behaviour (timeout precedence, crash recovery),
    // so the output-verification gate is relaxed unless a test opts into it.
    allowNoop: true,
    runValidation: false,
    pauseRequested: false,
    ...overrides,
  };
}

test("effective task timeout prefers the per-task manifest timeoutMs over the engine default", async () => {
  const fixture = makeEngineFixture({ timeoutMs: 25_000 });
  const harness = new RecordingHarness();
  const state = await runEngine(engineOptionsFor(fixture, harness, 1_000));

  assert.equal(state.status, "complete");
  assert.deepEqual(harness.timeouts, [25_000]);
});

test("effective task timeout falls back to the engine taskTimeoutMs when a task declares none", async () => {
  const fixture = makeEngineFixture();
  const harness = new RecordingHarness();
  const state = await runEngine(engineOptionsFor(fixture, harness, 9_999));

  assert.equal(state.status, "complete");
  assert.deepEqual(harness.timeouts, [9_999]);
});

test("engine forwards maxRetries to the harness invoke call", async () => {
  const fixture = makeEngineFixture();
  const harness = new RecordingHarness();
  const state = await runEngine(engineOptionsFor(fixture, harness, 1_000, { maxRetries: 3 }));

  assert.equal(state.status, "complete");
  assert.deepEqual(harness.retries, [3]);
});

test("manual execution expands dependencies and runs only the selected slice", async () => {
  const fixture = makeEngineFixture();
  const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8")) as ExecutionManifest;
  manifest.phases[0]!.tasks.push({
    id: "1.2",
    title: "Follow-up",
    description: "Depends on 1.1",
    ownerAgent: "worker",
    dependencies: ["1.1"],
    expectedOutputs: [],
    validationCommands: [],
    approvalRequired: false,
    sourceLines: ["- Task 1.2: Follow-up"],
  });
  manifest.phases[0]!.tasks.push({
    id: "1.3",
    title: "Unselected",
    description: "Should stay pending",
    ownerAgent: "worker",
    dependencies: [],
    expectedOutputs: [],
    validationCommands: [],
    approvalRequired: false,
    sourceLines: ["- Task 1.3: Unselected"],
  });
  writeFileSync(fixture.manifestPath, JSON.stringify(manifest), "utf8");

  const harness = new RecordingHarness();
  const state = await runEngine(engineOptionsFor(fixture, harness, 1_000, {
    executionMode: "manual",
    selectionScope: "single",
    selectedTaskIds: ["1.2"],
  }));

  assert.equal(state.status, "complete");
  assert.deepEqual(harness.taskIds, ["1.1", "1.2"]);
  assert.deepEqual(state.selection?.taskIds, ["1.1", "1.2"]);
  assert.equal(state.tasks["1.3"]?.status, "pending");
});

test("manual run can continue with a new selection after a previous selected run completed", async () => {
  const fixture = makeEngineFixture();
  const manifest = JSON.parse(readFileSync(fixture.manifestPath, "utf8")) as ExecutionManifest;
  manifest.phases[0]!.tasks.push({
    id: "1.2",
    title: "Second manual task",
    description: "Should run on the second manual run",
    ownerAgent: "worker",
    dependencies: [],
    expectedOutputs: [],
    validationCommands: [],
    approvalRequired: false,
    sourceLines: ["- Task 1.2: Second manual task"],
  });
  writeFileSync(fixture.manifestPath, JSON.stringify(manifest), "utf8");

  const firstHarness = new RecordingHarness();
  const first = await runEngine(engineOptionsFor(fixture, firstHarness, 1_000, {
    executionMode: "manual",
    selectionScope: "single",
    selectedTaskIds: ["1.1"],
  }));
  assert.equal(first.status, "complete");
  assert.deepEqual(firstHarness.taskIds, ["1.1"]);
  assert.equal(first.tasks["1.2"]?.status, "pending");

  const secondHarness = new RecordingHarness();
  const second = await runEngine(engineOptionsFor(fixture, secondHarness, 1_000, {
    executionMode: "manual",
    selectionScope: "single",
    selectedTaskIds: ["1.2"],
  }));
  assert.equal(second.status, "complete");
  assert.deepEqual(secondHarness.taskIds, ["1.2"]);
  assert.equal(second.tasks["1.1"]?.status, "complete");
  assert.equal(second.tasks["1.2"]?.status, "complete");
});

test("runEngine recovers a leftover 'running' task as pending (crash recovery)", async () => {
  const fixture = makeEngineFixture();
  const statePath = join(fixture.root, "docs", "WORKFLOW-STATE.json");
  // Simulate a run that died mid-task: task 1.1 was persisted as "running".
  const stale: WorkflowState = {
    runId: "crashed-run",
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    manifestPath: fixture.manifestPath,
    manifestVersion: "1.0",
    harness: "recording",
    status: "running",
    tasks: {
      "1.1": {
        taskId: "1.1", status: "running", attempt: 1, outputFiles: [],
        startedAt: new Date().toISOString(),
      },
    },
    blockers: [],
    auditLog: [],
  };
  writeFileSync(statePath, JSON.stringify(stale), "utf8");

  const harness = new RecordingHarness();
  const state = await runEngine(engineOptionsFor(fixture, harness, 1_000));

  assert.equal(state.status, "complete");
  assert.equal(state.tasks["1.1"]?.status, "complete");
  assert.equal(harness.timeouts.length, 1, "the recovered task should actually run, not deadlock");
});

test("a fresh run clears a stale stop request left by a killed engine", async () => {
  const fixture = makeEngineFixture();
  const controlPath = join(fixture.root, "docs", "engine-control.json");
  // Simulate an engine that was SIGKILLed mid-run leaving a stop request behind.
  writeControl(controlPath, "stop");

  const harness = new RecordingHarness();
  const state = await runEngine(engineOptionsFor(fixture, harness, 1_000));

  assert.equal(state.status, "complete", "the stale stop must not halt a fresh run");
  assert.equal(state.tasks["1.1"]?.status, "complete");
  assert.equal(harness.timeouts.length, 1, "the task should actually run");
  assert.equal(readControl(controlPath), null, "the stale control file should be cleared");
});

test("a stop request written mid-run pauses after the current task wave", async () => {
  const fixture = makeEngineFixture({
    dependencies: [],
  });
  // Two sequential tasks so the stop lands between waves.
  const manifestPath = fixture.manifestPath;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExecutionManifest;
  manifest.phases[0]!.tasks.push({
    id: "1.2",
    title: "Build a second thing",
    description: "Build another thing",
    ownerAgent: "worker",
    dependencies: ["1.1"],
    expectedOutputs: [],
    validationCommands: [],
    approvalRequired: false,
    sourceLines: ["- Task 1.2: Build a second thing"],
  });
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

  const controlPath = join(fixture.root, "docs", "engine-control.json");
  // Block the first task until the control file has been written, so the stop
  // arrives mid-run (while task 1.1 is executing) rather than before any task.
  let release: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const harness = new GatedHarness(() => {
    if (!readControl(controlPath)) writeControl(controlPath, "stop");
    release();
  });

  const runPromise = runEngine(engineOptionsFor(fixture, harness, 1_000));
  await gate;
  writeControl(controlPath, "stop");
  harness.releaseNow();
  const state = await runPromise;

  assert.equal(state.status, "paused");
  assert.equal(state.tasks["1.1"]?.status, "complete", "the in-flight task finishes before pausing");
  assert.equal(state.tasks["1.2"]?.status, "pending", "the second task must not start after the stop");
  assert.equal(readControl(controlPath), null);
});

test("the in-process stopRequested flag pauses the run (SIGINT/SIGTERM path)", async () => {
  const fixture = makeEngineFixture();
  const harness = new RecordingHarness();
  const opts = engineOptionsFor(fixture, harness, 1_000);
  opts.stopRequested = () => true;

  const state = await runEngine(opts);

  assert.equal(state.status, "paused");
  assert.equal(state.tasks["1.1"]?.status, "pending");
  assert.equal(harness.timeouts.length, 0);
});

test("a stop during a wave leaves same-wave siblings pending (per-task check)", async () => {
  const fixture = makeEngineFixture({
    dependencies: [],
  });
  // Two independent tasks: both are ready in the SAME wave. The stop arrives
  // while 1.1 runs; 1.2 must not start, even though it shares the wave.
  const manifestPath = fixture.manifestPath;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExecutionManifest;
  manifest.phases[0]!.tasks.push({
    id: "1.2",
    title: "Build a second thing",
    description: "Build another thing",
    ownerAgent: "worker",
    dependencies: [],
    expectedOutputs: [],
    validationCommands: [],
    approvalRequired: false,
    sourceLines: ["- Task 1.2: Build a second thing"],
  });
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

  const controlPath = join(fixture.root, "docs", "engine-control.json");
  let release: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const harness = new GatedHarness(() => {
    if (!readControl(controlPath)) writeControl(controlPath, "stop");
    release();
  });

  const runPromise = runEngine(engineOptionsFor(fixture, harness, 1_000, { maxConcurrency: 1 }));
  await gate;
  harness.releaseNow();
  const state = await runPromise;

  assert.equal(state.status, "paused");
  assert.equal(state.tasks["1.1"]?.status, "complete");
  assert.equal(state.tasks["1.2"]?.status, "pending", "the same-wave sibling must not start after the stop");
  assert.equal(readControl(controlPath), null);
});

test("runCommand kills a child that exceeds a custom timeout and reports it", async () => {
  const start = Date.now();
  const result = await runCommand(
    process.execPath,
    ["-e", "setTimeout(() => {}, 10_000)"],
    { cwd: tmpdir(), timeoutMs: 150, maxBufferBytes: 1024 },
  );

  assert.equal(result.status, null);
  assert.match(result.error ?? "", /timed out after 150ms/);
  assert.ok(Date.now() - start < 5_000, "runCommand should not wait for the child's own sleep");
});

// ─── Output verification gate ────────────────────────────────────────────────

/** A harness that always "succeeds" without producing files or real output. */
class HollowHarness implements HarnessAdapter {
  readonly name = "hollow";
  readonly supportsConcurrency = false;
  readonly stdout: string;

  constructor(stdout = "Ready for the task.") {
    this.stdout = stdout;
  }

  async invoke(
    _agent: Parameters<HarnessAdapter["invoke"]>[0],
    _task: ManifestTask,
    _context: WorkflowState,
    _repoRoot: string,
    _contextBlock?: string,
    _timeoutMs?: number,
  ) {
    return {
      success: true,
      outputFiles: [],
      stdout: this.stdout,
      stderr: "",
      durationMs: 1,
    };
  }
}

/** A harness that writes a file into the repo, so a git diff detects the work. */
class FileWritingHarness implements HarnessAdapter {
  readonly name = "file-writing";
  readonly supportsConcurrency = false;

  async invoke(
    _agent: Parameters<HarnessAdapter["invoke"]>[0],
    _task: ManifestTask,
    _context: WorkflowState,
    repoRoot: string,
    _contextBlock?: string,
    _timeoutMs?: number,
  ) {
    mkdirSync(join(repoRoot, "src"), { recursive: true });
    writeFileSync(join(repoRoot, "src", "thing.ts"), "export const thing = 1;\n", "utf8");
    return {
      success: true,
      outputFiles: ["src/thing.ts"],
      stdout: "[file-writing] wrote src/thing.ts",
      stderr: "",
      durationMs: 1,
    };
  }
}

/** A harness that edits an already tracked file without reporting outputFiles. */
class TrackedFileEditingHarness implements HarnessAdapter {
  readonly name = "tracked-file-editing";
  readonly supportsConcurrency = false;

  async invoke(
    _agent: Parameters<HarnessAdapter["invoke"]>[0],
    _task: ManifestTask,
    _context: WorkflowState,
    repoRoot: string,
  ) {
    writeFileSync(join(repoRoot, "src", "thing.ts"), "export const thing = 2;\n", "utf8");
    return {
      success: true,
      outputFiles: [],
      stdout: "Ready for the task.",
      stderr: "",
      durationMs: 1,
    };
  }
}

function initGit(root: string): void {
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "forge-test@local"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Forge Test"], { cwd: root });
}

test("output gate: a task whose expectedOutputs are missing is marked failed, not complete", async () => {
  const fixture = makeEngineFixture({ expectedOutputs: ["src/out.ts"] });
  const harness = new HollowHarness();
  const state = await runEngine(engineOptionsFor(fixture, harness, 1_000, { allowNoop: false }));

  assert.equal(state.status, "failed");
  assert.equal(state.tasks["1.1"]?.status, "failed");
  assert.match(state.tasks["1.1"]?.errorMessage ?? "", /expected outputs missing: src\/out\.ts/);
});

test("output gate: a no-op task (no changes, trivial output) is marked failed", async () => {
  const fixture = makeEngineFixture();
  const harness = new HollowHarness("Ready for the task.");
  const state = await runEngine(engineOptionsFor(fixture, harness, 1_000, { allowNoop: false }));

  assert.equal(state.status, "failed");
  assert.equal(state.tasks["1.1"]?.status, "failed");
  assert.match(state.tasks["1.1"]?.errorMessage ?? "", /produced no changes and no substantive output/);
});

test("output gate: --allow-noop relaxes the no-op heuristic", async () => {
  const fixture = makeEngineFixture();
  const harness = new HollowHarness("Ready for the task.");
  const state = await runEngine(engineOptionsFor(fixture, harness, 1_000, { allowNoop: true }));

  assert.equal(state.status, "complete");
  assert.equal(state.tasks["1.1"]?.status, "complete");
});

test("output gate: --allow-noop still records tracked files changed during the task", async () => {
  const fixture = makeEngineFixture();
  initGit(fixture.root);
  mkdirSync(join(fixture.root, "src"), { recursive: true });
  writeFileSync(join(fixture.root, "src", "thing.ts"), "export const thing = 1;\n", "utf8");
  execFileSync("git", ["add", "src/thing.ts"], { cwd: fixture.root });
  execFileSync("git", ["commit", "-qm", "seed tracked file"], { cwd: fixture.root });

  const harness = new TrackedFileEditingHarness();
  const state = await runEngine(engineOptionsFor(fixture, harness, 1_000, { allowNoop: true, autoCommit: false }));

  assert.equal(state.status, "complete");
  assert.equal(state.tasks["1.1"]?.status, "complete");
  assert.deepEqual(state.tasks["1.1"]?.outputFiles, ["src/thing.ts"]);
});

test("output gate: a substantive agent response passes the no-op heuristic", async () => {
  const fixture = makeEngineFixture();
  const substantive = [
    "Implemented the task end to end.",
    "src/foo.ts: added the scanner; test/foo.test.ts: added unit coverage;",
    "typecheck passes, all 42 tests green. This is a long response.",
  ].join("\n");
  const harness = new HollowHarness(substantive);
  const state = await runEngine(engineOptionsFor(fixture, harness, 1_000, { allowNoop: false }));

  assert.equal(state.status, "complete");
  assert.equal(state.tasks["1.1"]?.status, "complete");
});

test("output gate: a file change detected via git diff passes, even with trivial output", async () => {
  const fixture = makeEngineFixture();
  initGit(fixture.root);
  const harness = new FileWritingHarness();
  const state = await runEngine(engineOptionsFor(fixture, harness, 1_000, { allowNoop: false }));

  assert.equal(state.status, "complete");
  assert.equal(state.tasks["1.1"]?.status, "complete");
});

test("auto-commit (default on) commits one commit per completed task and records task.committed", async () => {
  const fixture = makeEngineFixture();
  initGit(fixture.root);
  const manifestPath = fixture.manifestPath;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExecutionManifest;
  manifest.phases[0]!.tasks.push({
    id: "1.2",
    title: "Build a second thing",
    description: "Build another thing",
    ownerAgent: "worker",
    dependencies: ["1.1"],
    expectedOutputs: [],
    validationCommands: [],
    approvalRequired: false,
    sourceLines: ["- Task 1.2: Build a second thing"],
  });
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

  const harness = new FileWritingHarness();
  const state = await runEngine(engineOptionsFor(fixture, harness, 1_000));

  assert.equal(state.status, "complete");
  const log = execFileSync("git", ["log", "--oneline"], { cwd: fixture.root, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  assert.equal(log.length, 2, "one commit per completed task");
  assert.match(log[0]!, /complete task 1\.2/);
  assert.match(log[1]!, /complete task 1\.1/);

  const audit = readFileSync(join(fixture.root, "docs", "EXECUTION-AUDIT.jsonl"), "utf8");
  assert.match(audit, /"action":"task\.committed"/);
  assert.match(audit, /"commitSha":"[0-9a-f]{40}"/);
});

test("auto-commit disabled (autoCommit: false) leaves the working tree uncommitted", async () => {
  const fixture = makeEngineFixture();
  initGit(fixture.root);
  const harness = new FileWritingHarness();
  const state = await runEngine(engineOptionsFor(fixture, harness, 1_000, { autoCommit: false }));

  assert.equal(state.status, "complete");
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: fixture.root, encoding: "utf8" });
  assert.match(status, /src\/thing\.ts/, "task work should remain uncommitted");
  const audit = readFileSync(join(fixture.root, "docs", "EXECUTION-AUDIT.jsonl"), "utf8");
  assert.doesNotMatch(audit, /"action":"task\.committed"/);
});

test("replayTask auto-commits a replayed task's work by default", async () => {
  const fixture = makeEngineFixture({ expectedOutputs: ["src/thing.ts"] });
  initGit(fixture.root);
  const hollow = new HollowHarness();
  const failed = await runEngine(engineOptionsFor(fixture, hollow, 1_000, { allowNoop: false }));
  assert.equal(failed.status, "failed");
  assert.equal(failed.tasks["1.1"]?.status, "failed");

  const writing = new FileWritingHarness();
  const state = await replayTask("1.1", engineOptionsFor(fixture, writing, 1_000, { allowNoop: false }));

  assert.equal(state.tasks["1.1"]?.status, "complete");
  const log = execFileSync("git", ["log", "--oneline"], { cwd: fixture.root, encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
  assert.equal(log.length, 1, "the replayed task should produce one commit");
  assert.match(log[0]!, /complete task 1\.1/);
});

test("output gate: a failing manifest validation command marks the task failed", async () => {
  const fixture = makeEngineFixture({ validationCommands: ["exit 1"] });
  const harness = new HollowHarness();
  const state = await runEngine(engineOptionsFor(fixture, harness, 1_000, { allowNoop: false, runValidation: true }));

  assert.equal(state.status, "failed");
  assert.equal(state.tasks["1.1"]?.status, "failed");
  assert.match(state.tasks["1.1"]?.errorMessage ?? "", /validation command failed/);
});

test("output gate: a passing manifest validation command allows completion", async () => {
  const fixture = makeEngineFixture({ validationCommands: ["true"] });
  const harness = new HollowHarness();
  const state = await runEngine(engineOptionsFor(fixture, harness, 1_000, { allowNoop: false, runValidation: true }));

  assert.equal(state.status, "complete");
  assert.equal(state.tasks["1.1"]?.status, "complete");
});

test("same-owner ready tasks run in separate waves (serialized) even with concurrency 2", async () => {
  const fixture = makeEngineFixture();
  const manifestPath = fixture.manifestPath;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExecutionManifest;
  manifest.phases[0]!.ownerAgents = ["worker"];
  manifest.phases[0]!.tasks.push({
    id: "1.2",
    title: "Build a second thing",
    description: "Build another thing",
    ownerAgent: "worker",
    dependencies: [],
    expectedOutputs: [],
    validationCommands: [],
    approvalRequired: false,
    sourceLines: ["- Task 1.2: Build a second thing"],
  });
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

  const harness = new GatedConcurrentHarness();
  const runPromise = runEngine(engineOptionsFor(fixture, harness, 1_000, { maxConcurrency: 2 }));

  // Task 1.1 starts; its same-owner sibling must NOT start in the same wave.
  await harness.whenStarted("1.1");
  assert.deepEqual(harness.startedOrder, ["1.1"], "only 1.1 should start in wave 1");
  harness.release("1.1");

  // After 1.1 drains, 1.2 runs in a later wave.
  await harness.whenStarted("1.2");
  assert.deepEqual(harness.startedOrder, ["1.1", "1.2"]);
  harness.release("1.2");

  const state = await runPromise;
  assert.equal(state.status, "complete");
  assert.equal(state.tasks["1.1"]?.status, "complete");
  assert.equal(state.tasks["1.2"]?.status, "complete");
  assert.ok(harness.maxOverlap <= 1, `same-owner tasks must never overlap (saw max ${harness.maxOverlap})`);
});

test("different-owner ready tasks are serialized while using repository-wide output attribution", async () => {
  const fixture = makeEngineFixture();
  writeFileSync(join(fixture.root, ".agents", "agents", "designer.md"), `---
name: designer
description: Designs things.
---

## Expertise
- designing
`, "utf8");
  const manifestPath = fixture.manifestPath;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExecutionManifest;
  manifest.phases[0]!.ownerAgents = ["worker", "designer"];
  manifest.phases[0]!.tasks.push({
    id: "1.2",
    title: "Design a second thing",
    description: "Design another thing",
    ownerAgent: "designer",
    dependencies: [],
    expectedOutputs: [],
    validationCommands: [],
    approvalRequired: false,
    sourceLines: ["- Task 1.2: Design a second thing"],
  });
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

  const harness = new GatedConcurrentHarness();
  const runPromise = runEngine(engineOptionsFor(fixture, harness, 1_000, { maxConcurrency: 2 }));

  // Different-owner tasks are still serialized because output attribution
  // currently relies on repository-wide snapshots.
  await harness.whenStarted("1.1");
  harness.release("1.1");
  await harness.whenStarted("1.2");
  assert.deepEqual(harness.startedOrder, ["1.1", "1.2"]);
  assert.ok(harness.maxOverlap <= 1, `tasks should not overlap (saw max ${harness.maxOverlap})`);
  harness.release("1.2");

  const state = await runPromise;
  assert.equal(state.status, "complete");
  assert.equal(state.tasks["1.1"]?.status, "complete");
  assert.equal(state.tasks["1.2"]?.status, "complete");
});
