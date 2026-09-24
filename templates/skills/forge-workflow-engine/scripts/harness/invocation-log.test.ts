import assert from "node:assert/strict";
import test from "node:test";

import {
  ActivityLineBuffer,
  formatActivityLine,
  formatCompletionLine,
  formatInvocationLine,
  redactArgs,
  redactText,
  type HarnessInvocationContext,
} from "./invocation-log.ts";

const ctx: HarnessInvocationContext = {
  harness: "copilot",
  runId: "run-1",
  taskId: "1.2",
  attempt: 3,
  cwd: "/home/user/my project",
};

test("formatInvocationLine records the executable, argv, cwd, and identifiers", () => {
  const line = formatInvocationLine(ctx, "copilot", ["-p", "do the thing", "--agent", "scanner"], "requested", "2026-09-23T00:00:00.000Z");
  assert.match(line, /\[engine] harness invocation \[requested]/);
  assert.match(line, /at=2026-09-23T00:00:00\.000Z/);
  assert.match(line, /harness=copilot/);
  assert.match(line, /run=run-1/);
  assert.match(line, /task=1\.2/);
  assert.match(line, /attempt=3/);
  assert.ok(line.includes(`cwd=${JSON.stringify("/home/user/my project")}`), line);
  assert.ok(line.includes(`exec="copilot"`), line);
  assert.ok(line.includes(`args=${JSON.stringify(["-p", "do the thing", "--agent", "scanner"])}`), line);
});

test("formatInvocationLine preserves argument boundaries and escapes multiline prompts", () => {
  const prompt = "line one\nline two \"quoted\"";
  const line = formatInvocationLine(ctx, "copilot", ["-p", prompt], "requested");
  // JSON escaping keeps the prompt on one line and its newline explicit.
  assert.ok(line.includes(`args=${JSON.stringify(["-p", prompt])}`), line);
  assert.ok(!line.slice(line.indexOf("args=")).includes("\n"), "invocation must be a single line");
  assert.ok(line.includes("line two"), line);
});

test("formatInvocationLine marks the effective invocation after launcher resolution", () => {
  const line = formatInvocationLine(ctx, "node.exe", ["/shim/copilot.cjs", "-p", "x"], "effective");
  assert.match(line, /\[engine] harness invocation \[effective]/);
  assert.ok(line.includes(JSON.stringify("node.exe")));
});

test("redactArgs redacts secret flag values but preserves other arguments", () => {
  assert.deepEqual(redactArgs(["--token", "abc123", "--agent", "scanner"]), ["--token", "[REDACTED]", "--agent", "scanner"]);
  assert.deepEqual(redactArgs(["--api-key=abc123", "--agent", "scanner"]), ["--api-key=[REDACTED]", "--agent", "scanner"]);
  assert.deepEqual(redactArgs(["--access-key", "AKIAEXAMPLE", "-p", "prompt"]), ["--access-key", "[REDACTED]", "-p", "prompt"]);
});

test("redactArgs masks inline credentials anywhere in an argument", () => {
  const redacted = redactArgs(["-p", "use key sk-abcdefghijklmnop1234 and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"]);
  assert.equal(redacted[0], "-p");
  assert.ok(redacted[1]!.includes("[REDACTED]"), redacted[1]);
  assert.ok(!redacted[1]!.includes("sk-abcdefghijklmnop1234"), redacted[1]);
  assert.ok(!redacted[1]!.includes("ghp_"), redacted[1]);
});

test("redactText keeps a recognizable Bearer prefix and masks the credential", () => {
  const result = redactText("Authorization: Bearer abc.def.ghi");
  assert.ok(result.includes("Bearer [REDACTED]"), result);
  assert.ok(!result.includes("abc.def.ghi"), result);
});

test("formatActivityLine tags the stream, task, and attempt", () => {
  const line = formatActivityLine(ctx, "stderr", "boom", "2026-09-23T00:00:01.000Z");
  assert.match(line, /\[engine] harness activity stderr/);
  assert.match(line, /task=1\.2/);
  assert.match(line, /attempt=3/);
  assert.match(line, /at=2026-09-23T00:00:01\.000Z/);
  assert.ok(line.endsWith(" boom"), line);
});

test("formatCompletionLine records status, failure kind, and duration", () => {
  const line = formatCompletionLine(ctx, { status: null, error: "timed out", failureKind: "timeout", durationMs: 1500 }, "2026-09-23T00:00:02.000Z");
  assert.match(line, /harness completed/);
  assert.match(line, /status=none/);
  assert.match(line, /kind=timeout/);
  assert.match(line, /durationMs=1500/);
  assert.ok(line.includes(`error=${JSON.stringify("timed out")}`), line);
});

test("ActivityLineBuffer splits chunks into lines and strips control sequences", () => {
  const lines: string[] = [];
  const buffer = new ActivityLineBuffer((line) => lines.push(line));
  buffer.write("\u001b[32mstarting\u001b[0m\npartial");
  buffer.write(" rest\n");
  buffer.flush();
  assert.deepEqual(lines, ["starting", "partial rest"]);
});

test("ActivityLineBuffer converts carriage-return progress to lines", () => {
  const lines: string[] = [];
  const buffer = new ActivityLineBuffer((line) => lines.push(line));
  buffer.write("10%\r20%\r100%\n");
  buffer.flush();
  assert.deepEqual(lines, ["10%", "20%", "100%"]);
});

test("ActivityLineBuffer truncates long lines with an explicit marker", () => {
  const lines: string[] = [];
  const buffer = new ActivityLineBuffer((line) => lines.push(line), 10);
  buffer.write("abcdefghijklmnopqrstuvwxyz\n");
  buffer.flush();
  assert.equal(lines.length, 1);
  assert.equal(lines[0], "abcdefghij…[truncated 16 chars]");
});

test("ActivityLineBuffer suppresses further activity after the byte budget", () => {
  const lines: string[] = [];
  const buffer = new ActivityLineBuffer((line) => lines.push(line), 4000, 12);
  buffer.write("abcdefgh\n");
  buffer.write("ijklmnop\n");
  buffer.write("qrstuvwx\n");
  buffer.flush();
  assert.ok(lines.some((line) => /further activity suppressed/.test(line)), lines.join("|"));
});
