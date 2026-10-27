import assert from "node:assert/strict";
import test from "node:test";
import { parseOpenCodeUsageExport } from "./opencode-usage.ts";

const usage = {
  inputTokens: 147980,
  outputTokens: 35073,
  reasoningTokens: 43413,
  cacheReadTokens: 19648128,
  cacheWriteTokens: 0,
  costUsd: 0.128232984,
  source: "harness" as const,
};

const head = '{"info":{"id":"ses_x","cost":0.128232984,"tokens":{"input":147980,"output":35073,"reasoning":43413,"cache":{"read":19648128,"write":0}}},"messages":[';

test("reads tokens and cost from the session info block", () => {
  const document = `${head}{"role":"user","text":"hello"}]}`;
  assert.deepEqual(parseOpenCodeUsageExport(document), usage);
});

test("reads usage from a truncated export (the pipe-drain regression)", () => {
  // OpenCode exits before a piped export drains, so the transcript is cut at an
  // arbitrary byte. The info block is at the head and must still be readable.
  const truncated = `${head}{"role":"assistant","text":"Implemented the ta`;
  assert.deepEqual(parseOpenCodeUsageExport(truncated), usage);
});

test("tolerates a corrupt transcript after the info block", () => {
  // The observed failure: a missing comma deep inside messages.
  const corrupt = `${head}{"role":"assistant" "text":"broken"}]}`;
  assert.deepEqual(parseOpenCodeUsageExport(corrupt), usage);
});

test("does not mistake transcript content for the session info block", () => {
  // A message part may contain the literal key and a tokens-shaped object.
  const decoy = `{"messages":[{"role":"tool","output":"\\"info\\": {\\"tokens\\": {\\"input\\": 999}}"}]}`;
  assert.equal(parseOpenCodeUsageExport(decoy), null, "no top-level info means no usage");
  // A string value equal to the key must not shadow the real property.
  const prefixed = `{"note":"info","info":{"tokens":{"input":1,"output":2}},"messages":[]}`;
  assert.deepEqual(parseOpenCodeUsageExport(prefixed), {
    inputTokens: 1, outputTokens: 2, reasoningTokens: undefined,
    cacheReadTokens: undefined, cacheWriteTokens: undefined, costUsd: undefined, source: "harness",
  });
});

test("returns null when the export has no usable tokens", () => {
  assert.equal(parseOpenCodeUsageExport(""), null);
  assert.equal(parseOpenCodeUsageExport("not json at all"), null);
  assert.equal(parseOpenCodeUsageExport('{"info":{"tokens":{}},"messages":[]}'), null);
  // A malformed info block (truncated inside it) is unusable rather than partial.
  assert.equal(parseOpenCodeUsageExport('{"info":{"tokens":{"input":1'), null);
});

test("scanner ignores braces and quotes inside message text", () => {
  const withBraces = `{"info":{"tokens":{"input":7,"output":8},"cost":0.5},"messages":[{"text":"}}} } \\"quoted\\" {"}]}`;
  assert.deepEqual(parseOpenCodeUsageExport(withBraces), {
    inputTokens: 7, outputTokens: 8, reasoningTokens: undefined,
    cacheReadTokens: undefined, cacheWriteTokens: undefined, costUsd: 0.5, source: "harness",
  });
});
