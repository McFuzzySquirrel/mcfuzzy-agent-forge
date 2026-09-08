import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
// The test launcher must run in plain Node, before TypeScript is loaded.
// @ts-expect-error The standalone JavaScript launcher has no declaration file.
import { discoverTests, runTests } from "./test-runner.mjs";

test("test discovery includes root and nested suites, including paths with spaces", () => {
  const root = mkdtempSync(join(tmpdir(), "forge test discovery "));
  try {
    mkdirSync(join(root, "nested suite"));
    writeFileSync(join(root, "root.test.ts"), "");
    writeFileSync(join(root, "nested suite", "child.test.ts"), "");
    writeFileSync(join(root, "not-a-test.ts"), "");
    assert.deepEqual(discoverTests(root), [join(root, "nested suite", "child.test.ts"), join(root, "root.test.ts")].sort());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the standard test launcher rejects empty discovery", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-empty-tests-"));
  try {
    assert.throws(() => runTests(root), /No test files discovered/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the standard test launcher bounds test files and forwards timeout overrides", (context) => {
  const root = mkdtempSync(join(tmpdir(), "forge-bounded-tests-"));
  const spawn = context.mock.method(childProcess, "spawnSync", () => ({
    pid: 0, output: [], stdout: "", stderr: "", status: 0, signal: null,
  }));
  syncBuiltinESMExports();
  try {
    writeFileSync(join(root, "sample.test.ts"), "");
    assert.equal(runTests(root), 0);
    assert.deepEqual(spawn.mock.calls[0]!.arguments[1], [
      "--import", "tsx", "--test", "--test-timeout=120000", join(root, "sample.test.ts"),
    ]);
    assert.equal(runTests(root, ["--test-timeout=300000"]), 0);
    assert.deepEqual(spawn.mock.calls[1]!.arguments[1], [
      "--import", "tsx", "--test", "--test-timeout=120000", "--test-timeout=300000", join(root, "sample.test.ts"),
    ]);
  } finally {
    spawn.mock.restore();
    syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});
