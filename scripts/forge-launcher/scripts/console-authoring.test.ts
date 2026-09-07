import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { get } from "node:http";
import { startConsoleServer } from "./console/server.ts";
import { RunController, type SpawnOptions } from "./console/control.ts";
import { inferEngineHarness, repoPaths } from "./console/paths.ts";
import { actions, setModelOverride, summary } from "./console/repo.ts";
import { currentJobForRepo } from "./console/jobs.ts";
import { authoringConfigPath, saveAuthoringConfig } from "./authoring-config.ts";
import { fingerprintFiles, saveAuthoringStage, stageInputFingerprint } from "./authoring-state.ts";
import { writeFeatureFixture } from "./feature-fixture.ts";

let port = 46700;
function fixture(t: TestContext, harnessRoot = ".github"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-authoring-console-"));
  const old = process.env.FORGE_HOME;
  process.env.FORGE_HOME = path.join(root, "registry");
  t.after(() => {
    if (old === undefined) delete process.env.FORGE_HOME; else process.env.FORGE_HOME = old;
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, ".git"));
  fs.mkdirSync(path.join(root, "docs"));
  fs.mkdirSync(path.join(root, harnessRoot, "agents"), { recursive: true });
  fs.writeFileSync(path.join(root, harnessRoot, "agents", "worker.md"), '---\nname: worker\ndescription: "Worker"\n---\n');
  writeFeatureFixture(root);
  return root;
}

test("authoring settings API is token-gated, validates shape, and clears to inheritance", async (t) => {
  const root = fixture(t);
  const server = await startConsoleServer({ repoRoot: root, port: port++, open: false });
  t.after(() => server.stop());
  const url = `${server.url}/api/authoring-config`;
  assert.deepEqual(await fetch(url).then((r) => r.json()), { version: 1, models: {} });
  assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 403);
  const post = (body: unknown) => fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Forge-Token": server.token }, body: JSON.stringify(body),
  });
  assert.equal((await post({ version: 1, models: { unknown: "model" } })).status, 400);
  assert.equal((await post({ version: 1, models: { prd: "one two" } })).status, 400);
  assert.equal((await post({ version: 1, models: {}, runner: "gpt" })).status, 400);
  assert.equal((await post({ version: 1, models: {}, runner: "claude" })).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(authoringConfigPath(root), "utf8")).runner, "claude");
  const config = { version: 1, models: { prd: "gpt-6-astra", team: "gpt-5.6-luna" } };
  assert.equal((await post(config)).status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(authoringConfigPath(root), "utf8")), config);
  assert.equal((await post({ version: 1, models: {} })).status, 200);
  assert.deepEqual(await fetch(url).then((r) => r.json()), { version: 1, models: {} });
});

test("model discovery works before a project exists and filters by runner", async (t) => {
  fixture(t);
  let probes = 0;
  const server = await startConsoleServer({
    port: port++, open: false,
    inventoryProbe: async (runner, args) => {
      probes++;
      assert.equal(runner, "copilot");
      assert.deepEqual(args, ["-p", "/model list names only"]);
      return {
        code: 0,
        stdout: "| Model        | Context Window | Multiplier |\n|--------------|----------------|------------|\n| gpt-6-astra  | 128k           | 1x         |\n| gpt-5.6-luna | 128k           | 0.5x       |",
        stderr: "",
      };
    },
  });
  t.after(() => server.stop());
  const endpoint = `${server.url}/api/authoring-inventory`;
  const before = await fetch(`${endpoint}?runner=copilot`).then((r) => r.json());
  assert.deepEqual(before.models, []);
  assert.equal(probes, 0);
  const response = await fetch(`${endpoint}/refresh`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Forge-Token": server.token },
    body: JSON.stringify({ runner: "copilot" }),
  });
  assert.equal(response.status, 200);
  assert.equal(probes, 1);
  const refreshed = await response.json();
  assert.deepEqual(refreshed.models.map((model: { id: string }) => model.id), ["gpt-6-astra", "gpt-5.6-luna"]);
  assert.deepEqual((await fetch(`${endpoint}?runner=opencode`).then((r) => r.json())).models, []);
});

test("claude model discovery probes /model and lists the stable aliases", async (t) => {
  fixture(t);
  let probes = 0;
  const server = await startConsoleServer({
    port: port++, open: false,
    inventoryProbe: async (runner, args) => {
      probes++;
      assert.equal(runner, "claude");
      assert.deepEqual(args, ["-p", "/model", "--bare", "--output-format", "json"]);
      return { code: 0, stdout: JSON.stringify({
        type: "result",
        is_error: false,
        result: "Current model: `Haiku 4.5`\nUsage: /model <name>. Available: sonnet, opus, haiku, fable, best, sonnet[1m], opus[1m], fable[1m], opusplan, default, or a full model ID.",
      }), stderr: "" };
    },
  });
  t.after(() => server.stop());
  const response = await fetch(`${server.url}/api/authoring-inventory/refresh`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Forge-Token": server.token },
    body: JSON.stringify({ runner: "claude" }),
  });
  assert.equal(response.status, 200);
  assert.equal(probes, 1);
  const refreshed = await response.json();
  assert.equal(refreshed.runner, "claude");
  assert.deepEqual(refreshed.models.map((model: { id: string }) => model.id), [
    "sonnet", "opus", "haiku", "fable", "sonnet[1m]", "opus[1m]", "fable[1m]", "opusplan",
  ]);
});

/** A PATH directory holding only the named fake executables, so the runner probe sees exactly these. */
function fakeBin(t: TestContext, ...commands: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "forge-bin-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const command of commands) {
    const file = path.join(dir, command);
    fs.writeFileSync(file, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(file, 0o755);
  }
  return dir;
}

test("a .claude repo defaults the authoring runner to opencode and the engine harness to claude", async (t) => {
  const root = fixture(t, ".claude");
  const previous = process.env.FORGE_RUN_WITH;
  delete process.env.FORGE_RUN_WITH;
  t.after(() => { if (previous === undefined) delete process.env.FORGE_RUN_WITH; else process.env.FORGE_RUN_WITH = previous; });
  // Inheritance consults the machine, so pin PATH to a fake opencode. Without
  // this the assertion would pass or fail on whether the developer happens to
  // have OpenCode installed.
  const previousPath = process.env.PATH;
  process.env.PATH = fakeBin(t, "opencode");
  t.after(() => { process.env.PATH = previousPath; });
  assert.equal(inferEngineHarness(root), "claude");
  const server = await startConsoleServer({ repoRoot: root, port: port++, open: false });
  t.after(() => server.stop());
  const inventory = await fetch(`${server.url}/api/authoring-inventory`).then((r) => r.json());
  assert.equal(inventory.runner, "opencode");
});

test("FORGE_RUN_WITH=claude selects the claude authoring runner for a .claude repo", async (t) => {
  const root = fixture(t, ".claude");
  const previous = process.env.FORGE_RUN_WITH;
  process.env.FORGE_RUN_WITH = "claude";
  t.after(() => { if (previous === undefined) delete process.env.FORGE_RUN_WITH; else process.env.FORGE_RUN_WITH = previous; });
  const server = await startConsoleServer({ repoRoot: root, port: port++, open: false });
  t.after(() => server.stop());
  const inventory = await fetch(`${server.url}/api/authoring-inventory`).then((r) => r.json());
  assert.equal(inventory.runner, "claude");
});

test("a saved project runner drives the inventory endpoint and the refresh probe", async (t) => {
  const root = fixture(t);
  const previous = process.env.FORGE_RUN_WITH;
  delete process.env.FORGE_RUN_WITH;
  t.after(() => { if (previous === undefined) delete process.env.FORGE_RUN_WITH; else process.env.FORGE_RUN_WITH = previous; });
  saveAuthoringConfig(root, { version: 1, models: {}, runner: "opencode" });
  let probes = 0;
  const server = await startConsoleServer({
    repoRoot: root, port: port++, open: false,
    inventoryProbe: async (runner) => {
      probes++;
      assert.equal(runner, "opencode");
      return { code: 0, stdout: "Available models:\n- anthropic/claude-4\n", stderr: "" };
    },
  });
  t.after(() => server.stop());
  const inventory = await fetch(`${server.url}/api/authoring-inventory`).then((r) => r.json());
  assert.equal(inventory.runner, "opencode");
  const refreshed = await fetch(`${server.url}/api/authoring-inventory/refresh`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Forge-Token": server.token },
    body: JSON.stringify({}),
  }).then((r) => r.json());
  assert.equal(refreshed.runner, "opencode");
  assert.equal(probes, 1);
});

test("a .github repo still infers the copilot engine harness", (t) => {
  assert.equal(inferEngineHarness(fixture(t, ".github")), "copilot");
});

test("a harness root that is neither .github nor .claude still infers opencode", (t) => {
  assert.equal(inferEngineHarness(fixture(t, ".opencode")), "opencode");
});

test("legacy projects remain ready but failed skill authoring blocks native dispatch", (t) => {
  const root = fixture(t);
  assert.equal(summary(repoPaths(root)).authoringReady, true);
  saveAuthoringStage(root, "skills", { status: "failed", inputFingerprint: "input", outputs: [], error: "Skill package is incomplete." });
  const current = summary(repoPaths(root));
  assert.equal(current.authoringReady, false);
  assert.match(current.authoringBlocker ?? "", /skills/i);
  assert.equal(actions(repoPaths(root)).canRun, false);
  let spawns = 0;
  const controller = new RunController(root, { spawner: () => { spawns++; return { pid: 987654 }; } });
  assert.equal(controller.run().ok, false);
  assert.equal(controller.compileManifest().ok, false);
  assert.equal(controller.replay("task-1").ok, false);
  assert.equal(spawns, 0);
  const result = controller.draftSkills();
  assert.equal(result.ok, true);
  assert.equal(result.job?.type, "draft-skills");
  assert.equal(spawns, 1);
  summary(repoPaths(root));
  assert.equal(currentJobForRepo(root)?.status, "failed");
  assert.match(currentJobForRepo(root)?.message ?? "", /Skill package is incomplete/);
});

test("summary identifies the recoverable stage when completed authoring becomes stale", (t) => {
  const root = fixture(t);
  for (const stage of ["team", "skills"] as const) {
    saveAuthoringStage(root, stage, {
      status: "complete", inputFingerprint: stageInputFingerprint(root, stage, ".github"),
      outputs: [".github/agents/worker.md"],
    });
  }
  assert.equal(summary(repoPaths(root)).authoringReady, true);
  fs.appendFileSync(path.join(root, "docs", "PRD.md"), "\nNew requirement.\n");
  const stale = summary(repoPaths(root));
  assert.equal(stale.authoringReady, false);
  assert.equal(stale.authoringNextStage, "team");
  assert.equal(stale.authoring.stages.team?.status, "complete");
  saveAuthoringStage(root, "team", {
    status: "complete", inputFingerprint: stageInputFingerprint(root, "team", ".github"),
    outputs: [".github/agents/worker.md"],
  });
  assert.equal(summary(repoPaths(root)).authoringNextStage, "skills");
});

test("Console execution-model edits do not invalidate completed authoring", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "docs", "research"));
  fs.writeFileSync(path.join(root, "docs", "research", "model-inventory.json"), JSON.stringify({
    copilot_cli: { models: [{ id: "gpt-6-astra" }] },
  }));
  for (const stage of ["team", "skills"] as const) {
    const outputs = [".github/agents/worker.md"];
    saveAuthoringStage(root, stage, {
      status: "complete", inputFingerprint: stageInputFingerprint(root, stage, ".github"),
      outputs, outputFingerprint: fingerprintFiles(root, outputs),
    });
  }
  assert.equal(summary(repoPaths(root)).authoringReady, true);
  assert.equal(setModelOverride(repoPaths(root), "worker", "gpt-6-astra").ok, true);
  assert.equal(summary(repoPaths(root)).authoringReady, true);
});

test("new project request passes three distinct model flags and marks auto-setup", (t) => {
  const root = fixture(t);
  let captured: { args: string[]; options: SpawnOptions } | undefined;
  const controller = new RunController(root, { spawner: (_cmd, args, options) => {
    captured = { args, options };
    return { pid: 987655 };
  } });
  const result = controller.createProject({
    name: "new-project", parentDir: root, idea: "Build something", autoDraft: true, harness: "github",
    authoringConfig: { version: 1, models: { prd: "gpt-6-astra", team: "gpt-5.6-luna", skills: "gpt-6-astra" } },
  });
  assert.equal(result.ok, true);
  assert.ok(captured);
  const args = captured.args;
  assert.equal(args[args.indexOf("--prd-model") + 1], "gpt-6-astra");
  assert.equal(args[args.indexOf("--team-model") + 1], "gpt-5.6-luna");
  assert.equal(args[args.indexOf("--skills-model") + 1], "gpt-6-astra");
  assert.equal(result.job?.autoDraft, true);
});

test("new project request forwards an explicit authoring runner to the launcher", (t) => {
  const root = fixture(t);
  let captured: { args: string[]; options: SpawnOptions } | undefined;
  const controller = new RunController(root, { spawner: (_cmd, args, options) => {
    captured = { args, options };
    return { pid: 987656 };
  } });
  const result = controller.createProject({
    name: "runner-project", parentDir: root, idea: "Build something", autoDraft: false, harness: "claude",
    authoringConfig: { version: 1, models: {}, runner: "claude" },
  });
  assert.equal(result.ok, true);
  assert.ok(captured);
  assert.equal(captured.args[captured.args.indexOf("--runner") + 1], "claude");
});

test("synchronous startup failure is an error result, not a running success", (t) => {
  const root = fixture(t);
  const controller = new RunController(root, { spawner: (_cmd, _args, options) => {
    options.onStartupError?.(new Error("runner unavailable"));
    return {};
  } });
  const result = controller.draftSkills();
  assert.equal(result.ok, false);
  assert.equal(result.job?.status, "failed");
  assert.match(result.message, /runner unavailable/);
});

test("split structured authoring events survive ordinary partial-line log streaming", async (t) => {
  const root = fixture(t);
  const log = path.join(root, "docs", "engine-run.log");
  fs.writeFileSync(log, "");
  const server = await startConsoleServer({ repoRoot: root, port: port++, open: false });
  let received = "";
  const request = get(`${server.url}/api/events`, (response) => {
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => { received += chunk; });
  });
  t.after(async () => { request.destroy(); await server.stop(); });
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  await sleep(100);
  const event = Buffer.from('FORGE_EVENT {"type":"authoring.completed","message":"\u2713"}\n');
  const split = event.indexOf(Buffer.from("\u2713")) + 1;
  fs.appendFileSync(log, event.subarray(0, split));
  await sleep(700);
  assert.equal(received.includes("event: authoring"), false);
  fs.appendFileSync(log, event.subarray(split));
  const deadline = Date.now() + 3000;
  while (!received.includes("event: authoring") && Date.now() < deadline) await sleep(50);
  assert.equal(received.split("event: authoring").length - 1, 1);
  assert.match(received, /"message":"\u2713"/);
});
