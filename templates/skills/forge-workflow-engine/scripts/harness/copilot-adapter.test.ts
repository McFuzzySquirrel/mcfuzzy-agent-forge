import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { CopilotAdapter } from "./copilot-adapter.ts";
import type { AgentDescriptor, ManifestTask } from "../types.ts";
import { prepareTaskRequest } from "../request.ts";
import { makeNodeShim, tempDir } from "../test-support.ts";

interface Shim {
  bin: string;
  argsFile: string;
}

function makeShim(t: TestContext): Shim {
  const dir = tempDir(t, "forge-copilot-adapter-");
  const argsFile = join(dir, "args.json");
  const bin = makeNodeShim(dir, "fake-copilot", `
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
  const original = process.env.COPILOT_BIN;
  process.env.COPILOT_BIN = shim.bin;
  try {
    const adapter = new CopilotAdapter();
    const result = await adapter.invoke(prepareTaskRequest({ agent, task: makeTask(), repoRoot: root, defaultModel: adapter.defaultModel }));
    assert.equal(result.success, true);
  } finally {
    if (original === undefined) delete process.env.COPILOT_BIN;
    else process.env.COPILOT_BIN = original;
  }
}

function recordedPrompt(shim: Shim, root: string): string {
  const recorded = JSON.parse(readFileSync(shim.argsFile, "utf8")) as string[];
  const prompt = recorded[recorded.indexOf("-p") + 1]!;
  const file = prompt.match(/execution file "([^"]+)"/)?.[1];
  assert.ok(file, prompt);
  assert.ok(prompt.length < 1000, prompt);
  return prompt + "\n" + readFileSync(join(root, file), "utf8");
}

test("passes --agent for .github-rooted agents and omits the fallback persona", async (t) => {
  const root = tempDir(t, "forge-copilot-repo-");
  const agent = makeAgent(join(root, ".github", "agents", "discovery-engineer.md"));
  const shim = makeShim(t);

  await invokeWith(shim, agent, root);

  const prompt = recordedPrompt(shim, root);
  const args = JSON.parse(readFileSync(shim.argsFile, "utf8")) as string[];
  assert.equal(args[args.indexOf("--agent") + 1], "discovery-engineer");
  assert.ok(!args[args.indexOf("-p") + 1]!.includes("\n"));
  assert.ok(!prompt.includes("You are a Discovery Engineer"), prompt);
});

test("falls back to inlining the persona for non-.github harness roots", async (t) => {
  const root = tempDir(t, "forge-agents-repo-");
  const agent = makeAgent(join(root, ".agents", "agents", "discovery-engineer.md"));
  const shim = makeShim(t);

  await invokeWith(shim, agent, root);

  const prompt = recordedPrompt(shim, root);
  assert.ok(!prompt.includes("/agent "), prompt);
  assert.ok(prompt.includes("You are a Discovery Engineer"), prompt);
});

test("never uses /agent when the agent has no name", async (t) => {
  const root = tempDir(t, "forge-noname-repo-");
  const agent = { ...makeAgent(join(root, ".github", "agents", "unnamed.md")), name: "" };
  const shim = makeShim(t);

  await invokeWith(shim, agent, root);

  const prompt = recordedPrompt(shim, root);
  assert.ok(!prompt.includes("/agent "), prompt);
  assert.ok(prompt.includes("You are a Discovery Engineer"), prompt);
});

test("FORGE_ENGINE_NATIVE_AGENT=0 forces the inline-persona fallback for .github agents", async (t) => {
  const root = tempDir(t, "forge-nonative-repo-");
  const agent = makeAgent(join(root, ".github", "agents", "discovery-engineer.md"));
  const shim = makeShim(t);
  const original = process.env.FORGE_ENGINE_NATIVE_AGENT;
  process.env.FORGE_ENGINE_NATIVE_AGENT = "0";
  try {
    await invokeWith(shim, agent, root);
  } finally {
    if (original === undefined) delete process.env.FORGE_ENGINE_NATIVE_AGENT;
    else process.env.FORGE_ENGINE_NATIVE_AGENT = original;
  }

  const prompt = recordedPrompt(shim, root);
  assert.ok(!prompt.includes("/agent "), prompt);
  assert.ok(prompt.includes("You are a Discovery Engineer"), prompt);
});

test("prompt includes the execute-now directive in both native and inline modes", async (t) => {
  const root = tempDir(t, "forge-directive-repo-");
  const shim = makeShim(t);

  await invokeWith(shim, makeAgent(join(root, ".github", "agents", "discovery-engineer.md")), root);
  const nativePrompt = recordedPrompt(shim, root);
  assert.ok(nativePrompt.includes("Perform the task now"), nativePrompt);

  await invokeWith(shim, makeAgent(join(root, ".agents", "agents", "discovery-engineer.md")), root);
  const inlinePrompt = recordedPrompt(shim, root);
  assert.ok(inlinePrompt.includes("Perform the task now"), inlinePrompt);
});

test("prompt surfaces the per-task timeout and retry budget when provided", async (t) => {
  const root = tempDir(t, "forge-budget-repo-");
  const agent = makeAgent(join(root, ".agents", "agents", "discovery-engineer.md"));
  const shim = makeShim(t);
  const original = process.env.COPILOT_BIN;
  process.env.COPILOT_BIN = shim.bin;
  try {
    const adapter = new CopilotAdapter();
    const result = await adapter.invoke(prepareTaskRequest({ agent, task: makeTask(), repoRoot: root, timeoutMs: 30_000, maxRetries: 3 }));
    assert.equal(result.success, true);
  } finally {
    if (original === undefined) delete process.env.COPILOT_BIN;
    else process.env.COPILOT_BIN = original;
  }

  const prompt = recordedPrompt(shim, root);
  assert.ok(prompt.includes("Per-task timeout: 30s"), prompt);
  assert.ok(prompt.includes("retried up to 3 time(s)"), prompt);
});
