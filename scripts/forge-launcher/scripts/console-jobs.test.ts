import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get as httpGet, request as httpRequest } from "node:http";
import { test, type TestContext } from "node:test";

import { startConsoleServer } from "./console/server.ts";
import { saveJobs } from "./console/jobs.ts";
import type { BackgroundJob } from "./console/types.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let port = 46800;

/** Isolated FORGE_HOME plus a minimal forge repo, mirroring console-authoring.test.ts. */
function fixture(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "forge-jobs-console-"));
  const prevHome = process.env.FORGE_HOME;
  process.env.FORGE_HOME = join(root, "registry");
  t.after(() => {
    if (prevHome === undefined) delete process.env.FORGE_HOME; else process.env.FORGE_HOME = prevHome;
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "docs"));
  return root;
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

test("/api/jobs returns active and failed counts with the full job list", async (t) => {
  const root = fixture(t);
  const server = await startConsoleServer({ repoRoot: root, port: port++, open: false, onLog: () => {} });
  t.after(() => server.stop());

  const now = new Date().toISOString();
  saveJobs([
    { id: "running-1", type: "create-project", repoPath: root, pid: process.pid, status: "running", startedAt: now, updatedAt: now, message: "Creating…" },
    { id: "paused-1", type: "engine-run", repoPath: root, status: "paused", startedAt: now, updatedAt: now, message: "Paused" },
    { id: "failed-1", type: "bootstrap", repoPath: root, status: "failed", startedAt: now, updatedAt: now, message: "Boom" },
    { id: "complete-1", type: "draft-team", repoPath: root, status: "complete", startedAt: now, updatedAt: now, message: "Done" },
  ]);

  const body = await getJson(`${server.url}/api/jobs`) as { jobs: BackgroundJob[]; active: number; failed: number };
  assert.equal(body.active, 2, "running + paused should count as active");
  assert.equal(body.failed, 1, "only the failed job should count as failed");
  assert.equal(body.jobs.length, 4, "the full job list should be returned");
  assert.deepEqual(body.jobs.map((job) => job.id).sort(), ["complete-1", "failed-1", "paused-1", "running-1"]);
});

test("a jobs SSE event is emitted when a background job is reaped", async (t) => {
  const root = fixture(t);
  const server = await startConsoleServer({ repoRoot: root, port: port++, open: false, onLog: () => {} });
  t.after(() => server.stop());

  const events = collectSse(`${server.url}/api/events`);
  await sleep(150);

  // A running authoring job with no pid is reaped by the poller's refreshJobs().
  const now = new Date().toISOString();
  saveJobs([
    { id: "dead-1", type: "draft-team", repoPath: root, status: "running", startedAt: now, updatedAt: now, message: "Running…" },
  ]);

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && !events.some((event) => event.type === "jobs")) await sleep(50);

  const jobEvents = events.filter((event) => event.type === "jobs");
  assert.ok(jobEvents.length > 0, "a jobs SSE event should be emitted when the job state changes");

  const last = jobEvents.at(-1)!.data as { jobs: BackgroundJob[]; active: number; failed: number };
  assert.equal(last.active, 0, "the reaped job is no longer active");
  assert.equal(last.failed, 1, "the reaped job should now count as failed");
  assert.equal(last.jobs.length, 1);
  assert.equal(last.jobs[0]!.id, "dead-1");
  assert.equal(last.jobs[0]!.status, "failed");
});
