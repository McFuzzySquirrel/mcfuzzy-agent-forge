import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clearControl, controlPath, readControl, writeControl } from "./control.ts";

function tmpControl(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-control-"));
  return controlPath(dir);
}

test("control file round-trips pause and stop requests", () => {
  const path = tmpControl();
  assert.equal(readControl(path), null);

  writeControl(path, "pause");
  assert.equal(readControl(path), "pause");

  writeControl(path, "stop");
  assert.equal(readControl(path), "stop");

  clearControl(path);
  assert.equal(readControl(path), null);
});

test("control file records a requestedAt timestamp", () => {
  const path = tmpControl();
  writeControl(path, "stop");
  const raw = JSON.parse(readFileSync(path, "utf8")) as { request: string; requestedAt?: string };
  assert.equal(raw.request, "stop");
  assert.ok(raw.requestedAt, "requestedAt should be set");
});

test("readControl tolerates a missing, empty, or corrupt file", () => {
  const path = tmpControl();
  assert.equal(readControl(path), null);

  const empty = join(tmpdir(), "forge-control-empty.json");
  clearControl(empty);
  assert.equal(readControl(empty), null);
});
