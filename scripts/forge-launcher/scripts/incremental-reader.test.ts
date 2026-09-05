import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, renameSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import fs from "node:fs";

import { IncrementalLineReader } from "./console/incremental-reader.ts";

test("holds split JSONL records and preserves split UTF-8", () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-reader-"));
  const file = join(dir, "events.jsonl");
  writeFileSync(file, '{"message":"caf', "utf8");
  const reader = new IncrementalLineReader();
  assert.deepEqual(reader.read(file).lines, []);

  appendFileSync(file, 'é"}\n{"ok":true}\n', "utf8");
  assert.deepEqual(reader.read(file).lines, ['{"message":"café"}', '{"ok":true}']);
});

test("detects truncation and replacement without replaying old bytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-reader-"));
  const file = join(dir, "events.jsonl");
  writeFileSync(file, "old\n", "utf8");
  const reader = new IncrementalLineReader();
  assert.deepEqual(reader.read(file).lines, ["old"]);

  writeFileSync(file, "new\n", "utf8");
  assert.deepEqual(reader.read(file).lines, ["new"]);

  const replacement = join(dir, "replacement.jsonl");
  writeFileSync(replacement, "replacement\n", "utf8");
  renameSync(replacement, file);
  assert.deepEqual(reader.read(file).lines, ["replacement"]);
});

test("retains an unfinished existing tail when starting at the end", () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-reader-"));
  const file = join(dir, "events.jsonl");
  writeFileSync(file, "complete\nunfinished", "utf8");
  const reader = new IncrementalLineReader();
  reader.reset(file, true);
  assert.deepEqual(reader.read(file).lines, []);

  appendFileSync(file, " record\n", "utf8");
  assert.deepEqual(reader.read(file).lines, ["unfinished record"]);
});

test("does not replay unchanged content when its mtime changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-reader-"));
  const file = join(dir, "events.jsonl");
  writeFileSync(file, "same\n", "utf8");
  const reader = new IncrementalLineReader();
  assert.deepEqual(reader.read(file).lines, ["same"]);

  const future = new Date(Date.now() + 2000);
  utimesSync(file, future, future);
  assert.deepEqual(reader.read(file).lines, []);

  writeFileSync(file, "diff\n", "utf8");
  assert.deepEqual(reader.read(file).lines, ["diff"]);
});

test("propagates non-missing stat failures", () => {
  const reader = new IncrementalLineReader();
  mock.method(fs, "statSync", () => {
    throw Object.assign(new Error("permission denied"), { code: "EACCES" });
  });
  try {
    assert.throws(() => reader.read("/unreadable/events.jsonl"), /permission denied/);
  } finally {
    mock.restoreAll();
  }
});

test("bounds mtime content checks on large append", () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-reader-"));
  const file = join(dir, "large.log");
  writeFileSync(file, Buffer.alloc(2 * 1024 * 1024, 65));
  const reader = new IncrementalLineReader({ maxBytesPerRead: 64 * 1024, partialLinePolicy: "emit" });
  while (reader.read(file).lines.length > 0) {
    // Consume the bounded chunks until the initial file is exhausted.
  }
  appendFileSync(file, "tail");

  const originalRead = fs.readSync.bind(fs);
  let bytesRead = 0;
  mock.method(fs, "readSync", (...args: Parameters<typeof fs.readSync>) => {
    bytesRead += args[2] ?? 0;
    return originalRead(...args);
  });
  try {
    reader.read(file);
  } finally {
    mock.restoreAll();
  }
  assert.ok(bytesRead <= 8192 + 4, `mtime detection read ${bytesRead} bytes`);
});

test("bounds each read and emits ordinary log fragments by explicit policy", () => {
  const dir = mkdtempSync(join(tmpdir(), "forge-reader-"));
  const file = join(dir, "engine.log");
  writeFileSync(file, "abcdef", "utf8");
  const reader = new IncrementalLineReader({ maxBytesPerRead: 2, partialLinePolicy: "emit" });
  assert.deepEqual(reader.read(file).lines, ["ab"]);
  assert.deepEqual(reader.read(file).lines, ["cd"]);
  assert.deepEqual(reader.read(file).lines, ["ef"]);
});
