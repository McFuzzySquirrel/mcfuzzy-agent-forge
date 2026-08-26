import assert from "node:assert/strict";
import test from "node:test";

import { hashString, squirrelNameForAgent, UNASSIGNED_SQUIRREL } from "./names.ts";

test("hashString is deterministic and differs for distinct inputs", () => {
  assert.equal(hashString("api-engineer"), hashString("api-engineer"));
  assert.notEqual(hashString("api-engineer"), hashString("ui-engineer"));
  assert.equal(typeof hashString("anything"), "number");
});

test("known roles map to curated squirrel names", () => {
  assert.equal(squirrelNameForAgent("api-engineer"), "Tailor");
  assert.equal(squirrelNameForAgent("ui-engineer"), "Pixie");
  assert.equal(squirrelNameForAgent("qa-engineer"), "Nutsy");
  assert.equal(squirrelNameForAgent("project-orchestrator"), "Acornius");
  // Case/whitespace insensitive
  assert.equal(squirrelNameForAgent("  API-Engineer "), "Tailor");
});

test("unknown agents get a stable name from the fallback pool", () => {
  const a = squirrelNameForAgent("mystery-role-xyz");
  const b = squirrelNameForAgent("mystery-role-xyz");
  assert.equal(a, b, "the same agent must always map to the same squirrel");
  assert.match(a, /^[A-Z][a-z]*( [A-Z][a-z]*)?$/);
});

test("empty / unassigned owners fall back to Scout", () => {
  assert.equal(squirrelNameForAgent(""), UNASSIGNED_SQUIRREL);
  assert.equal(squirrelNameForAgent("   "), UNASSIGNED_SQUIRREL);
  assert.equal(squirrelNameForAgent(undefined as unknown as string), UNASSIGNED_SQUIRREL);
});
