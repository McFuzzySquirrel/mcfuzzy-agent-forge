import assert from "node:assert/strict";
import { test } from "node:test";

import { appendReplay, MAX_REPLAY_BYTES, TRUNCATION_NOTICE } from "./console/dashboard/views/terminal-replay.ts";

test("appendReplay concatenates output that fits within the cap", () => {
  assert.equal(appendReplay("abc", "def", 16), "abcdef");
});

test("appendReplay keeps the newest bytes and adds one truncation notice", () => {
  const result = appendReplay("a".repeat(10), "b".repeat(10), 12);
  assert.ok(result.startsWith(TRUNCATION_NOTICE), "trimmed buffer starts with the notice");
  assert.ok(result.endsWith("b".repeat(10)), "newest bytes are kept");
  assert.equal(result.length, TRUNCATION_NOTICE.length + 12);
});

test("appendReplay does not stack the truncation notice on repeated trims", () => {
  let buffer = "";
  for (let i = 0; i < 5; i += 1) buffer = appendReplay(buffer, "x".repeat(10), 12);
  const notices = buffer.split(TRUNCATION_NOTICE).length - 1;
  assert.equal(notices, 1);
  assert.ok(buffer.length <= TRUNCATION_NOTICE.length + 12);
});

test("appendReplay keeps the default cap bounded", () => {
  const result = appendReplay("", "y".repeat(MAX_REPLAY_BYTES + 500));
  assert.ok(result.length <= TRUNCATION_NOTICE.length + MAX_REPLAY_BYTES);
});
