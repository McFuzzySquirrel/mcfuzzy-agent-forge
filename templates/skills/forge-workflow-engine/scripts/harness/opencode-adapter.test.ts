import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OpenCodeAdapter } from "./opencode-adapter.ts";
import type { AgentDescriptor, ManifestTask } from "../types.ts";
import { prepareTaskRequest } from "../request.ts";
import { makeNodeShim } from "../test-support.ts";

interface Shim {
  bin: string;
  argsFile: string;
}

/** A temp directory removed when the test that made it finishes. */
function tempDir(t: TestContext, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeShim(t: TestContext): Shim {
  const dir = tempDir(t, "forge-opencode-adapter-");
  const argsFile = join(dir, "args.json");
  const bin = makeNodeShim(dir, "fake-opencode", `
const fs = require("fs");
fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
process.exit(0);
`,
  );
  return { bin, argsFile };
}

function makeTask(): ManifestTask {
  return {
    id: "t1",
    title: "Build the scanner",
    description: "Implement the recursive scanner.",
    dependencies: [],
    expectedOutputs: ["src/discovery/scanner.ts"],
    validationCommands: ["npm run typecheck"],
    approvalRequired: false,
    sourceLines: [],
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

async function invokeWith(shim: Shim, agent: AgentDescriptor, root: string): Promise<void> {
  const original = process.env.OPENCODE_BIN;
  process.env.OPENCODE_BIN = shim.bin;
  try {
    const adapter = new OpenCodeAdapter();
    const result = await adapter.invoke(prepareTaskRequest({ agent, task: makeTask(), repoRoot: root, defaultModel: adapter.defaultModel }));
    assert.equal(result.success, true);
  } finally {
    if (original === undefined) delete process.env.OPENCODE_BIN;
    else process.env.OPENCODE_BIN = original;
  }
}

test("passes --agent for .opencode-rooted agents and omits the inline persona", async (t) => {
  const root = tempDir(t, "forge-opencode-repo-");
  const agent = makeAgent(join(root, ".opencode", "agents", "discovery-engineer.md"));
  const shim = makeShim(t);

  await invokeWith(shim, agent, root);

  const recorded = JSON.parse(readFileSync(shim.argsFile, "utf8")) as string[];
  assert.ok(recorded.includes("--agent"));
  assert.ok(recorded.includes(agent.name));
  assert.ok(!recorded.some((arg) => arg.includes("You are a Discovery Engineer")));
});

test("preserves the provider prefix for OpenCode model IDs", async (t) => {
  const root = tempDir(t, "forge-opencode-model-repo-");
  const agent = { ...makeAgent(join(root, ".opencode", "agents", "discovery-engineer.md")), model: "github-copilot/gpt-5.6-luna" };
  const shim = makeShim(t);

  await invokeWith(shim, agent, root);

  const recorded = JSON.parse(readFileSync(shim.argsFile, "utf8")) as string[];
  const modelIndex = recorded.indexOf("--model");
  assert.ok(modelIndex >= 0);
  assert.equal(recorded[modelIndex + 1], "github-copilot/gpt-5.6-luna");
});

test("falls back to inlining the persona for non-.opencode harness roots", async (t) => {
  const root = tempDir(t, "forge-agents-repo-");
  const agent = makeAgent(join(root, ".agents", "agents", "discovery-engineer.md"));
  const shim = makeShim(t);

  await invokeWith(shim, agent, root);

  const recorded = JSON.parse(readFileSync(shim.argsFile, "utf8")) as string[];
  assert.ok(!recorded.includes("--agent"));
  assert.ok(recorded.some((arg) => arg.includes("You are a Discovery Engineer")));
});

test("never passes --agent when the agent has no name", async (t) => {
  const root = tempDir(t, "forge-noname-repo-");
  const agent = { ...makeAgent(join(root, ".opencode", "agents", "unnamed.md")), name: "" };
  const shim = makeShim(t);

  await invokeWith(shim, agent, root);

  const recorded = JSON.parse(readFileSync(shim.argsFile, "utf8")) as string[];
  assert.ok(!recorded.includes("--agent"));
  assert.ok(recorded.some((arg) => arg.includes("You are a Discovery Engineer")));
});

test("prompt includes the execute-now directive so agents do not just acknowledge", async (t) => {
  const root = tempDir(t, "forge-directive-repo-");
  const agent = makeAgent(join(root, ".agents", "agents", "discovery-engineer.md"));
  const shim = makeShim(t);

  await invokeWith(shim, agent, root);

  const recorded = JSON.parse(readFileSync(shim.argsFile, "utf8")) as string[];
  const prompt = recorded.join(" ");
  assert.ok(prompt.includes("Perform the task now"), prompt);
  assert.ok(prompt.includes("list the files you created or changed"), prompt);
});

test("prompt surfaces the per-task timeout and retry budget when provided", async (t) => {
  const root = tempDir(t, "forge-budget-repo-");
  const agent = makeAgent(join(root, ".agents", "agents", "discovery-engineer.md"));
  const shim = makeShim(t);
  const original = process.env.OPENCODE_BIN;
  process.env.OPENCODE_BIN = shim.bin;
  try {
    const adapter = new OpenCodeAdapter();
    const result = await adapter.invoke(prepareTaskRequest({ agent, task: makeTask(), repoRoot: root, timeoutMs: 60_000, maxRetries: 2 }));
    assert.equal(result.success, true);
  } finally {
    if (original === undefined) delete process.env.OPENCODE_BIN;
    else process.env.OPENCODE_BIN = original;
  }

  const recorded = JSON.parse(readFileSync(shim.argsFile, "utf8")) as string[];
  const prompt = recorded.join(" ");
  assert.ok(prompt.includes("Per-task timeout: 60s"), prompt);
  assert.ok(prompt.includes("retried up to 2 time(s)"), prompt);
});

test("prompt includes the normalized default budget when no overrides are provided", async (t) => {
  const root = tempDir(t, "forge-nobudget-repo-");
  const agent = makeAgent(join(root, ".agents", "agents", "discovery-engineer.md"));
  const shim = makeShim(t);

  await invokeWith(shim, agent, root);

  const recorded = JSON.parse(readFileSync(shim.argsFile, "utf8")) as string[];
  const prompt = recorded.join(" ");
  assert.ok(prompt.includes("Per-task timeout: 600s"), prompt);
  assert.ok(prompt.includes("retried up to 0 time(s)"), prompt);
});

test("FORGE_ENGINE_NATIVE_AGENT=0 forces the inline-persona fallback for .opencode agents", async (t) => {
  const root = tempDir(t, "forge-nonative-repo-");
  const agent = makeAgent(join(root, ".opencode", "agents", "discovery-engineer.md"));
  const shim = makeShim(t);
  const original = process.env.FORGE_ENGINE_NATIVE_AGENT;
  process.env.FORGE_ENGINE_NATIVE_AGENT = "0";
  try {
    await invokeWith(shim, agent, root);
  } finally {
    if (original === undefined) delete process.env.FORGE_ENGINE_NATIVE_AGENT;
    else process.env.FORGE_ENGINE_NATIVE_AGENT = original;
  }

  const recorded = JSON.parse(readFileSync(shim.argsFile, "utf8")) as string[];
  assert.ok(!recorded.includes("--agent"));
  assert.ok(recorded.some((arg) => arg.includes("You are a Discovery Engineer")));
});
