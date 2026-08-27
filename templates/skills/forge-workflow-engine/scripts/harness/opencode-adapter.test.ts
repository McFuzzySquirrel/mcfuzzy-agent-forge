import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OpenCodeAdapter } from "./opencode-adapter.ts";
import type { AgentDescriptor, ManifestTask, WorkflowState } from "../types.ts";

interface Shim {
  bin: string;
  argsFile: string;
}

function makeShim(): Shim {
  const dir = mkdtempSync(join(tmpdir(), "forge-opencode-adapter-"));
  const bin = join(dir, "fake-opencode");
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
  const original = process.env.OPENCODE_BIN;
  process.env.OPENCODE_BIN = shim.bin;
  try {
    const adapter = new OpenCodeAdapter();
    const result = await adapter.invoke(agent, makeTask(), {} as WorkflowState, root);
    assert.equal(result.success, true);
  } finally {
    if (original === undefined) delete process.env.OPENCODE_BIN;
    else process.env.OPENCODE_BIN = original;
  }
}

test("passes --agent for .opencode-rooted agents and omits the inline persona", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-opencode-repo-"));
  const agent = makeAgent(join(root, ".opencode", "agents", "discovery-engineer.md"));
  const shim = makeShim();

  await invokeWith(shim, agent, root);

  const recorded = JSON.parse(readFileSync(shim.argsFile, "utf8")) as string[];
  assert.ok(recorded.includes("--agent"));
  assert.ok(recorded.includes(agent.name));
  assert.ok(!recorded.some((arg) => arg.includes("You are a Discovery Engineer")));
});

test("falls back to inlining the persona for non-.opencode harness roots", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-agents-repo-"));
  const agent = makeAgent(join(root, ".agents", "agents", "discovery-engineer.md"));
  const shim = makeShim();

  await invokeWith(shim, agent, root);

  const recorded = JSON.parse(readFileSync(shim.argsFile, "utf8")) as string[];
  assert.ok(!recorded.includes("--agent"));
  assert.ok(recorded.some((arg) => arg.includes("You are a Discovery Engineer")));
});

test("never passes --agent when the agent has no name", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-noname-repo-"));
  const agent = { ...makeAgent(join(root, ".opencode", "agents", "unnamed.md")), name: "" };
  const shim = makeShim();

  await invokeWith(shim, agent, root);

  const recorded = JSON.parse(readFileSync(shim.argsFile, "utf8")) as string[];
  assert.ok(!recorded.includes("--agent"));
  assert.ok(recorded.some((arg) => arg.includes("You are a Discovery Engineer")));
});
