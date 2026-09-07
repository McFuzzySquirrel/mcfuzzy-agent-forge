import assert from "node:assert/strict";
import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executionPrompt, TASK_EXECUTION_DIR, writeTaskAttempt } from "./task-execution.ts";
import { prepareTaskRequest } from "./request.ts";
import type { AgentDescriptor, ManifestTask } from "./types.ts";
import { CopilotAdapter } from "./harness/copilot-adapter.ts";
import { OpenCodeAdapter } from "./harness/opencode-adapter.ts";
import { ClaudeAdapter } from "./harness/claude-adapter.ts";

const agent: AgentDescriptor = { name: "worker", path: "worker.md", rawBody: "Specialist rules", description: "Worker", constraints: [], expertise: [], collaboration: [] };
const task: ManifestTask = { id: "TASK-1", title: "Bounded behavior", description: "Implement the behavior", dependencies: [], expectedOutputs: ["result.txt"], validationCommands: ["npm test"], approvalRequired: false, sourceLines: [] };

test("large requests reuse a task-ID execution file with current attempt instructions", (context) => {
  const root = mkdtempSync(join(tmpdir(), "forge execution "));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const request = prepareTaskRequest({ agent, task, repoRoot: root, runId: "run-1", attempt: 2, contextBlock: "Dependency result. ".repeat(5000) });
  const persona = "Specialist rule. ".repeat(5000);
  const first = executionPrompt(request, persona);
  const nextRequest = prepareTaskRequest({ agent, task, repoRoot: root, runId: "run-1", attempt: 3, previousFailure: "Required check failed" });
  const second = executionPrompt(nextRequest, persona);
  assert.ok(first.length < 1000);
  assert.equal(first, second);
  assert.ok(first.includes('"docs/artifacts/TASK-1.md"'));
  assert.ok(!first.includes("Dependency result."));
  const files = readdirSync(join(root, TASK_EXECUTION_DIR));
  assert.deepEqual(files, ["TASK-1.md"]);
  for (const file of files) {
    const content = readFileSync(join(root, TASK_EXECUTION_DIR, file), "utf8");
    for (const required of [persona, nextRequest.instructions, '"runId":"run-1"', '"attempt":3', "Required check failed"]) assert.ok(content.includes(required));
  }
});

test("results share the task ID and retain timestamped archives even on timestamp collisions", (context) => {
  const root = mkdtempSync(join(tmpdir(), "forge results "));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-07T17:00:00.000Z") });
  const evidence = { runId: "run-1", taskId: "WALK-1", attempt: 1, outcome: "failed" as const, result: { success: true, outputFiles: [], stdout: "first", stderr: "", durationMs: 1 }, gates: [] };
  const first = writeTaskAttempt(root, evidence);
  const second = writeTaskAttempt(root, { ...evidence, result: { ...evidence.result, stdout: "second" } });
  assert.notEqual(first, second);
  assert.match(first, /WALK-1\.2026-09-07T17-00-00-000Z\.attempt-1\.result\.json$/);
  assert.equal(JSON.parse(readFileSync(join(root, first), "utf8")).result.stdout, "first");
  const latest = readFileSync(join(root, TASK_EXECUTION_DIR, "WALK-1.result.json"), "utf8");
  assert.equal(latest, readFileSync(join(root, second), "utf8"));
  assert.equal(JSON.parse(latest).result.stdout, "second");
});

test("unsafe and case-distinct task IDs get bounded collision-resistant filenames", (context) => {
  const root = mkdtempSync(join(tmpdir(), "forge task ids "));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const names = new Set<string>();
  for (const id of ["../escape", "..\\escape", "CON", "NUL.txt", "TASK-1", "task-1", "Task-1", "TASK-1.", "x".repeat(500)]) {
    const prompt = executionPrompt(prepareTaskRequest({ agent, task: { ...task, id }, repoRoot: root }));
    const path = prompt.match(/execution file "([^"]+)"/)![1]!;
    const name = path.slice(TASK_EXECUTION_DIR.length + 1);
    assert.ok(!name.includes("/"));
    assert.ok(!name.includes("\\"));
    assert.ok(name.length < 100);
    assert.ok(!names.has(name.toLowerCase()));
    names.add(name.toLowerCase());
    const resultPath = writeTaskAttempt(root, { runId: "run", taskId: id, attempt: 1, outcome: "passed", result: { success: true, stdout: "done", stderr: "", outputFiles: [], durationMs: 1 }, gates: [] });
    assert.ok(resultPath.startsWith(`${TASK_EXECUTION_DIR}/${name.slice(0, -3)}.`));
  }
});

test("stable execution and result files refuse hard links without changing outside files", (context) => {
  const root = mkdtempSync(join(tmpdir(), "forge linked file "));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, TASK_EXECUTION_DIR), { recursive: true });
  const outside = join(root, "outside.txt");
  writeFileSync(outside, "untouched");
  linkSync(outside, join(root, TASK_EXECUTION_DIR, "TASK-1.md"));
  linkSync(outside, join(root, TASK_EXECUTION_DIR, "TASK-1.result.json"));
  assert.throws(() => executionPrompt(prepareTaskRequest({ agent, task, repoRoot: root })), /regular unlinked/);
  assert.throws(() => writeTaskAttempt(root, { runId: "run", taskId: task.id, attempt: 1, outcome: "failed", result: { success: false, stdout: "", stderr: "", outputFiles: [], durationMs: 1 }, gates: [] }), /regular unlinked/);
  assert.equal(readFileSync(outside, "utf8"), "untouched");
});

test("text-only requests remain inline and cancellation writes no execution files", (context) => {
  const root = mkdtempSync(join(tmpdir(), "forge execution "));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const request = prepareTaskRequest({ agent, task: { ...task, requiredCapabilities: ["text"] }, repoRoot: root });
  assert.equal(executionPrompt(request, "Persona"), `Persona\n\n${request.instructions}`);
  assert.throws(() => executionPrompt({ ...request, signal: AbortSignal.abort() }), /abort/i);
  assert.deepEqual(readdirSync(root), []);
});

test("execution snapshot paths cannot be declared as task outputs", (context) => {
  const root = mkdtempSync(join(tmpdir(), "forge execution "));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of ["docs/artifacts/fake.md", "docs/../docs/artifacts/fake.md", "docs/task-executions/fake.md", "docs/../docs/task-executions/fake.md"]) {
    const request = prepareTaskRequest({ agent, task: { ...task, expectedOutputs: [file] }, repoRoot: root });
    assert.throws(() => executionPrompt(request), /engine-owned/);
  }
});

test("linked execution directories and human-review requests fail before writing", (context) => {
  const root = mkdtempSync(join(tmpdir(), "forge execution boundary "));
  const outside = mkdtempSync(join(tmpdir(), "forge execution outside "));
  context.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
  const request = prepareTaskRequest({ agent, task, repoRoot: root });
  assert.throws(() => executionPrompt({ ...request, task: { ...task, contract: { version: 1, kind: "human-review", requirements: [], acceptanceCriteria: [], constraints: [], references: [], reviewFile: "review.json" } } }), /Human review/);
  assert.deepEqual(readdirSync(root), []);
  mkdirSync(join(root, "docs"));
  symlinkSync(outside, join(root, TASK_EXECUTION_DIR), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => executionPrompt(request), /regular repository directory/);
  assert.throws(() => writeTaskAttempt(root, { runId: "run", taskId: "task", attempt: 1, outcome: "failed", result: { success: false, stdout: "diagnostic", stderr: "failure", outputFiles: [], durationMs: 1 }, gates: [] }), /regular repository directory/);
  assert.deepEqual(readdirSync(outside), []);
});

test("Windows BAT wrappers load large task snapshots using bounded argv", { skip: process.platform !== "win32" }, async (context) => {
  const root = mkdtempSync(join(tmpdir(), "forge bat execution "));
  const environment = { ...process.env };
  context.after(() => { process.env = environment; rmSync(root, { recursive: true, force: true }); });
  const script = join(root, "record.cjs");
  const bin = join(root, "record.BAT");
  writeFileSync(script, `
const fs = require("node:fs");
const args = process.argv.slice(2);
const prompt = args.includes("-p") ? args[args.indexOf("-p") + 1] : args.at(-1);
const file = prompt.match(/execution file "([^"]+)"/)?.[1];
if (!file) throw new Error("No execution file in prompt: " + prompt);
const content = fs.readFileSync(file, "utf8");
if (!content.includes("Mandatory criterion")) throw new Error("Lost task criterion");
fs.writeFileSync("recorded.json", JSON.stringify({args, content}));
process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: "Completed task" }));
`);
  writeFileSync(bin, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
  process.env.COPILOT_BIN = bin;
  process.env.OPENCODE_BIN = bin;
  process.env.CLAUDE_BIN = bin;
  delete process.env.COPILOT_EXTRA_FLAGS;
  delete process.env.OPENCODE_EXTRA_FLAGS;
  delete process.env.CLAUDE_EXTRA_FLAGS;
  delete process.env.FORGE_ENGINE_NATIVE_AGENT;
  writeFileSync(join(root, "architecture.md"), "Reference details. ".repeat(5000));
  const structured: ManifestTask = { ...task, ownerAgent: agent.name, contract: {
    version: 1, kind: "implementation", requirements: ["Mandatory requirement"], acceptanceCriteria: ["Mandatory criterion"], constraints: ["Mandatory safety constraint"], references: ["architecture.md"],
  } };
  for (const adapter of [new CopilotAdapter(), new OpenCodeAdapter(), new ClaudeAdapter()]) {
    for (const native of [false, true]) {
      const harnessRoot = adapter.name === "copilot" ? ".github" : adapter.name === "claude" ? ".claude" : ".opencode";
      const agentPath = join(root, native ? harnessRoot : ".agents", "agents", "worker.md");
      mkdirSync(join(root, native ? harnessRoot : ".agents", "agents"), { recursive: true });
      const request = prepareTaskRequest({ agent: { ...agent, path: agentPath, rawBody: "Long specialist persona. ".repeat(4000) }, task: structured, repoRoot: root });
      const result = await adapter.invoke(request);
      assert.equal(result.success, true, `${adapter.name} native=${native}: ${result.errorMessage}`);
      const record = JSON.parse(readFileSync(join(root, "recorded.json"), "utf8"));
      assert.ok(JSON.stringify(record.args).length < 2000);
      assert.ok(record.content.includes("architecture.md"));
      assert.ok(!record.content.includes("Reference details."));
      assert.equal(record.content.includes("Long specialist persona."), !native);
    }
  }
});