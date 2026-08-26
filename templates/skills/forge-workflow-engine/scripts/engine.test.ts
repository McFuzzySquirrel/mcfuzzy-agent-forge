import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { allDepsComplete, isComplete, isTaskDone, mapLimit, nextReadyTasks, runEngine } from "./engine.ts";
import { runCommand } from "./harness/run.ts";
import type { ExecutionManifest, HarnessAdapter, ManifestTask, TaskStatus, WorkflowState } from "./types.ts";

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

  async invoke(
    _agent: Parameters<HarnessAdapter["invoke"]>[0],
    _task: ManifestTask,
    _context: WorkflowState,
    _repoRoot: string,
    _contextBlock?: string,
    timeoutMs?: number,
  ) {
    this.timeouts.push(timeoutMs ?? -1);
    return {
      success: true,
      outputFiles: [],
      stdout: "[recording] ok",
      stderr: "",
      durationMs: 1,
    };
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

function engineOptionsFor(fixture: EngineFixture, harness: HarnessAdapter, taskTimeoutMs: number) {
  return {
    repoRoot: fixture.root,
    manifestPath: fixture.manifestPath,
    statePath: join(fixture.root, "docs", "WORKFLOW-STATE.json"),
    progressPath: join(fixture.root, "docs", "PROGRESS.md"),
    auditPath: join(fixture.root, "docs", "EXECUTION-AUDIT.jsonl"),
    artifactsPath: join(fixture.root, "docs", "artifacts"),
    harness,
    maxRetries: 0,
    retryDelayMs: 0,
    heartbeatMs: 0,
    maxConcurrency: 1,
    taskTimeoutMs,
    pauseRequested: false,
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
