import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startAttachServer } from "./opencode-server.ts";
import { makeNodeShim } from "../test-support.ts";
import { OpenCodeAdapter } from "./opencode-adapter.ts";
import { prepareTaskRequest } from "../request.ts";

interface Fixture {
  bin: string;
  root: string;
}

/** Builds an executable fake `opencode` shim implementing `serve`. */
function makeShim(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-opencode-server-"));
  return makeNodeShim(dir, "fake-opencode", body);
}

const HEALTHY = `
const http = require("http");
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]);
if (process.env.SHIM_PW_FILE) require("fs").writeFileSync(process.env.SHIM_PW_FILE, String(process.env.OPENCODE_SERVER_PASSWORD ?? ""));
const server = http.createServer((req, res) => {
  if (req.url === "/global/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ healthy: true }));
  } else {
    res.writeHead(404);
    res.end();
  }
});
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
setInterval(() => {}, 1000);
`;

/** Accepts connections but never responds - simulates opencode binding its port before boot completes. */
const HANGS = `
const http = require("http");
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]);
const server = http.createServer(() => { /* never respond */ });
server.listen(port, "127.0.0.1");
setInterval(() => {}, 1000);
`;

function makeFixture(shimBody: string): Fixture {
  const bin = makeShim(shimBody);
  const root = mkdtempSync(join(tmpdir(), "forge-opencode-repo-"));
  return { bin, root };
}

test("startAttachServer becomes healthy, strips ambient server auth, and stops cleanly", async () => {
  const { bin, root } = makeFixture(HEALTHY);
  const pwFile = join(root, "pw-env.txt");

  const original = { ...process.env };
  try {
    // Inject ambient auth so the shim can prove the server env stripped it.
    process.env = { ...process.env, OPENCODE_SERVER_PASSWORD: "super-secret", OPENCODE_SERVER_USERNAME: "forge", SHIM_PW_FILE: pwFile };

    const server = await startAttachServer({ bin, repoRoot: root, timeoutMs: 5_000 });
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);

    const res = await fetch(`${server.url}/global/health`);
    assert.equal(res.status, 200);

    await server.stop();
    // The spawned server must NOT have inherited the ambient password.
    assert.equal(existsSync(pwFile), true, "shim should have written the env it saw");
    assert.equal(readFileSync(pwFile, "utf8"), "", "server env must not contain OPENCODE_SERVER_PASSWORD");
  } finally {
    process.env = original;
  }
});

test("startAttachServer aborts hung health attempts and fails when the server never becomes healthy", async () => {
  const { bin, root } = makeFixture(HANGS);
  const started = Date.now();

  await assert.rejects(
    () => startAttachServer({ bin, repoRoot: root, timeoutMs: 1_000, pollIntervalMs: 50, attemptTimeoutMs: 200 }),
    /did not become healthy within/,
  );
  assert.ok(Date.now() - started < 10_000, "should give up promptly, not hang on a stalled connect");
});

test("OpenCode lifecycle reuses one owned server and never stops an external server", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-attach-lifecycle-"));
  const callsFile = join(root, "serve-calls.txt");
  const argsFile = join(root, "run-args.json");
  const bin = makeNodeShim(root, "opencode", `
const fs = require("fs");
if (process.argv[2] === "run") {
  fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
  process.exit(0);
}
fs.appendFileSync(${JSON.stringify(callsFile)}, "serve\\n");
${HEALTHY}
`);
  const original = process.env.OPENCODE_BIN;
  process.env.OPENCODE_BIN = bin;
  const adapter = new OpenCodeAdapter({ startServer: true });
  const context = { repoRoot: root, runId: "test" };
  try {
    await adapter.prepare(context);
    await adapter.prepare(context);
    const request = prepareTaskRequest({
      agent: { name: "worker", path: join(root, "worker.md"), rawBody: "Worker", description: "", constraints: [], collaboration: [], expertise: [] },
      task: { id: "one", title: "One", description: "One", dependencies: [], expectedOutputs: [], validationCommands: [], approvalRequired: false, sourceLines: [] },
      repoRoot: root,
    });
    assert.equal((await adapter.invoke(request)).success, true);
    assert.equal((await adapter.invoke(request)).success, true);
    assert.equal(readFileSync(callsFile, "utf8"), "serve\n");
    const args = JSON.parse(readFileSync(argsFile, "utf8")) as string[];
    const url = args[args.indexOf("--attach") + 1]!;
    const external = new OpenCodeAdapter({ attachUrl: url, startServer: true });
    await external.prepare(context);
    await external.cleanup();
    assert.equal((await fetch(`${url}/global/health`)).status, 200, "external server stays alive");
    await adapter.cleanup();
    await adapter.cleanup();
    await assert.rejects(fetch(`${url}/global/health`, { signal: AbortSignal.timeout(1000) }));
  } finally {
    await adapter.cleanup();
    if (original === undefined) delete process.env.OPENCODE_BIN;
    else process.env.OPENCODE_BIN = original;
  }
});

test("attach startup cancellation tears down the partially prepared server", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-attach-cancel-"));
  const pidFile = join(root, "pid.txt");
  const bin = makeNodeShim(root, "opencode", `require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));\n${HANGS}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 400);
  try {
    await assert.rejects(startAttachServer({ bin, repoRoot: root, signal: controller.signal, timeoutMs: 5000, pollIntervalMs: 20 }));
    if (existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, "utf8"));
      assert.throws(() => process.kill(pid, 0), "cancelled server must not remain running");
    }
  } finally {
    clearTimeout(timer);
  }
});
