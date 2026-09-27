import assert from "node:assert/strict";
import test from "node:test";

import { auditSkill } from "./rubric.ts";

function makeAudit(skillMd: string) {
  return auditSkill({
    skillMd,
    skillName: "regression",
    skillPath: "/tmp/regression/SKILL.md",
    hasRefsDir: true,
    hasAssetsDir: false,
    hasScriptsDir: true,
  });
}

test("context economy rewards progressive disclosure over raw length", () => {
  const longSkill = [
    "# Regression skill",
    "",
    "## Process",
    ...Array.from({ length: 520 }, (_value, index) => `### Step ${index + 1}: Keep the workflow concrete and project-specific.`),
    "",
    "## References",
    "Load `references/guide.md` when you need the long form.",
    "",
    "## Validation",
    "- [x] Confirm the change locally",
  ].join("\n");

  const audit = makeAudit(longSkill);
  const contextScore = audit.scores.find((score) => score.axis === "Context economy");

  assert.ok(contextScore, "expected a context economy score");
  assert.equal(contextScore?.score, 3);
});

test("calibration recognizes fenced command blocks and fallbacks", () => {
  const skillMd = [
    "# Regression skill",
    "",
    "## Process",
    "### Step 1: Use the standard command by default",
    "Use the standard command by default:",
    "### Step 2: Fall back when needed",
    "",
    "```bash",
    "npm run build -- --mode=prod",
    "```",
    "",
    "If that doesn't work, try the fallback command instead.",
    "",
    "```bash",
    "npm run build -- --mode=test",
    "```",
    "",
    "## Gotchas",
    "- PostgreSQL implicit commits can break rollback assumptions",
    "- SQLite foreign key enforcement must be enabled per connection",
    "- MySQL identifier quoting differs between ANSI and default modes",
    "",
    "## Validation",
    "- [x] Run the build command",
    "- [x] Confirm the fallback path behaves the same",
  ].join("\n");

  const audit = makeAudit(skillMd);
  const calibrationScore = audit.scores.find((score) => score.axis === "Calibration");

  assert.ok(calibrationScore, "expected a calibration score");
  assert.equal(calibrationScore?.score, 3);
  assert.equal(audit.reviewerStyleProxy, 3);
});

const PROJECT_GOTCHAS = [
  "- PostgreSQL implicit commits can break rollback assumptions",
  "- SQLite foreign key enforcement must be enabled per connection",
  "- MySQL identifier quoting differs between ANSI and default modes",
];

function gotchasScore(skillMd: string): number | undefined {
  return makeAudit(skillMd).scores.find((score) => score.axis === "Gotchas coverage")?.score;
}

test("gotchas coverage does not depend on where the Gotchas section sits", () => {
  const middle = [
    "# Regression skill",
    "",
    "## Gotchas",
    ...PROJECT_GOTCHAS,
    "",
    "## Validation",
    "- [x] Run the build command",
  ].join("\n");
  const last = [
    "# Regression skill",
    "",
    "## Validation",
    "- [x] Run the build command",
    "",
    "## Gotchas",
    ...PROJECT_GOTCHAS,
  ].join("\n");

  assert.equal(gotchasScore(middle), 3);
  assert.equal(
    gotchasScore(last),
    3,
    "a last-position Gotchas section must not read as empty",
  );
});

test("a capital Z inside the last section does not truncate it", () => {
  const skillMd = [
    "# Regression skill",
    "",
    "## Validation",
    "- [x] Run the build command",
    "",
    "## Gotchas",
    "- Zod schemas reject unknown keys at the boundary",
    ...PROJECT_GOTCHAS.slice(0, 2),
  ].join("\n");

  assert.equal(
    gotchasScore(skillMd),
    3,
    "content after a capital Z in a last section must still be counted",
  );
});

test("the reviewer-style proxy counts gotchas in a last-position section", () => {
  // Tuned so the gotcha point is decisive: 4 points with it, 3 without.
  const skillMd = [
    "# Regression skill",
    "",
    "## Process",
    "### Step 1: Inspect the current state",
    "### Step 2: Apply the change",
    "",
    "Load `references/notes.md` when the long form is needed.",
    "",
    "## Validation",
    "- [x] Run the standard command",
    "- [x] Check the generated output",
    "",
    "## Gotchas",
    ...PROJECT_GOTCHAS,
  ].join("\n");

  assert.equal(makeAudit(skillMd).reviewerStyleProxy, 3);
});
