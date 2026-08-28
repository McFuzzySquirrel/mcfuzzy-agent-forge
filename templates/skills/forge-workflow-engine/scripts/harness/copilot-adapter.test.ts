import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CopilotAdapter } from "./copilot-adapter.ts";
import type { AgentDescriptor, ManifestTask, WorkflowState } from "../types.ts";

interface Shim {
  bin: string;
  argsFile: string;
}

function makeShim(): Shim {
  const dir = mkdtempSync(join(tmpdir(), "forge-copilot-adapter-"));
  const bin = join(dir, "fake-copilot");
  const argsFile = join(dir, "args.json");
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("fs");
fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
process.exit(0);
`,
    { mode: 0o755 },
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
    const result = await adapter.invoke(agent, makeTask(), {} as WorkflowState, root);
    assert.equal(result.success, true);
  } finally {
    if (original === undefined) delete process.env.COPILOT_BIN;
    else process.env.COPILOT_BIN = original;
  }
}

function recordedPrompt(shim: Shim): string {
  const recorded = JSON.parse(readFileSync(shim.argsFile, "utf8")) as string[];
  return recorded[recorded.indexOf("-p") + 1] ?? "";
}

test("prepends /agent for .github-rooted agents and omits the inline persona", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-copilot-repo-"));
  const agent = makeAgent(join(root, ".github", "agents", "discovery-engineer.md"));
  const shim = makeShim();

  await invokeWith(shim, agent, root);

  const prompt = recordedPrompt(shim);
  assert.ok(prompt.startsWith("/agent discovery-engineer"), prompt);
  assert.ok(!prompt.includes("You are a Discovery Engineer"), prompt);
});

test("falls back to inlining the persona for non-.github harness roots", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-agents-repo-"));
  const agent = makeAgent(join(root, ".agents", "agents", "discovery-engineer.md"));
  const shim = makeShim();

  await invokeWith(shim, agent, root);

  const prompt = recordedPrompt(shim);
  assert.ok(!prompt.includes("/agent "), prompt);
  assert.ok(prompt.includes("You are a Discovery Engineer"), prompt);
});

test("never uses /agent when the agent has no name", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-noname-repo-"));
  const agent = { ...makeAgent(join(root, ".github", "agents", "unnamed.md")), name: "" };
  const shim = makeShim();

  await invokeWith(shim, agent, root);

  const prompt = recordedPrompt(shim);
  assert.ok(!prompt.includes("/agent "), prompt);
  assert.ok(prompt.includes("You are a Discovery Engineer"), prompt);
});

test("FORGE_ENGINE_NATIVE_AGENT=0 forces the inline-persona fallback for .github agents", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-nonative-repo-"));
  const agent = makeAgent(join(root, ".github", "agents", "discovery-engineer.md"));
  const shim = makeShim();
  const original = process.env.FORGE_ENGINE_NATIVE_AGENT;
  process.env.FORGE_ENGINE_NATIVE_AGENT = "0";
  try {
    await invokeWith(shim, agent, root);
  } finally {
    if (original === undefined) delete process.env.FORGE_ENGINE_NATIVE_AGENT;
    else process.env.FORGE_ENGINE_NATIVE_AGENT = original;
  }

  const prompt = recordedPrompt(shim);
  assert.ok(!prompt.includes("/agent "), prompt);
  assert.ok(prompt.includes("You are a Discovery Engineer"), prompt);
});

test("prompt includes the execute-now directive in both native and inline modes", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-directive-repo-"));
  const shim = makeShim();

  await invokeWith(shim, makeAgent(join(root, ".github", "agents", "discovery-engineer.md")), root);
  const nativePrompt = recordedPrompt(shim);
  assert.ok(nativePrompt.includes("Perform the task now"), nativePrompt);

  await invokeWith(shim, makeAgent(join(root, ".agents", "agents", "discovery-engineer.md")), root);
  const inlinePrompt = recordedPrompt(shim);
  assert.ok(inlinePrompt.includes("Perform the task now"), inlinePrompt);
});
