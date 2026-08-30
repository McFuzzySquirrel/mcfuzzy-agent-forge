import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
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
      "1.1": { taskId: "1.1", status: "complete", ownerAgent: "qa-engineer", attempt: 1, outputFiles: ["src/index.ts"], artifactId: "solution-001" },
      "1.2": { taskId: "1.2", status: "running", ownerAgent: "qa-engineer", attempt: 1, outputFiles: [] },
    },
    blockers: ["waiting for review"],
  };
  writeFileSync(join(docs, "WORKFLOW-STATE.json"), JSON.stringify(state), "utf8");
  writeFileSync(join(docs, "EXECUTION-AUDIT.jsonl"), "", "utf8");
  writeFileSync(join(docs, "engine-run.log"), "line one\nline two\n", "utf8");

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
    "---\nname: qa-engineer\ndescription: \"Owns test quality\"\nmodel: gpt-4o\n---\n\n## Expertise\n- Testing\n",
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

function postJson(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
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
  fn: (server: ConsoleServer, repo: string) => Promise<T>,
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
    return await fn(server, repo);
  } finally {
    await server.stop();
    if (prevHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = prevHome;
  }
}

test("serves summary, tasks, docs, team, and actions", async () => {
  await withServer(async (server, repo) => {
    const summary = await getJson(`${server.url}/api/summary`) as { repoName: string; hasPrd: boolean; hasTeam: boolean; run: { status: string; counts: { complete: number; running: number } } };
    assert.equal(summary.repoName, repo.split("/").pop());
    assert.equal(summary.hasPrd, true);
    assert.equal(summary.hasTeam, true);
    assert.equal(summary.run.status, "running");
    assert.equal(summary.run.counts.complete, 1);
    assert.equal(summary.run.counts.running, 1);

    const tasks = await getJson(`${server.url}/api/tasks`) as Array<{ id: string; status: string; phaseTitle: string }>;
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0]!.status, "complete");
    assert.equal(tasks[0]!.phaseTitle, "Foundation");

    const docs = await getJson(`${server.url}/api/docs`) as { entries: Array<{ kind: string }> };
    assert.ok(docs.entries.some((e) => e.kind === "prd"));
    assert.ok(docs.entries.some((e) => e.kind === "idea"));

    const team = await getJson(`${server.url}/api/team`) as { agents: Array<{ name: string; model: string }> };
    assert.equal(team.agents.length, 1);
    assert.equal(team.agents[0]!.name, "qa-engineer");
    assert.equal(team.agents[0]!.model, "gpt-4o");

    const actions = await getJson(`${server.url}/api/actions`) as { canRun: boolean; failedTasks: string[] };
    assert.equal(actions.canRun, false);
    assert.deepEqual(actions.failedTasks, []);
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
  await withServer(async (server, repo) => {
    const token = server.token;

    const run = await postJson(`${server.url}/api/control`, { action: "run" }, { "X-Forge-Token": token });
    assert.equal((run.body as { ok: boolean }).ok, true);

    const replay = await postJson(`${server.url}/api/control`, { action: "replay", taskId: "1.2" }, { "X-Forge-Token": token });
    assert.equal((replay.body as { ok: boolean }).ok, true);
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

test("draft-prd and draft-team actions dispatch and return ok", async () => {
  await withServer(async (server, repo) => {
    const token = server.token;

    const prd = await postJson(`${server.url}/api/control`, { action: "draft-prd" }, { "X-Forge-Token": token });
    assert.equal((prd.body as { ok: boolean }).ok, true);
    assert.ok((prd.body as { message: string }).message.includes("PRD"), "message should mention PRD");

    const team = await postJson(`${server.url}/api/control`, { action: "draft-team" }, { "X-Forge-Token": token });
    assert.equal((team.body as { ok: boolean }).ok, true);
    assert.ok((team.body as { message: string }).message.includes("team"), "message should mention team");
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
