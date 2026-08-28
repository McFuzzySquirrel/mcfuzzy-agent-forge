import { test } from "node:test";
import assert from "node:assert/strict";
import { describeSpawnError, hyperlink, link, runCommand } from "./format.ts";

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
