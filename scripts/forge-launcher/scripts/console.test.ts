import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, renameSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get as httpGet, request as httpRequest } from "node:http";

import { startConsoleServer, type ConsoleServer } from "./console/server.ts";
import type { SpawnOptions } from "./console/control.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let portCounter = 0;
function nextPort(): number {
  return 44123 + (portCounter++ % 50);
}

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-console-"));
  const docs = join(root, "docs");
  mkdirSync(docs, { recursive: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  mkdirSync(join(root, ".agents", "skills", "forge-workflow-engine"), { recursive: true });
  mkdirSync(join(root, ".agents", "skills", "add-endpoint"), { recursive: true });
  mkdirSync(join(root, ".agents", "agents"), { recursive: true });

  writeFileSync(join(docs, "IDEA.md"), "# Idea\n\nBuild a thing.\n", "utf8");
  writeFileSync(join(docs, "PRD.md"), "# PRD\n\nRequirements.\n", "utf8");

  const manifest = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    repoRoot: root,
    harnessRoot: ".agents",
    prdPath: join(docs, "PRD.md"),
    progressPath: join(docs, "PROGRESS.md"),
    auditPath: join(docs, "EXECUTION-AUDIT.jsonl"),
    validationCommands: [],
    approvalGates: { preflight: true, betweenPhases: true },
    phases: [
      {
        id: "1",
        title: "Foundation",
        description: "",
        ownerAgents: ["qa-engineer"],
        dependencies: [],
        approvalRequired: false,
        tasks: [
          { id: "1.1", title: "Scaffold", description: "Set up project", ownerAgent: "qa-engineer", dependencies: [], expectedOutputs: ["src/index.ts"], validationCommands: [], approvalRequired: false, produces: "work.1.1" },
          { id: "1.2", title: "Build", description: "Implement", ownerAgent: "qa-engineer", dependencies: ["1.1"], inputs: ["work.1.1"], expectedOutputs: [], validationCommands: [], approvalRequired: false },
        ],
      },
    ],
    warnings: [],
  };
  writeFileSync(join(docs, "EXECUTION-MANIFEST.json"), JSON.stringify(manifest), "utf8");

  const state = {
    runId: "run-1",
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    manifestPath: join(docs, "EXECUTION-MANIFEST.json"),
    manifestVersion: "1.0",
    harness: "opencode",
    status: "running",
    currentPhase: "1",
    tasks: {
      "1.1": {
        taskId: "1.1",
        status: "complete",
        ownerAgent: "qa-engineer",
        attempt: 1,
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:02:00.000Z",
        outputFiles: ["src/index.ts"],
        artifactId: "solution-001",
      },
      "1.2": {
        taskId: "1.2",
        status: "running",
        ownerAgent: "qa-engineer",
        attempt: 1,
        startedAt: "2026-01-01T00:03:00.000Z",
        outputFiles: [],
      },
    },
    blockers: ["waiting for review"],
  };
  writeFileSync(join(docs, "WORKFLOW-STATE.json"), JSON.stringify(state), "utf8");
  writeFileSync(join(docs, "EXECUTION-AUDIT.jsonl"), "", "utf8");
  writeFileSync(join(docs, "engine-run.log"), "line one\nline two\n", "utf8");
  writeFileSync(join(docs, "AUTHORING-EVENTS.jsonl"), "", "utf8");

  mkdirSync(join(docs, "artifacts", "solution"), { recursive: true });
  writeFileSync(
    join(docs, "artifacts", "solution", "solution-001.json"),
    JSON.stringify({
      artifactId: "solution-001",
      type: "solution.architecture",
      category: "work",
      taskId: "1.1",
      producedBy: "qa-engineer",
      status: "complete",
      summary: "Architecture decided",
      confidence: 0.9,
      createdAt: new Date().toISOString(),
      filesChanged: ["src/index.ts"],
      inputs: [],
      payload: { decision: "use express" },
      nextActions: [],
    }),
    "utf8",
  );

  writeFileSync(
    join(root, ".agents", "agents", "qa-engineer.md"),
    "---\nname: qa-engineer\ndescription: >\n  Owns test quality and\n  keeps the build green.\nmodel: gpt-4o\n---\n\n## Expertise\n- Testing\n",
    "utf8",
  );

  writeFileSync(
    join(root, ".agents", "skills", "add-endpoint", "SKILL.md"),
    "---\nname: add-endpoint\ndescription: >\n  Adds a REST endpoint following\n  project conventions.\n---\n\n# Skill: Add Endpoint\n",
    "utf8",
  );

  writeFileSync(
    join(root, ".agents", "skills", "forge-workflow-engine", "SKILL.md"),
    "---\nname: forge-workflow-engine\ndescription: >\n  Autonomous execution engine\n  for MyForge manifests.\n---\n\n# Skill: Workflow Engine\n",
    "utf8",
  );

  return root;
}

interface FakeSpawn {
  calls: Array<{ cmd: string; args: string[]; opts: SpawnOptions }>;
  pids: number[];
}

function fakeSpawner(): FakeSpawn {
  const state: FakeSpawn = { calls: [], pids: [] };
  return state;
}

function getJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    httpGet(url, { agent: false }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    }).on("error", reject);
  });
}

function getText(url: string): Promise<{ status: number; body: string; type: string | null }> {
  return new Promise((resolve, reject) => {
    httpGet(url, { agent: false }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, type: res.headers["content-type"] ?? null }));
    }).on("error", reject);
  });
}

function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = httpRequest(url, { agent: false, method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), ...headers } }, (res) => {
      let text = "";
      res.on("data", (c) => { text += c; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) }); } catch { resolve({ status: res.statusCode ?? 0, body: text }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function collectSse(url: string) {
  const events: Array<{ type: string; data: unknown }> = [];
  const req = httpRequest(url, { agent: false }, (res) => {
    let buffer = "";
    let eventType = "message";
    res.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (data) events.push({ type: eventType, data: JSON.parse(data) });
        eventType = "message";
      }
    });
  });
  req.on("error", () => {});
  req.end();
  return events;
}

async function withServer<T>(
  fn: (server: ConsoleServer, repo: string, spawned: FakeSpawn) => Promise<T>,
  opts: { repoRoot?: boolean } = { repoRoot: true },
): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), "forge-home-"));
  const prevHome = process.env.FORGE_HOME;
  process.env.FORGE_HOME = home;

  const repo = makeRepo();
  const spawn = fakeSpawner();
  const kills: Array<{ pid: number; signal: string }> = [];
  const server = await startConsoleServer({
    repoRoot: opts.repoRoot ? repo : undefined,
    port: nextPort(),
    open: false,
    onLog: () => {},
    clientDir: join(repo, "docs"),
    deps: {
      spawner: (cmd, args, o) => { spawn.calls.push({ cmd, args, opts: o }); return { pid: 9000 + spawn.calls.length }; },
      kill: (pid, signal) => { kills.push({ pid, signal }); },
    },
  });
  try {
    return await fn(server, repo, spawn);
  } finally {
    await server.stop();
    if (prevHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = prevHome;
  }
}

test("serves summary, tasks, docs, team, and actions", async () => {
  await withServer(async (server, repo) => {
    const summary = await getJson(`${server.url}/api/summary`) as { repoName: string; hasPrd: boolean; hasTeam: boolean; defaultTimeoutMs: number; run: { status: string; counts: { complete: number; running: number }; completedDurationMs: number } };
    assert.equal(summary.repoName, repo.split("/").pop());
    assert.equal(summary.hasPrd, true);
    assert.equal(summary.hasTeam, true);
    assert.equal(summary.run.status, "running");
    assert.equal(summary.run.counts.complete, 1);
    assert.equal(summary.run.counts.running, 1);
    assert.equal(summary.run.completedDurationMs, 120000);
    assert.equal(summary.defaultTimeoutMs, 600000);

    const tasks = await getJson(`${server.url}/api/tasks`) as Array<{ id: string; status: string; phaseTitle: string; durationMs: number | null }>;
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0]!.status, "complete");
    assert.equal(tasks[0]!.phaseTitle, "Foundation");
    assert.equal(tasks[0]!.durationMs, 120000);

    const docs = await getJson(`${server.url}/api/docs`) as { entries: Array<{ kind: string }> };
    assert.ok(docs.entries.some((e) => e.kind === "prd"));
    assert.ok(docs.entries.some((e) => e.kind === "idea"));

    const team = await getJson(`${server.url}/api/team`) as { agents: Array<{ name: string; description: string; model: string }>; skills: Array<{ name: string; description: string; category: string }> };
    assert.equal(team.agents.length, 1);
    assert.equal(team.agents[0]!.name, "qa-engineer");
    assert.equal(team.agents[0]!.description, "Owns test quality and keeps the build green.");
    assert.equal(team.agents[0]!.model, "gpt-4o");
    assert.equal(team.skills.length, 2);
    const projectSkill = team.skills.find((s) => s.name === "add-endpoint");
    assert.ok(projectSkill, "add-endpoint skill should be listed");
    assert.equal(projectSkill!.description, "Adds a REST endpoint following project conventions.");
    assert.equal(projectSkill!.category, "project");
    const forgeSkill = team.skills.find((s) => s.name === "forge-workflow-engine");
    assert.ok(forgeSkill, "forge-workflow-engine skill should be listed");
    assert.equal(forgeSkill!.category, "forge");

    const actions = await getJson(`${server.url}/api/actions`) as { canRun: boolean; failedTasks: string[] };
    assert.equal(actions.canRun, false);
    assert.deepEqual(actions.failedTasks, []);
  });
});

test("serves the user guide at /guide.md", async () => {
  await withServer(async (server, repo) => {
    writeFileSync(join(repo, "docs", "guide.md"), "# Forge Console user guide\n\nTest walkthrough.\n", "utf8");
    const res = await getText(`${server.url}/guide.md`);
    assert.equal(res.status, 200);
    assert.match(res.type ?? "", /text\/markdown/);
    assert.match(res.body, /Test walkthrough/);
    assert.match(res.body, /^# Forge Console user guide/m);
  });
});

test("serves logs and artifacts", async () => {
  await withServer(async (server) => {
    const logs = await getJson(`${server.url}/api/logs?lines=1`) as { lines: string[]; truncated: boolean };
    assert.deepEqual(logs.lines, ["line two"]);
    assert.equal(logs.truncated, true);

    const artifacts = await getJson(`${server.url}/api/artifacts`) as { artifacts: Array<{ artifactId: string; type: string }>; types: string[] };
    assert.equal(artifacts.artifacts.length, 1);
    assert.equal(artifacts.artifacts[0]!.artifactId, "solution-001");
    assert.deepEqual(artifacts.types, ["solution.architecture"]);
  });
});

test("streams a snapshot and audit/log events over SSE", async () => {
  await withServer(async (server, repo) => {
    const events = collectSse(`${server.url}/api/events`);
    await sleep(200);
    assert.ok(events.some((e) => e.type === "snapshot"));

    appendFileSync(join(repo, "docs", "EXECUTION-AUDIT.jsonl"), `${JSON.stringify({ timestamp: new Date().toISOString(), action: "task.complete", taskId: "1.2" })}\n`, "utf8");
    appendFileSync(join(repo, "docs", "engine-run.log"), "new log line\n", "utf8");

    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && !(events.some((e) => e.type === "audit") && events.some((e) => e.type === "log"))) {
      await sleep(50);
    }
    assert.ok(events.some((e) => e.type === "audit" && (e.data as { action: string }).action === "task.complete"));
    assert.ok(events.some((e) => e.type === "log"));

    appendFileSync(join(repo, "docs", "engine-run.log"), `FORGE_EVENT ${JSON.stringify({ type: "authoring.started", operation: "feature-increment" })}\nplain after event\n`, "utf8");
    const eventDeadline = Date.now() + 3000;
    while (Date.now() < eventDeadline && !events.some((e) => e.type === "authoring")) await sleep(50);
    assert.ok(events.some((e) => e.type === "authoring" && (e.data as { type: string }).type === "authoring.started"));
    assert.ok(events.some((e) => e.type === "log" && (e.data as { line: string }).line === "plain after event"));
  });
});

test("projects reconciliation details for Console review", async () => {
  await withServer(async (server, repo) => {
    const file = join(repo, "docs", "EXECUTION-MANIFEST.json");
    const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    manifest.reconciliation = { preservedTaskIds: ["1.1"], newTaskIds: ["NEW-1.1"], removedTaskIds: ["OLD-1.1"], changedTaskIds: ["1.2"] };
    writeFileSync(file, JSON.stringify(manifest), "utf8");
    const summary = await getJson(`${server.url}/api/summary`) as { manifest: { reconciliation: { newTaskIds: string[]; changedTaskIds: string[] } } };
    assert.deepEqual(summary.manifest.reconciliation.newTaskIds, ["NEW-1.1"]);
    assert.deepEqual(summary.manifest.reconciliation.changedTaskIds, ["1.2"]);
  });
});

test("pause and stop write the control file (stop also signals the pid)", async () => {
  await withServer(async (server, repo) => {
    writeFileSync(join(repo, "docs", "engine.pid"), "12345\n", "utf8");
    const token = server.token;

    const pause = await postJson(`${server.url}/api/control`, { action: "pause" }, { "X-Forge-Token": token });
    assert.equal((pause.body as { ok: boolean }).ok, true);
    assert.deepEqual(JSON.parse(readFileSync(join(repo, "docs", "engine-control.json"), "utf8")).request, "pause");

    const stop = await postJson(`${server.url}/api/control`, { action: "stop" }, { "X-Forge-Token": token });
    assert.equal((stop.body as { ok: boolean }).ok, true);
    assert.deepEqual(JSON.parse(readFileSync(join(repo, "docs", "engine-control.json"), "utf8")).request, "stop");
  });
});

test("control POST is rejected without the token", async () => {
  await withServer(async (server) => {
    const res = await postJson(`${server.url}/api/control`, { action: "pause" });
    assert.equal(res.status, 403);
  });
});

test("run and replay spawn detached processes via the injected spawner", async () => {
  await withServer(async (server, repo, spawned) => {
    const token = server.token;

    const run = await postJson(`${server.url}/api/control`, { action: "run" }, { "X-Forge-Token": token });
    assert.equal((run.body as { ok: boolean }).ok, true);

    // No persisted engine config -> default harness for a .agents root.
    const runCall = spawned.calls.at(-1);
    assert.ok(runCall);
    const harnessIndex = runCall.args.indexOf("--harness");
    assert.equal(runCall.args[harnessIndex + 1], "opencode");

    const replay = await postJson(`${server.url}/api/control`, { action: "replay", taskId: "1.2" }, { "X-Forge-Token": token });
    assert.equal((replay.body as { ok: boolean }).ok, true);
  });
});

test("run infers the copilot engine harness from a GitHub harness root", async () => {
  await withServer(async (server, repo, spawned) => {
    renameSync(join(repo, ".agents"), join(repo, ".github"));

    const run = await postJson(`${server.url}/api/control`, { action: "run" }, { "X-Forge-Token": server.token });
    assert.equal((run.body as { ok: boolean }).ok, true);

    const runCall = spawned.calls.at(-1);
    assert.ok(runCall);
    const harnessIndex = runCall.args.indexOf("--harness");
    assert.equal(runCall.args[harnessIndex + 1], "copilot");
  });
});

test("set a single task's timeout and persist it to the manifest", async () => {
  await withServer(async (server, repo) => {
    const token = server.token;
    const res = await postJson(`${server.url}/api/tasks/timeout`, { taskId: "1.2", timeoutMs: 900000 }, { "X-Forge-Token": token });
    assert.equal((res.body as { ok: boolean }).ok, true);

    const manifest = JSON.parse(readFileSync(join(repo, "docs", "EXECUTION-MANIFEST.json"), "utf8")) as { phases: Array<{ tasks: Array<{ id: string; timeoutMs?: number }> }> };
    const task = manifest.phases.flatMap((p) => p.tasks).find((t) => t.id === "1.2");
    assert.equal(task!.timeoutMs, 900000);

    const tasks = await getJson(`${server.url}/api/tasks`) as Array<{ id: string; timeoutMs: number | null }>;
    assert.equal(tasks.find((t) => t.id === "1.2")!.timeoutMs, 900000);
  });
});

test("set all task timeouts and update the engine default", async () => {
  await withServer(async (server, repo) => {
    const token = server.token;
    const res = await postJson(`${server.url}/api/tasks/timeout`, { timeoutMs: 1200000 }, { "X-Forge-Token": token });
    assert.equal((res.body as { ok: boolean }).ok, true);
    assert.equal((res.body as { affected: number }).affected, 2);

    const manifest = JSON.parse(readFileSync(join(repo, "docs", "EXECUTION-MANIFEST.json"), "utf8")) as { phases: Array<{ tasks: Array<{ timeoutMs?: number }> }> };
    for (const task of manifest.phases.flatMap((p) => p.tasks)) {
      assert.equal(task.timeoutMs, 1200000);
    }

    const config = JSON.parse(readFileSync(join(repo, "docs", "engine-config.json"), "utf8")) as { taskTimeoutMs: string };
    assert.equal(config.taskTimeoutMs, "1200000");

    const summary = await getJson(`${server.url}/api/summary`) as { defaultTimeoutMs: number };
    assert.equal(summary.defaultTimeoutMs, 1200000);
  });
});

test("setting the engine default timeout persists the copilot harness on a GitHub repo", async () => {
  await withServer(async (server, repo) => {
    renameSync(join(repo, ".agents"), join(repo, ".github"));

    const res = await postJson(`${server.url}/api/tasks/timeout`, { timeoutMs: 900000 }, { "X-Forge-Token": server.token });
    assert.equal((res.body as { ok: boolean }).ok, true);

    const config = JSON.parse(readFileSync(join(repo, "docs", "engine-config.json"), "utf8")) as { harness: string };
    assert.equal(config.harness, "copilot");
  });
});

test("timeout update rejects invalid values and missing token", async () => {
  await withServer(async (server) => {
    const token = server.token;

    const zero = await postJson(`${server.url}/api/tasks/timeout`, { timeoutMs: 0 }, { "X-Forge-Token": token });
    assert.equal(zero.status, 400);

    const nan = await postJson(`${server.url}/api/tasks/timeout`, { timeoutMs: "lots" }, { "X-Forge-Token": token });
    assert.equal(nan.status, 400);

    const unauth = await postJson(`${server.url}/api/tasks/timeout`, { timeoutMs: 1000 });
    assert.equal(unauth.status, 403);
  });
});

test("PRD, team, and manifest actions dispatch and return ok", async () => {
  await withServer(async (server, repo, spawned) => {
    const token = server.token;

    const prd = await postJson(`${server.url}/api/control`, { action: "draft-prd" }, { "X-Forge-Token": token });
    assert.equal((prd.body as { ok: boolean }).ok, true);
    assert.ok((prd.body as { message: string }).message.includes("PRD"), "message should mention PRD");

    const existingPrd = await postJson(`${server.url}/api/control`, { action: "draft-existing-prd" }, { "X-Forge-Token": token });
    assert.equal((existingPrd.body as { ok: boolean }).ok, true);
    assert.ok(spawned.calls.at(-1)?.args.includes("draft-existing-prd"), "existing-project PRD action should spawn its dedicated subcommand");

    const team = await postJson(`${server.url}/api/control`, { action: "draft-team" }, { "X-Forge-Token": token });
    assert.equal((team.body as { ok: boolean }).ok, true);
    assert.ok((team.body as { message: string }).message.includes("team"), "message should mention team");

    renameSync(join(repo, "docs", "EXECUTION-MANIFEST.json"), join(repo, "docs", "EXECUTION-MANIFEST.json.bak"));
    const compile = await postJson(`${server.url}/api/control`, { action: "compile-manifest" }, { "X-Forge-Token": token });
    assert.equal((compile.body as { ok: boolean }).ok, true);
    assert.ok((compile.body as { message: string }).message.includes("Manifest"), "message should mention manifest");
    assert.ok(spawned.calls.at(-1)?.args.includes("compile-manifest"), "compile-manifest action should spawn the compile-manifest subcommand");
    for (const call of spawned.calls.slice(-3)) {
      assert.equal(call.opts.logFile, join(repo, "docs", "engine-run.log"));
    }
  });
});

test("feature-increment accepts a prompt and optional run flag", async () => {
  await withServer(async (server, repo, spawned) => {
    const token = server.token;
    const missing = await postJson(`${server.url}/api/control`, { action: "feature-increment" }, { "X-Forge-Token": token });
    assert.equal(missing.status, 400);

    const result = await postJson(`${server.url}/api/control`, {
      action: "feature-increment",
      prompt: "Add a search screen",
      run: true,
    }, { "X-Forge-Token": token });
    assert.equal((result.body as { ok: boolean }).ok, true);
    const call = spawned.calls.at(-1);
    assert.ok(call?.args.includes("feature-increment"));
    assert.ok(call?.args.includes("--prompt"));
    assert.ok(call?.args.includes("Add a search screen"));
    assert.ok(call?.args.includes("--run"));
    assert.equal((result.body as { job: { type: string; run: boolean } }).job.type, "feature-increment");
    assert.equal((result.body as { job: { type: string; run: boolean } }).job.run, true);
    assert.equal(call?.opts.cwd, repo);
  });
});

test("project list, add, and select round-trip through the registry", async () => {
  await withServer(async (server, repo) => {
    const token = server.token;
    const projects = await getJson(`${server.url}/api/projects`) as { projects: Array<{ path: string }>; current: string | null };
    assert.equal(projects.current, repo);
    assert.ok(projects.projects.some((p) => p.path === repo));

    const add = await postJson(`${server.url}/api/projects/add`, { path: repo }, { "X-Forge-Token": token });
    assert.equal((add.body as { ok: boolean }).ok, true);
  });
});

test("artifact content path traversal is rejected", async () => {
  await withServer(async (server) => {
    const res = await getJson(`${server.url}/api/artifact/content?path=..%2F..%2Fetc%2Fpasswd`);
    assert.equal(res, null);
  });
});

test("POST /api/uploads stages uploaded content to a temp file and returns its path", async () => {
  await withServer(async (server) => {
    const token = server.token;
    const res = await postJson(`${server.url}/api/uploads`, { name: "market research.md", content: "# Research\n\nSeed doc.\n" }, { "X-Forge-Token": token });
    const body = res.body as { ok: boolean; path?: string; name?: string };
    assert.equal(body.ok, true);
    assert.ok(body.path && existsSync(body.path), "staged file should exist");
    assert.equal(readFileSync(body.path!, "utf8"), "# Research\n\nSeed doc.\n");
    assert.equal(body.name, "market_research.md");
  });
});

test("createProject passes FORGE_PRD_FILE and FORGE_RESEARCH_FILES to the launcher", async () => {
  await withServer(async (server, repo, spawned) => {
    const token = server.token;
    const prd = join(repo, "PRD.md");
    const research = join(repo, "research.md");
    writeFileSync(prd, "# PRD\n", "utf8");
    writeFileSync(research, "# Seed\n", "utf8");

    const res = await postJson(`${server.url}/api/projects/create`, {
      name: "my-app",
      idea: "Build an app.",
      parentDir: "/tmp",
      prdPath: prd,
      researchPaths: [research],
    }, { "X-Forge-Token": token });
    assert.equal((res.body as { ok: boolean }).ok, true);

    const call = spawned.calls.at(-1);
    assert.ok(call);
    assert.equal(call.opts.env!.FORGE_PRD_FILE, prd);
    assert.equal(call.opts.env!.FORGE_RESEARCH_FILES, research);
  });
});

test("createProject rejects a missing PRD path", async () => {
  await withServer(async (server) => {
    const token = server.token;
    const res = await postJson(`${server.url}/api/projects/create`, {
      name: "my-app",
      idea: "Build an app.",
      prdPath: "/does/not/exist.md",
    }, { "X-Forge-Token": token });
    assert.equal(res.status, 400);
    assert.match((res.body as { message: string }).message, /PRD file not found/);
  });
});

test("createProject rejects non-integer concurrency values", async () => {
  await withServer(async (server) => {
    const token = server.token;
    const fraction = await postJson(`${server.url}/api/projects/create`, {
      name: "my-app",
      idea: "Build an app.",
      concurrency: 2.5,
    }, { "X-Forge-Token": token });
    assert.equal(fraction.status, 400);
    assert.match((fraction.body as { message: string }).message, /positive integer/);

    const stringValue = await postJson(`${server.url}/api/projects/create`, {
      name: "my-app",
      idea: "Build an app.",
      concurrency: "3",
    }, { "X-Forge-Token": token });
    assert.equal(stringValue.status, 400);
    assert.match((stringValue.body as { message: string }).message, /positive integer/);
  });
});

test("engine-config toggles auto-commit and flows into engine-run args", async () => {
  await withServer(async (server, repo, spawned) => {
    const token = server.token;
    assert.equal((await getJson(`${server.url}/api/summary`) as { autoCommit: boolean }).autoCommit, true);

    const off = await postJson(`${server.url}/api/engine-config`, { autoCommit: false }, { "X-Forge-Token": token });
    assert.equal((off.body as { ok: boolean }).ok, true);
    assert.equal(JSON.parse(readFileSync(join(repo, "docs", "engine-config.json"), "utf8")).autoCommit, false);
    assert.equal((await getJson(`${server.url}/api/summary`) as { autoCommit: boolean }).autoCommit, false);

    const run = await postJson(`${server.url}/api/control`, { action: "run" }, { "X-Forge-Token": token });
    assert.equal((run.body as { ok: boolean }).ok, true);
    assert.ok(spawned.calls.at(-1)!.args.includes("--no-auto-commit"), "engine-run should pass --no-auto-commit");

    const on = await postJson(`${server.url}/api/engine-config`, { autoCommit: true }, { "X-Forge-Token": token });
    assert.equal((on.body as { ok: boolean }).ok, true);
    const run2 = await postJson(`${server.url}/api/control`, { action: "run" }, { "X-Forge-Token": token });
    assert.ok(!spawned.calls.at(-1)!.args.includes("--no-auto-commit"), "default on: no --no-auto-commit flag");
  });
});

test("engine-config sets concurrency and flows into engine-run args", async () => {
  await withServer(async (server, repo, spawned) => {
    const token = server.token;
    assert.equal((await getJson(`${server.url}/api/summary`) as { concurrency: number }).concurrency, 0);

    const set = await postJson(`${server.url}/api/engine-config`, { concurrency: 3 }, { "X-Forge-Token": token });
    assert.equal((set.body as { ok: boolean }).ok, true);
    assert.equal(JSON.parse(readFileSync(join(repo, "docs", "engine-config.json"), "utf8")).concurrency, "3");
    assert.equal((await getJson(`${server.url}/api/summary`) as { concurrency: number }).concurrency, 3);

    const run = await postJson(`${server.url}/api/control`, { action: "run" }, { "X-Forge-Token": token });
    assert.equal((run.body as { ok: boolean }).ok, true);
    const runArgs = spawned.calls.at(-1)!.args;
    const concIdx = runArgs.indexOf("--concurrency");
    assert.ok(concIdx !== -1 && runArgs[concIdx + 1] === "3", "engine-run should pass --concurrency 3");

    // Reset to engine default (0)
    const reset = await postJson(`${server.url}/api/engine-config`, { concurrency: 0 }, { "X-Forge-Token": token });
    assert.equal((reset.body as { ok: boolean }).ok, true);
    assert.equal(JSON.parse(readFileSync(join(repo, "docs", "engine-config.json"), "utf8")).concurrency, "");
    assert.equal((await getJson(`${server.url}/api/summary`) as { concurrency: number }).concurrency, 0);

    const run2 = await postJson(`${server.url}/api/control`, { action: "run" }, { "X-Forge-Token": token });
    assert.ok((run2.body as { ok: boolean }).ok, "engine-run after reset should succeed");
    assert.ok(!spawned.calls.at(-1)!.args.includes("--concurrency"), "no --concurrency arg when at default");
  });
});

test("engine-config stores manual selection and passes it to engine-run", async () => {
  await withServer(async (server, repo, spawned) => {
    const token = server.token;

    const mode = await postJson(`${server.url}/api/engine-config`, { executionMode: "manual" }, { "X-Forge-Token": token });
    assert.equal((mode.body as { ok: boolean }).ok, true);

    const selection = await postJson(`${server.url}/api/engine-config`, {
      selectionScope: "range",
      selectedTaskIds: ["1.1", "1.2"],
    }, { "X-Forge-Token": token });
    assert.equal((selection.body as { ok: boolean }).ok, true);

    const summary = await getJson(`${server.url}/api/summary`) as {
      executionMode: string;
      selectedTaskCount: number;
      selectedTaskIds: string[];
    };
    assert.equal(summary.executionMode, "manual");
    assert.equal(summary.selectedTaskCount, 2);
    assert.deepEqual(summary.selectedTaskIds, ["1.1", "1.2"]);

    const run = await postJson(`${server.url}/api/control`, { action: "run" }, { "X-Forge-Token": token });
    assert.equal((run.body as { ok: boolean }).ok, true);
    assert.equal((run.body as { job?: { type: string } }).job?.type, "engine-run");

    const args = spawned.calls.at(-1)!.args;
    assert.ok(args.includes("--execution-mode"), "engine-run should pass --execution-mode");
    assert.ok(args.includes("manual"), "engine-run should pass manual mode");
    assert.ok(args.includes("--selection-scope"), "engine-run should pass --selection-scope");
    assert.ok(args.includes("range"), "engine-run should pass range scope");
    const taskIdx = args.indexOf("--selected-tasks");
    assert.ok(taskIdx !== -1 && args[taskIdx + 1] === "1.1,1.2", "engine-run should pass the selected task ids");

    const config = JSON.parse(readFileSync(join(repo, "docs", "engine-config.json"), "utf8")) as {
      executionMode: string;
      selectionScope: string;
      selectedTaskIds: string[];
    };
    assert.equal(config.executionMode, "manual");
    assert.equal(config.selectionScope, "range");
    assert.deepEqual(config.selectedTaskIds, ["1.1", "1.2"]);
  });
});

test("manual mode requires at least one selected task before run/resume", async () => {
  await withServer(async (server) => {
    const token = server.token;
    const mode = await postJson(`${server.url}/api/engine-config`, { executionMode: "manual" }, { "X-Forge-Token": token });
    assert.equal((mode.body as { ok: boolean }).ok, true);
    const clear = await postJson(`${server.url}/api/engine-config`, { selectionScope: null, selectedTaskIds: [] }, { "X-Forge-Token": token });
    assert.equal((clear.body as { ok: boolean }).ok, true);

    const run = await postJson(`${server.url}/api/control`, { action: "run" }, { "X-Forge-Token": token });
    assert.equal((run.body as { ok: boolean }).ok, false);
    assert.match((run.body as { message: string }).message, /Manual mode is enabled/);

    const resume = await postJson(`${server.url}/api/control`, { action: "resume" }, { "X-Forge-Token": token });
    assert.equal((resume.body as { ok: boolean }).ok, false);
    assert.match((resume.body as { message: string }).message, /Manual mode is enabled/);
  });
});

test("manual resume accepts paused state selection when config selection is empty", async () => {
  await withServer(async (server, repo) => {
    const token = server.token;
    const docs = join(repo, "docs");
    const pausedState = {
      runId: "run-2",
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      manifestPath: join(docs, "EXECUTION-MANIFEST.json"),
      manifestVersion: "1.0",
      harness: "opencode",
      status: "paused",
      currentPhase: "1",
      tasks: {
        "1.1": { taskId: "1.1", status: "complete", ownerAgent: "qa-engineer", attempt: 1, outputFiles: [] },
        "1.2": { taskId: "1.2", status: "pending", ownerAgent: "qa-engineer", attempt: 0, outputFiles: [] },
      },
      blockers: [],
      selection: { mode: "manual", scope: "single", taskIds: ["1.2"] },
    };
    writeFileSync(join(docs, "WORKFLOW-STATE.json"), JSON.stringify(pausedState), "utf8");

    const mode = await postJson(`${server.url}/api/engine-config`, { executionMode: "manual" }, { "X-Forge-Token": token });
    assert.equal((mode.body as { ok: boolean }).ok, true);
    const configPath = join(docs, "engine-config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8")) as { executionMode: string; selectionScope?: string; selectedTaskIds?: string[] };
    delete config.selectionScope;
    config.selectedTaskIds = [];
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

    const resume = await postJson(`${server.url}/api/control`, { action: "resume" }, { "X-Forge-Token": token });
    assert.equal((resume.body as { ok: boolean }).ok, true);
  });
});

test("updating manual selection also updates paused state selection", async () => {
  await withServer(async (server, repo) => {
    const token = server.token;
    const docs = join(repo, "docs");
    const pausedState = {
      runId: "run-2",
      startedAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
      manifestPath: join(docs, "EXECUTION-MANIFEST.json"),
      manifestVersion: "1.0",
      harness: "opencode",
      status: "paused",
      currentPhase: "1",
      tasks: {
        "1.1": { taskId: "1.1", status: "complete", ownerAgent: "qa-engineer", attempt: 1, outputFiles: [] },
        "1.2": { taskId: "1.2", status: "pending", ownerAgent: "qa-engineer", attempt: 0, outputFiles: [] },
      },
      blockers: [],
      selection: { mode: "manual", scope: "single", taskIds: ["1.1"] },
    };
    writeFileSync(join(docs, "WORKFLOW-STATE.json"), JSON.stringify(pausedState), "utf8");

    const mode = await postJson(`${server.url}/api/engine-config`, { executionMode: "manual" }, { "X-Forge-Token": token });
    assert.equal((mode.body as { ok: boolean }).ok, true);

    const selection = await postJson(`${server.url}/api/engine-config`, {
      selectionScope: "single",
      selectedTaskIds: ["1.2"],
    }, { "X-Forge-Token": token });
    assert.equal((selection.body as { ok: boolean }).ok, true);

    const state = JSON.parse(readFileSync(join(docs, "WORKFLOW-STATE.json"), "utf8")) as {
      selection?: { mode: string; scope?: string; taskIds: string[] };
    };
    assert.equal(state.selection?.mode, "manual");
    assert.equal(state.selection?.scope, "single");
    assert.deepEqual(state.selection?.taskIds, ["1.2"]);

    const summary = await getJson(`${server.url}/api/summary`) as { selectedTaskIds: string[]; selectedTaskCount: number };
    assert.deepEqual(summary.selectedTaskIds, ["1.2"]);
    assert.equal(summary.selectedTaskCount, 1);
  });
});

test("launch-cli opens the harness CLI in a terminal (opencode for .agents)", async () => {
  const home = mkdtempSync(join(tmpdir(), "forge-home-"));
  const prevHome = process.env.FORGE_HOME;
  process.env.FORGE_HOME = home;
  const repo = makeRepo();
  const calls: Array<{ cli: string; dir: string; args: string[] }> = [];
  const server = await startConsoleServer({
    repoRoot: repo,
    port: nextPort(),
    open: false,
    onLog: () => {},
    allowExternalOpen: true,
    launchCli: async (cli, dir, args) => { calls.push({ cli, dir, args }); return true; },
  });
  try {
    const res = await postJson(`${server.url}/api/launch-cli`, {}, { "X-Forge-Token": server.token });
    const body = res.body as { ok: boolean; launched?: boolean; cli?: string; command?: string };
    assert.equal(body.ok, true);
    assert.equal(body.launched, true);
    assert.equal(body.cli, "opencode");
    assert.deepEqual(calls, [{ cli: "opencode", dir: repo, args: ["."] }]);
    assert.match(body.command ?? "", /opencode \.$/);
  } finally {
    await server.stop();
    if (prevHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = prevHome;
  }
});

test("launch-cli chooses copilot for a GitHub harness and reports the manual fallback", async () => {
  const home = mkdtempSync(join(tmpdir(), "forge-home-"));
  const prevHome = process.env.FORGE_HOME;
  process.env.FORGE_HOME = home;
  const repo = makeRepo();
  renameSync(join(repo, ".agents"), join(repo, ".github"));
  const calls: Array<{ cli: string; dir: string; args: string[] }> = [];
  const server = await startConsoleServer({
    repoRoot: repo,
    port: nextPort(),
    open: false,
    onLog: () => {},
    allowExternalOpen: true,
    launchCli: async (cli, dir, args) => { calls.push({ cli, dir, args }); return false; },
  });
  try {
    const res = await postJson(`${server.url}/api/launch-cli`, {}, { "X-Forge-Token": server.token });
    const body = res.body as { ok: boolean; launched?: boolean; cli?: string; command?: string };
    assert.equal(body.launched, false);
    assert.equal(body.cli, "copilot");
    assert.deepEqual(calls, [{ cli: "copilot", dir: repo, args: [] }]);
    assert.match(body.message ?? "", /run it manually/);
    assert.match(body.command ?? "", /copilot/);

    const unauth = await postJson(`${server.url}/api/launch-cli`, {});
    assert.equal(unauth.status, 403);
  } finally {
    await server.stop();
    if (prevHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = prevHome;
  }
});

test("model planning endpoint launches the selected interactive CLI", async () => {
  await withServer(async (server, repo) => {
    const calls: Array<{ cli: string; dir: string; args: string[] }> = [];
    // This test uses a second server seam because the shared fixture intentionally
    // does not enable external terminal launches.
    await server.stop();
    const replacement = await startConsoleServer({
      repoRoot: repo,
      port: nextPort(),
      open: false,
      allowExternalOpen: true,
      onLog: () => {},
      launchCli: async (cli, dir, args) => { calls.push({ cli, dir, args }); return true; },
    });
    try {
      const result = await postJson(`${replacement.url}/api/model-plan/terminal`, { provider: "copilot", message: "Review MODEL-PLAN.md" }, { "X-Forge-Token": replacement.token });
      assert.equal((result.body as { ok: boolean }).ok, true);
      assert.deepEqual(calls[0], { cli: "copilot", dir: repo, args: ["-i", "Review MODEL-PLAN.md"] });
    } finally {
      await replacement.stop();
    }
  });
});
