import { test } from "node:test";
import assert from "node:assert/strict";
import { describeSpawnError, runCommand } from "./format.ts";

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
