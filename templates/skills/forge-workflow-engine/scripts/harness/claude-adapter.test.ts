import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ClaudeAdapter } from "./claude-adapter.ts";
import type { AgentDescriptor, ManifestTask, TaskResult } from "../types.ts";
import { prepareTaskRequest } from "../request.ts";
import { makeNodeShim } from "../test-support.ts";

const SUCCESS_ENVELOPE =
  '{"type":"result","subtype":"success","is_error":false,"result":"Substantive completed text response.","permission_denials":[],"session_id":"00000000-0000-4000-8000-000000000000"}';

interface Shim {
  bin: string;
  argsFile: string;
}

/**
 * Records argv, then replays CLAUDE_SHIM_STDOUT / CLAUDE_SHIM_STDERR /
 * CLAUDE_SHIM_EXIT so each test drives a real child process. Writes are
 * synchronous so nothing is lost to the pipe when the shim exits.
 */
function makeShim(): Shim {
  const dir = mkdtempSync(join(tmpdir(), "forge-claude-adapter-"));
  const argsFile = join(dir, "args.json");
  const bin = makeNodeShim(dir, "fake-claude", `
const fs = require("fs");
fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
fs.writeSync(1, process.env.CLAUDE_SHIM_STDOUT ?? ${JSON.stringify(SUCCESS_ENVELOPE)});
if (process.env.CLAUDE_SHIM_STDERR) fs.writeSync(2, process.env.CLAUDE_SHIM_STDERR);
process.exit(Number(process.env.CLAUDE_SHIM_EXIT ?? 0));
`,
  );
  return { bin, argsFile };
}

function makeTask(overrides: Partial<ManifestTask> = {}): ManifestTask {
  return {
    id: "t1",
    title: "Build the scanner",
    description: "Implement the recursive scanner.",
    dependencies: [],
    expectedOutputs: ["src/discovery/scanner.ts"],
    validationCommands: ["npm run typecheck"],
    approvalRequired: false,
    sourceLines: [],
    ...overrides,
  };
}

function makeAgent(path: string): AgentDescriptor {
  return {
    name: "discovery-engineer",
    description: "Discovery engineer",
    path,
    expertise: [],
    collaboration: [],
    constraints: [],
    rawBody: "You are a Discovery Engineer.\n- scan repos read-only",
  };
}

function makeRepo(): string {
  return mkdtempSync(join(tmpdir(), "forge-claude-repo-"));
}

function agentIn(root: string, harnessRoot: string): AgentDescriptor {
  return makeAgent(join(root, harnessRoot, "agents", "discovery-engineer.md"));
}

function makeAdapter(shim: Shim): ClaudeAdapter {
  process.env.CLAUDE_BIN = shim.bin;
  return new ClaudeAdapter();
}

interface InvokeOptions {
  task?: ManifestTask;
  timeoutMs?: number;
  maxRetries?: number;
}

async function invoke(shim: Shim, agent: AgentDescriptor, root: string, options: InvokeOptions = {}): Promise<TaskResult> {
  const adapter = makeAdapter(shim);
  return adapter.invoke(prepareTaskRequest({
    agent,
    task: options.task ?? makeTask(),
    repoRoot: root,
    defaultModel: adapter.defaultModel,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
  }));
}

function recordedArgs(shim: Shim): string[] {
  return JSON.parse(readFileSync(shim.argsFile, "utf8")) as string[];
}

function recordedPrompt(shim: Shim): string {
  const recorded = recordedArgs(shim);
  return recorded[recorded.indexOf("-p") + 1] ?? "";
}

/** Envelope on stdout for the next shim run. */
function stubEnvelope(envelope: Record<string, unknown>): void {
  process.env.CLAUDE_SHIM_STDOUT = JSON.stringify(envelope);
}

let savedEnv: NodeJS.ProcessEnv = {};
const originalLog = console.log;
const logged: string[] = [];

beforeEach(() => {
  savedEnv = { ...process.env };
  logged.length = 0;
  console.log = (...parts: unknown[]) => {
    logged.push(parts.map(String).join(" "));
  };
});

afterEach(() => {
  console.log = originalLog;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});

test("passes --agent for .claude-rooted agents and omits the inline persona", async () => {
  const root = makeRepo();
  const shim = makeShim();

  const result = await invoke(shim, agentIn(root, ".claude"), root);

  assert.equal(result.success, true);
  const args = recordedArgs(shim);
  assert.equal(args[args.indexOf("--agent") + 1], "discovery-engineer");
  assert.ok(!recordedPrompt(shim).includes("You are a Discovery Engineer"), recordedPrompt(shim));
});

test("falls back to inlining the persona for non-.claude harness roots", async () => {
  for (const harnessRoot of [".github", ".opencode", ".agents"]) {
    const root = makeRepo();
    const shim = makeShim();

    const result = await invoke(shim, agentIn(root, harnessRoot), root);

    assert.equal(result.success, true);
    assert.ok(!recordedArgs(shim).includes("--agent"), harnessRoot);
    assert.ok(recordedPrompt(shim).includes("You are a Discovery Engineer"), harnessRoot);
  }
});

test("never passes --agent when the agent has no name", async () => {
  const root = makeRepo();
  const shim = makeShim();
  const agent = { ...agentIn(root, ".claude"), name: "" };

  await invoke(shim, agent, root);

  assert.ok(!recordedArgs(shim).includes("--agent"));
  assert.ok(recordedPrompt(shim).includes("You are a Discovery Engineer"));
});

test("FORGE_ENGINE_NATIVE_AGENT=0 forces the inline-persona fallback for .claude agents", async () => {
  const root = makeRepo();
  const shim = makeShim();
  process.env.FORGE_ENGINE_NATIVE_AGENT = "0";

  await invoke(shim, agentIn(root, ".claude"), root);

  assert.ok(!recordedArgs(shim).includes("--agent"));
  assert.ok(recordedPrompt(shim).includes("You are a Discovery Engineer"));
});

test("prompt carries the execute-now directive and the budget in both native and inline modes", async () => {
  for (const harnessRoot of [".claude", ".agents"]) {
    const root = makeRepo();
    const shim = makeShim();

    await invoke(shim, agentIn(root, harnessRoot), root, { timeoutMs: 30_000, maxRetries: 3 });

    const prompt = recordedPrompt(shim);
    assert.ok(prompt.includes("Perform the task now"), prompt);
    assert.ok(prompt.includes("Per-task timeout: 30s"), prompt);
    assert.ok(prompt.includes("retried up to 3 time(s)"), prompt);
  }
});

test("strips the provider prefix from the model before passing --model", async () => {
  const root = makeRepo();
  const shim = makeShim();

  await invoke(shim, agentIn(root, ".claude"), root, { task: makeTask({ model: "anthropic/claude-sonnet-5" }) });

  const args = recordedArgs(shim);
  assert.equal(args[args.indexOf("--model") + 1], "claude-sonnet-5");
});

test("always passes JSON output and bypassPermissions, and folds CLAUDE_EXTRA_FLAGS in once", async () => {
  const root = makeRepo();
  const shim = makeShim();
  process.env.CLAUDE_EXTRA_FLAGS = "--model opus --bare";
  const adapter = makeAdapter(shim);

  assert.equal(adapter.defaultModel, "opus");
  const result = await adapter.invoke(prepareTaskRequest({
    agent: agentIn(root, ".claude"), task: makeTask(), repoRoot: root, defaultModel: adapter.defaultModel,
  }));
  assert.equal(result.success, true);

  const args = recordedArgs(shim);
  assert.equal(args[args.indexOf("--output-format") + 1], "json");
  assert.equal(args[args.indexOf("--permission-mode") + 1], "bypassPermissions");
  assert.ok(args.includes("--bare"));
  assert.equal(args.filter((arg) => arg === "--model").length, 1);
  assert.equal(args[args.indexOf("--model") + 1], "opus");
});

test("success envelope yields the result text, existing output files, and a session log line", async () => {
  const root = makeRepo();
  const shim = makeShim();
  const scanner = join(root, "src", "discovery", "scanner.ts");
  mkdirSync(dirname(scanner), { recursive: true });
  writeFileSync(scanner, "export const scan = () => [];\n");

  const result = await invoke(shim, agentIn(root, ".claude"), root, {
    task: makeTask({ expectedOutputs: ["src/discovery/scanner.ts", "docs/never-written.md"] }),
  });

  assert.equal(result.success, true);
  assert.equal(result.stdout, "Substantive completed text response.");
  assert.deepEqual(result.outputFiles, ["src/discovery/scanner.ts"]);
  assert.ok(
    logged.some((line) => line.includes("[engine] claude session 00000000-0000-4000-8000-000000000000") && line.includes("t1")),
    logged.join("\n"),
  );
});

test("a not-logged-in error envelope is a configuration failure", async () => {
  const root = makeRepo();
  const shim = makeShim();
  stubEnvelope({ type: "result", subtype: "success", is_error: true, result: "Not logged in · Please run /login", session_id: "s1" });

  const result = await invoke(shim, agentIn(root, ".claude"), root);

  assert.equal(result.success, false);
  assert.equal(result.failureKind, "configuration");
  assert.equal(result.errorMessage, "Not logged in · Please run /login");
});

test("api_error_status decides between retryable and configuration", async () => {
  const cases: Array<{ status: number; kind: string }> = [
    { status: 429, kind: "retryable" },
    { status: 403, kind: "configuration" },
    { status: 503, kind: "retryable" },
  ];
  for (const { status, kind } of cases) {
    const root = makeRepo();
    const shim = makeShim();
    stubEnvelope({
      type: "result", subtype: "error_during_execution", is_error: true,
      terminal_reason: "api_error", api_error_status: status, result: `API error ${status}`,
    });

    const result = await invoke(shim, agentIn(root, ".claude"), root);

    assert.equal(result.success, false, String(status));
    assert.equal(result.failureKind, kind, String(status));
  }
});

test("error_during_execution without an API status is retryable", async () => {
  const root = makeRepo();
  const shim = makeShim();
  stubEnvelope({ type: "result", subtype: "error_during_execution", is_error: true, terminal_reason: "api_error", api_error_status: null, result: "" });

  const result = await invoke(shim, agentIn(root, ".claude"), root);

  assert.equal(result.success, false);
  assert.equal(result.failureKind, "retryable");
  assert.equal(result.errorMessage, "claude error_during_execution (api_error)");
});

test("error_max_turns is a configuration failure", async () => {
  const root = makeRepo();
  const shim = makeShim();
  stubEnvelope({ type: "result", subtype: "error_max_turns", is_error: true, terminal_reason: "max_turns" });

  const result = await invoke(shim, agentIn(root, ".claude"), root);

  assert.equal(result.success, false);
  assert.equal(result.failureKind, "configuration");
  assert.equal(result.errorMessage, "claude error_max_turns (max_turns)");
});

test("permission denials under bypassPermissions are a configuration failure naming every tool", async () => {
  const root = makeRepo();
  const shim = makeShim();
  stubEnvelope({
    type: "result", subtype: "success", is_error: false, result: "done",
    permission_denials: [{ tool_name: "Write" }, { tool_name: "Bash" }, { tool_name: "Bash" }],
    session_id: "s2",
  });

  const result = await invoke(shim, agentIn(root, ".claude"), root);

  assert.equal(result.success, false);
  assert.equal(result.failureKind, "configuration");
  assert.equal(result.errorMessage, "claude denied tool calls under bypassPermissions: Write, Bash");
});

test("a denial with no tool_name is still a configuration failure", async () => {
  const root = makeRepo();
  const shim = makeShim();
  stubEnvelope({
    type: "result", subtype: "success", is_error: false, result: "done",
    permission_denials: [{}], session_id: "s3",
  });

  const result = await invoke(shim, agentIn(root, ".claude"), root);

  assert.equal(result.success, false);
  assert.equal(result.failureKind, "configuration");
  assert.equal(result.errorMessage, "claude denied tool calls under bypassPermissions: unnamed tool");
});

test("a nonzero exit with no envelope is a configuration failure carrying stderr", async () => {
  const root = makeRepo();
  const shim = makeShim();
  process.env.CLAUDE_SHIM_STDOUT = "";
  process.env.CLAUDE_SHIM_STDERR = "--agent 'x' not found\n";
  process.env.CLAUDE_SHIM_EXIT = "1";

  const result = await invoke(shim, agentIn(root, ".claude"), root);

  assert.equal(result.success, false);
  assert.equal(result.failureKind, "configuration");
  assert.equal(result.errorMessage, "--agent 'x' not found");
  assert.equal(result.stderr, "--agent 'x' not found\n");
});

test("a clean exit with unparseable stdout is an exception", async () => {
  const root = makeRepo();
  const shim = makeShim();
  process.env.CLAUDE_SHIM_STDOUT = "Welcome to Claude Code!\nnot json at all";

  const result = await invoke(shim, agentIn(root, ".claude"), root);

  assert.equal(result.success, false);
  assert.equal(result.failureKind, "exception");
  assert.ok(result.errorMessage?.startsWith("claude returned no JSON result envelope"), result.errorMessage);
  assert.ok(result.errorMessage?.includes("not json at all"), result.errorMessage);
});

test("a spawn failure passes the runCommand failure kind through unchanged", async () => {
  const root = makeRepo();
  process.env.CLAUDE_BIN = join(root, "no-such-claude-binary");
  const adapter = new ClaudeAdapter();

  const result = await adapter.invoke(prepareTaskRequest({ agent: agentIn(root, ".claude"), task: makeTask(), repoRoot: root }));

  assert.equal(result.success, false);
  assert.equal(result.failureKind, "configuration");
  assert.ok(result.errorMessage);
});

test("a JSON object that is not a result envelope counts as no envelope", async () => {
  const root = makeRepo();
  const shim = makeShim();
  process.env.CLAUDE_SHIM_STDOUT = '{"type":"system","subtype":"init"}';

  const result = await invoke(shim, agentIn(root, ".claude"), root);

  assert.equal(result.success, false);
  assert.equal(result.failureKind, "exception");
  assert.ok(result.errorMessage?.startsWith("claude returned no JSON result envelope"), result.errorMessage);
});

test("a banner ahead of the envelope does not lose it", async () => {
  const root = makeRepo();
  const shim = makeShim();
  process.env.CLAUDE_SHIM_STDOUT = `Warning: config\n${SUCCESS_ENVELOPE}`;

  const result = await invoke(shim, agentIn(root, ".claude"), root);

  assert.equal(result.success, true);
  assert.equal(result.stdout, "Substantive completed text response.");
});

test("a nonzero exit alongside a success envelope is retryable", async () => {
  const root = makeRepo();
  const shim = makeShim();
  process.env.CLAUDE_SHIM_EXIT = "2";

  const result = await invoke(shim, agentIn(root, ".claude"), root);

  assert.equal(result.success, false);
  assert.equal(result.failureKind, "retryable");
  assert.ok(result.errorMessage?.includes("exited with status 2 despite a success envelope"), result.errorMessage);
});

test("is_error wins over a success subtype", async () => {
  const root = makeRepo();
  const shim = makeShim();
  stubEnvelope({ type: "result", subtype: "success", is_error: true, terminal_reason: "completed", result: "Something went wrong." });

  const result = await invoke(shim, agentIn(root, ".claude"), root);

  assert.equal(result.success, false);
  assert.equal(result.failureKind, "retryable");
  assert.equal(result.errorMessage, "Something went wrong.");
});
