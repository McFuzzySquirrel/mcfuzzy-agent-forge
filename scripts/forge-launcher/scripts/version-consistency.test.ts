import assert from "node:assert/strict";
import { test } from "node:test";
import { validateVersionConsistency } from "./version-consistency.ts";

test("accepts matching README and changelog versions", () => {
  assert.equal(validateVersionConsistency("**Latest: v3.44**", "## September 2026 - v3.44\n").ok, true);
});

test("rejects drift or missing release headings", () => {
  assert.equal(validateVersionConsistency("**Latest: v3.43**", "## September 2026 - v3.44\n").ok, false);
  assert.equal(validateVersionConsistency("README", "updates").ok, false);
});
