import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
