import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describeSpawnError, hyperlink, link, runCommand, spawnDetached } from "./format.ts";

test("runCommand rejects with a friendly message when the command is missing", async () => {
  await assert.rejects(
    runCommand("definitely-not-a-real-forge-command-xyz", []),
    /Failed to run 'definitely-not-a-real-forge-command-xyz': .* is it installed and on PATH/,
  );
});

test("describeSpawnError adds an ENOENT hint and keeps the original message", () => {
  const err = new Error("spawn opencode ENOENT");
  (err as NodeJS.ErrnoException).code = "ENOENT";
  const wrapped = describeSpawnError("opencode", err);
  assert.ok(wrapped.message.startsWith("Failed to run 'opencode': spawn opencode ENOENT"));
  assert.ok(wrapped.message.includes("is it installed and on PATH?"));
});

test("describeSpawnError leaves non-ENOENT errors without a hint", () => {
  const err = new Error("boom");
  (err as NodeJS.ErrnoException).code = "EACCES";
  assert.equal(describeSpawnError("git", err).message, "Failed to run 'git': boom");
});

test("hyperlink wraps a path in an OSC 8 terminal link", () => {
  const h = hyperlink("/tmp/foo.md");
  assert.ok(h.startsWith("\x1b]8;;file:///tmp/foo.md\x1b\\"), h);
  assert.ok(h.endsWith("\x1b]8;;\x1b\\"), h);
  assert.ok(h.includes("/tmp/foo.md"), h);
  assert.equal(hyperlink("/tmp/foo.md", "Review me"), `\x1b]8;;file:///tmp/foo.md\x1b\\Review me\x1b]8;;\x1b\\`);
});

test("link falls back to the bare path when stdout is not a TTY", () => {
  // Tests run with stdout piped, so useColor is false -> plain path.
  assert.equal(link("/tmp/foo.md"), "/tmp/foo.md");
});

test("reports an asynchronous detached startup failure to the callback once", async () => {
  let calls = 0;
  spawnDetached("definitely-not-a-real-forge-command-xyz", [], {
    onStartupError: () => {
      calls += 1;
      throw new Error("callback failure");
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(calls, 1);
});

test("detached children keep shared and separate logs after all parent descriptors close", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-detached-"));
  const open = t.mock.method(fs, "openSync");
  const close = t.mock.method(fs, "closeSync");
  const outputs: string[] = [];
  try {
    for (let index = 0; index < 3; index += 1) {
      const shared = path.join(root, `shared-${index}.log`);
      const stdout = path.join(root, `stdout-${index}.log`);
      const stderr = path.join(root, `stderr-${index}.log`);
      const args = ["-e", 'process.stdout.write("out"); process.stderr.write("err");'];
      assert.ok(spawnDetached(process.execPath, args, { logFile: shared }).pid);
      assert.ok(spawnDetached(process.execPath, args, { outFile: stdout, errFile: stderr }).pid);
      outputs.push(shared, stdout, stderr);
    }
    assert.equal(open.mock.callCount(), 9);
    assert.equal(close.mock.callCount(), 9);
    open.mock.restore();
    close.mock.restore();
    for (let attempt = 0; attempt < 100 && outputs.some((file) => fs.statSync(file).size < (path.basename(file).startsWith("shared") ? 6 : 3)); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    for (const file of outputs) {
      assert.equal(fs.readFileSync(file, "utf8"), path.basename(file).startsWith("shared") ? "outerr" : path.basename(file).startsWith("stdout") ? "out" : "err");
    }
  } finally {
    open.mock.restore();
    close.mock.restore();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("partial detached log opens close the first descriptor and preserve the open error", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-detached-"));
  const originalOpen = fs.openSync;
  const openError = new Error("second open failed");
  let opens = 0;
  const open = t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
    if (++opens === 2) throw openError;
    return originalOpen(...args);
  });
  const close = t.mock.method(fs, "closeSync");
  try {
    assert.throws(() => spawnDetached(process.execPath, [], {
      outFile: path.join(root, "out.log"), errFile: path.join(root, "err.log"),
    }), (error) => error === openError);
    assert.equal(close.mock.callCount(), 1);
  } finally {
    open.mock.restore();
    close.mock.restore();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("synchronous spawn failures survive cleanup errors and close every descriptor", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "forge-detached-"));
  const originalClose = fs.closeSync;
  const close = t.mock.method(fs, "closeSync", (fd: number) => {
    originalClose(fd);
    throw new Error("close failed");
  });
  let startupError: Error | undefined;
  try {
    const result = spawnDetached(process.execPath, ["\0"], {
      outFile: path.join(root, "out.log"), errFile: path.join(root, "err.log"),
      onStartupError: (error) => { startupError = error; },
    });
    assert.equal(result.pid, undefined);
    assert.match(startupError?.message ?? "", /Failed to run/);
    assert.doesNotMatch(startupError?.message ?? "", /close failed/);
    assert.equal(close.mock.callCount(), 2);
  } finally {
    close.mock.restore();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
