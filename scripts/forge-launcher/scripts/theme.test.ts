import { test } from "node:test";
import assert from "node:assert/strict";
import { parseThemePreference, resolveTheme } from "./console/dashboard/theme.ts";

test("parseThemePreference accepts only the three supported preferences", () => {
  assert.equal(parseThemePreference("auto"), "auto");
  assert.equal(parseThemePreference("light"), "light");
  assert.equal(parseThemePreference("dark"), "dark");
  assert.equal(parseThemePreference("Light"), null);
  assert.equal(parseThemePreference("system"), null);
  assert.equal(parseThemePreference(""), null);
  assert.equal(parseThemePreference(null), null);
  assert.equal(parseThemePreference({ theme: "light" }), null);
});

test("resolveTheme follows the OS only for auto", () => {
  assert.equal(resolveTheme("auto", true), "light");
  assert.equal(resolveTheme("auto", false), "dark");
  assert.equal(resolveTheme("light", false), "light");
  assert.equal(resolveTheme("dark", true), "dark");
});
