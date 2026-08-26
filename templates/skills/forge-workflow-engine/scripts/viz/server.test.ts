import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get as httpGet, request as httpRequest } from "node:http";

import { startVizServer, type VizServer } from "./server.ts";
import type { AuditEvent, WorkflowState } from "../types.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let portCounter = 0;
function nextPort(): number {
  return 43123 + portCounter++ % 50;
}

function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-viz-"));
  mkdirSync(join(root, "docs"), { recursive: true });

  const manifest = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    repoRoot: root,
    harnessRoot: ".opencode",
    prdPath: join(root, "docs", "PRD.md"),
    progressPath: join(root, "docs", "PROGRESS.md"),
    auditPath: join(root, "docs", "EXECUTION-AUDIT.jsonl"),
    validationCommands: [],
    approvalGates: { preflight: true, betweenPhases: true },
    phases: [
      {
        id: "1",
        title: "Foundation",
        description: "",
        ownerAgents: ["worker"],
        dependencies: [],
        approvalRequired: false,
        tasks: [
          { id: "1.1", title: "Dig", description: "", dependencies: [], expectedOutputs: [], validationCommands: [], approvalRequired: false, sourceLines: [], produces: "work.1.1" },
          { id: "1.2", title: "Stash", description: "", ownerAgent: "worker", dependencies: ["1.1"], inputs: ["work.1.1"], expectedOutputs: [], validationCommands: [], approvalRequired: false, sourceLines: [] },
        ],
      },
    ],
    warnings: [],
  };
  writeFileSync(join(root, "docs", "EXECUTION-MANIFEST.json"), JSON.stringify(manifest), "utf8");

  const state: WorkflowState = {
    runId: "test-run",
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    manifestPath: join(root, "docs", "EXECUTION-MANIFEST.json"),
    manifestVersion: "1.0",
    harness: "stub",
    status: "running",
    tasks: {
      "1.1": { taskId: "1.1", status: "complete", attempt: 1, outputFiles: [] },
      "1.2": { taskId: "1.2", status: "pending", ownerAgent: "worker", attempt: 0, outputFiles: [] },
    },
    blockers: [],
    auditLog: [],
  };
  writeFileSync(join(root, "docs", "WORKFLOW-STATE.json"), JSON.stringify(state), "utf8");
  writeFileSync(join(root, "docs", "EXECUTION-AUDIT.jsonl"), "", "utf8");

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

interface SseCollector {
  events: Array<{ type: string; data: unknown }>;
  waitFor(predicate: (e: { type: string; data: unknown }) => boolean, timeoutMs?: number): Promise<boolean>;
}

function collectSse(url: string): SseCollector {
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
  req.on("error", () => { /* socket resets when the server shuts down; expected */ });
  req.end();
  return {
    events,
    async waitFor(predicate, timeoutMs = 3000) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (events.some(predicate)) return true;
        await sleep(25);
      }
      return events.some(predicate);
    },
  };
}

async function withServer<T>(
  source: "in-process" | "tail",
  fn: (server: VizServer, repo: string) => Promise<T>,
): Promise<T> {
  const repo = makeRepo();
  const server = await startVizServer({
    repoRoot: repo,
    manifestPath: join(repo, "docs", "EXECUTION-MANIFEST.json"),
    statePath: join(repo, "docs", "WORKFLOW-STATE.json"),
    auditPath: join(repo, "docs", "EXECUTION-AUDIT.jsonl"),
    port: nextPort(),
    source,
    onLog: () => {},
    keepAliveMs: 40,
  });
  try {
    return await fn(server, repo);
  } finally {
    await server.stop();
  }
}

test("serves manifest, state, and layout JSON endpoints", async () => {
  await withServer("in-process", async (server) => {
    const manifest = await getJson(`${server.url}/api/manifest`) as { version: string };
    assert.equal(manifest.version, "1.0");

    const state = await getJson(`${server.url}/api/state`) as { status: string };
    assert.equal(state.status, "running");

    const layout = await getJson(`${server.url}/api/layout`) as { trunkX: number; tasks: unknown[] };
    assert.equal(typeof layout.trunkX, "number");
    assert.equal(layout.tasks.length, 2);
  });
});

test("streams a snapshot then audit events over SSE (in-process broadcast)", async () => {
  await withServer("in-process", async (server) => {
    const collector = collectSse(`${server.url}/api/events`);
    await sleep(200);

    const audit: AuditEvent = {
      timestamp: new Date().toISOString(),
      action: "task.complete",
      runId: "test-run",
      taskId: "1.2",
      phaseId: "1",
      durationMs: 42,
    };
    server.broadcast(audit);

    const sawSnapshot = await collector.waitFor((e) => e.type === "snapshot");
    assert.ok(sawSnapshot, "expected a snapshot event first");
    const snap = collector.events.find((e) => e.type === "snapshot")!.data as { manifest: { version: string } };
    assert.equal(snap.manifest.version, "1.0");

    const sawAudit = await collector.waitFor(
      (e) => e.type === "audit" && (e.data as AuditEvent).action === "task.complete",
    );
    assert.ok(sawAudit, "expected the broadcast audit event");
  });
});

test("tail source emits events appended to the audit file", async () => {
  await withServer("tail", async (server, repo) => {
    const collector = collectSse(`${server.url}/api/events`);
    await sleep(250);

    const audit: AuditEvent = {
      timestamp: new Date().toISOString(),
      action: "task.started",
      runId: "test-run",
      taskId: "1.2",
    };
    appendFileSync(join(repo, "docs", "EXECUTION-AUDIT.jsonl"), `${JSON.stringify(audit)}\n`, "utf8");

    const saw = await collector.waitFor(
      (e) => e.type === "audit" && (e.data as AuditEvent).action === "task.started",
    );
    assert.ok(saw, "tail source should emit the appended task.started event");
  });
});

test("stop() emits a done event and the server closes", async () => {
  await withServer("in-process", async (server) => {
    const collector = collectSse(`${server.url}/api/events`);
    await sleep(200);
    await server.stop();
    const sawDone = await collector.waitFor((e) => e.type === "done");
    assert.ok(sawDone, "expected a done event before the server closed");
  });
});

test("port is bounded: starting twice yields two distinct live servers", async () => {
  const repo = makeRepo();
  const opts = {
    repoRoot: repo,
    manifestPath: join(repo, "docs", "EXECUTION-MANIFEST.json"),
    statePath: join(repo, "docs", "WORKFLOW-STATE.json"),
    auditPath: join(repo, "docs", "EXECUTION-AUDIT.jsonl"),
    port: nextPort(),
    onLog: () => {},
    keepAliveMs: 40,
  };
  const a = await startVizServer(opts);
  const b = await startVizServer(opts);
  try {
    assert.notEqual(a.port, b.port);
    assert.equal(typeof a.url, "string");
  } finally {
    await Promise.all([a.stop(), b.stop()]);
  }
});
