import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("./validate-team.mjs", import.meta.url));

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "team-validate-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".github", "agents"), { recursive: true });
  mkdirSync(join(root, ".github", "skills", "demo"), { recursive: true });
  return root;
}

function run(root, args = []) {
  try {
    execFileSync(process.execPath, [CLI, "--repo", root, ...args], { encoding: "utf8" });
    return 0;
  } catch (error) {
    return error.status ?? 1;
  }
}

const agentText = `---
name: builder
description: "Builds the project."
---
## Responsibilities
- Build
## Collaboration
- qa
`;

const strongSkill = `---
name: demo
description: "Validates the demo workflow."
---
## Process
### Step 1: Inspect
### Step 2: Change
Load \`references/details.md\` when the workflow is complex.
\`\`\`bash
npm test
\`\`\`
Use the standard command by default; if that doesn't work, use the fallback.
## Gotchas
- Paths are rooted at the repository.
- YAML descriptions must be quoted.
- Existing files are preserved.
## Validation
- [ ] Run tests
- [ ] Check output
- [ ] Review references
`;

const bootstrappedToolingSkill = `---
name: forge-tooling
description: "Legacy bootstrapped Forge tooling."
---
# Tooling
`;

test("discovers .github agents and skills", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, ".github", "agents", "builder.md"), agentText);
  writeFileSync(join(root, ".github", "skills", "demo", "SKILL.md"), strongSkill);
  mkdirSync(join(root, ".github", "skills", "demo", "references"), { recursive: true });
  writeFileSync(join(root, ".github", "skills", "demo", "references", "details.md"), "details");
  assert.equal(run(root, ["--fail-structural", "--min-axis", "2", "--fail-axis-below"]), 0);
});

test("blocks a structural error even when average quality is otherwise usable", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, ".github", "agents", "builder.md"), agentText);
  writeFileSync(join(root, ".github", "skills", "demo", "SKILL.md"), strongSkill.replace("name: demo", "name: wrong"));
  assert.notEqual(run(root, ["--fail-structural"]), 0);
});

test("blocks a failing axis instead of relying on the average", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, ".github", "agents", "builder.md"), agentText);
  const weak = strongSkill.replace(/^## Gotchas[\s\S]*?^## Validation/m, "## Validation");
  writeFileSync(join(root, ".github", "skills", "demo", "SKILL.md"), weak);
  assert.notEqual(run(root, ["--min-axis", "2", "--fail-axis-below"]), 0);
});

test("scopes quality blocking to affected project skills", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, ".github", "agents", "builder.md"), agentText);
  writeFileSync(join(root, ".github", "skills", "demo", "SKILL.md"), strongSkill);
  mkdirSync(join(root, ".github", "skills", "forge-tooling"), { recursive: true });
  writeFileSync(join(root, ".github", "skills", "forge-tooling", "SKILL.md"), bootstrappedToolingSkill);
  assert.equal(run(root, [
    "--fail-structural",
    "--min-axis", "2",
    "--fail-axis-below",
    "--skill-file", ".github/skills/demo/SKILL.md",
  ]), 0);
});

test("validates candidate consumers against generated agent names", (t) => {
  const root = fixture(t);
  writeFileSync(join(root, ".github", "agents", "builder.md"), agentText);
  mkdirSync(join(root, ".github", "skills", "demo", "references"), { recursive: true });
  writeFileSync(join(root, ".github", "skills", "demo", "SKILL.md"), strongSkill);
  writeFileSync(join(root, ".github", "skills", "demo", "references", "details.md"), "details");
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "docs", "SKILL-CANDIDATES.json"), JSON.stringify({
    version: 1,
    candidates: [{
      name: "demo",
      description: "Demo skill",
      consumers: ["builder"],
      action: "create",
      reason: "Repeated workflow",
    }],
  }));
  assert.equal(run(root, ["--fail-structural", "--skill-file", ".github/skills/demo/SKILL.md"]), 0);
  writeFileSync(join(root, "docs", "SKILL-CANDIDATES.json"), JSON.stringify({
    version: 1,
    candidates: [{
      name: "demo",
      description: "Demo skill",
      consumers: ["missing-agent"],
      action: "create",
      reason: "Repeated workflow",
    }],
  }));
  assert.notEqual(run(root, ["--fail-structural", "--skill-file", ".github/skills/demo/SKILL.md"]), 0);
});
