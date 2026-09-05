import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const CLI = fileURLToPath(new URL("./skill-review.ts", import.meta.url));

function run(file: string, args: string[]) {
  try {
    execFileSync(process.execPath, ["--import", "tsx", CLI, "--files", file, "--provider", "stdout", ...args], {
      encoding: "utf8",
      stdio: "pipe",
    });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

function skill(text: string) {
  const root = mkdtempSync(join(tmpdir(), "skill-review-"));
  const dir = join(root, "demo");
  const file = join(dir, "SKILL.md");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, text, "utf8");
  return file;
}

const good = `---
name: demo
description: "Validates a repeatable workflow."
---
## Process
### Step 1: Inspect
### Step 2: Change
Load \`references/details.md\` when needed.
\`\`\`bash
npm test
\`\`\`
If that doesn't work, use the fallback.
## Gotchas
- Preserve qualified IDs.
- Quote descriptions.
- Keep references relative.
## Validation
- [ ] Run tests
- [ ] Check files
- [ ] Review output
`;

test("fails the CLI when one axis is below threshold", () => {
  const file = skill(good.replace("## Gotchas", "## Notes"));
  assert.notEqual(run(file, ["--min-axis", "3", "--fail-axis-below"]), 0);
});

test("fails the CLI on structural issues", () => {
  const file = skill(good.replace("name: demo", "name: other"));
  assert.notEqual(run(file, ["--fail-structural"]), 0);
});
