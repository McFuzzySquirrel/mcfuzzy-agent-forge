import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { shouldKeepAlive, remainingTaskCount } from "./keepalive.ts";

test("retired explicit, environment, and persisted harness selections fail with migration guidance", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-retired-harness-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "EXECUTION-MANIFEST.json"), JSON.stringify({ phases: [] }));
  for (const selection of ["explicit", "environment", "persisted"]) {
    writeFileSync(join(root, "docs", "engine-config.json"), JSON.stringify({ harness: selection === "persisted" ? "flowforge-kernel" : "opencode" }));
    const env = { ...process.env };
    delete env.FORGE_ENGINE_HARNESS;
    if (selection === "environment") env.FORGE_ENGINE_HARNESS = "flowforge-kernel";
    const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./cli.ts", import.meta.url)),
      "run", "--repo", root, "--yes", ...(selection === "explicit" ? ["--harness", "flowforge-kernel"] : [])],
    { encoding: "utf8", env });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr + result.stdout, /flowforge-kernel harness is retired/);
    assert.match(result.stderr + result.stdout, /engine-config\.json/);
    assert.match(result.stderr + result.stdout, /artifacts are preserved/);
  }
});

test("shouldKeepAlive: --attach URL reuses the existing server (never starts one)", () => {
  const d = shouldKeepAlive({ attachUrl: "http://127.0.0.1:4096", keepAlive: false, noKeepAlive: false, harness: "opencode", remaining: 10 });
  assert.equal(d.mode, "attach");
  assert.equal(d.startServer, false);
});

test("shouldKeepAlive: explicit --keep-alive forces the server on", () => {
  const d = shouldKeepAlive({ attachUrl: undefined, keepAlive: true, noKeepAlive: false, harness: "opencode", remaining: 1 });
  assert.equal(d.mode, "keep-alive");
  assert.equal(d.startServer, true);
});

test("shouldKeepAlive: --keep-alive is ignored for non-opencode harnesses", () => {
  const d = shouldKeepAlive({ attachUrl: undefined, keepAlive: true, noKeepAlive: false, harness: "copilot", remaining: 5 });
  assert.equal(d.mode, "keep-alive");
  assert.equal(d.startServer, false);
});

test("shouldKeepAlive: --no-keep-alive forces cold start even with many tasks", () => {
  const d = shouldKeepAlive({ attachUrl: undefined, keepAlive: false, noKeepAlive: true, harness: "opencode", remaining: 10 });
  assert.equal(d.mode, "cold");
  assert.equal(d.startServer, false);
});

test("shouldKeepAlive: --no-keep-alive overrides an explicit --keep-alive", () => {
  const d = shouldKeepAlive({ attachUrl: undefined, keepAlive: true, noKeepAlive: true, harness: "opencode", remaining: 10 });
  assert.equal(d.mode, "cold");
  assert.equal(d.startServer, false);
});

test("shouldKeepAlive: adaptive keep-alive when more than one task remains (opencode)", () => {
  const d = shouldKeepAlive({ attachUrl: undefined, keepAlive: false, noKeepAlive: false, harness: "opencode", remaining: 2 });
  assert.equal(d.mode, "adaptive");
  assert.equal(d.startServer, true);
  assert.equal(d.remaining, 2);
});

test("shouldKeepAlive: cold start when a single task remains (opencode)", () => {
  const d = shouldKeepAlive({ attachUrl: undefined, keepAlive: false, noKeepAlive: false, harness: "opencode", remaining: 1 });
  assert.equal(d.mode, "cold");
  assert.equal(d.startServer, false);
});

test("shouldKeepAlive: adaptive never applies to non-opencode harnesses", () => {
  const d = shouldKeepAlive({ attachUrl: undefined, keepAlive: false, noKeepAlive: false, harness: "copilot", remaining: 10 });
  assert.equal(d.mode, "cold");
  assert.equal(d.startServer, false);
});

test("remainingTaskCount counts fresh (no state) tasks as remaining", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-remaining-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  const manifestPath = join(root, "docs", "EXECUTION-MANIFEST.json");
  writeFileSync(manifestPath, JSON.stringify({
    version: "1.0",
    phases: [
      { id: "A", title: "A", tasks: [{ id: "A.1" }, { id: "A.2" }] },
      { id: "B", title: "B", tasks: [{ id: "B.1" }] },
    ],
  }));

  const remaining = remainingTaskCount(manifestPath, join(root, "docs", "WORKFLOW-STATE.json"));
  assert.equal(remaining, 3);
  assert.ok(existsSync(manifestPath));
});

test("remainingTaskCount excludes complete and skipped tasks from state", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-remaining2-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  const manifestPath = join(root, "docs", "EXECUTION-MANIFEST.json");
  writeFileSync(manifestPath, JSON.stringify({
    version: "1.0",
    phases: [{ id: "A", title: "A", tasks: [{ id: "A.1" }, { id: "A.2" }, { id: "A.3" }] }],
  }));
  const statePath = join(root, "docs", "WORKFLOW-STATE.json");
  writeFileSync(statePath, JSON.stringify({
    tasks: {
      "A.1": { taskId: "A.1", status: "complete" },
      "A.2": { taskId: "A.2", status: "skipped" },
      "A.3": { taskId: "A.3", status: "pending" },
    },
  }));

  assert.equal(remainingTaskCount(manifestPath, statePath), 1);
});

test("remainingTaskCount counts leftover 'running' tasks (crash recovery) as remaining", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-remaining3-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  const manifestPath = join(root, "docs", "EXECUTION-MANIFEST.json");
  writeFileSync(manifestPath, JSON.stringify({
    version: "1.0",
    phases: [{ id: "A", title: "A", tasks: [{ id: "A.1" }, { id: "A.2" }] }],
  }));
  const statePath = join(root, "docs", "WORKFLOW-STATE.json");
  writeFileSync(statePath, JSON.stringify({
    tasks: { "A.1": { taskId: "A.1", status: "running" } },
  }));

  assert.equal(remainingTaskCount(manifestPath, statePath), 2);
});

test("remainingTaskCount can be limited to a selected task set", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-remaining4-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  const manifestPath = join(root, "docs", "EXECUTION-MANIFEST.json");
  writeFileSync(manifestPath, JSON.stringify({
    version: "1.0",
    phases: [{ id: "A", title: "A", tasks: [{ id: "A.1" }, { id: "A.2" }, { id: "A.3" }] }],
  }));
  const statePath = join(root, "docs", "WORKFLOW-STATE.json");
  writeFileSync(statePath, JSON.stringify({
    tasks: {
      "A.1": { taskId: "A.1", status: "complete" },
      "A.2": { taskId: "A.2", status: "pending" },
      "A.3": { taskId: "A.3", status: "pending" },
    },
  }));

  assert.equal(remainingTaskCount(manifestPath, statePath, ["A.1", "A.2"]), 1);
});
