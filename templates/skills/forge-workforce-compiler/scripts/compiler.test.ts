import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { discoverForgeRepo } from "./discovery.ts";
import { compileWorkforcePackage } from "./compiler.ts";
import { validateWorkforcePackage } from "./validator.ts";

function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "forge-workforce-compiler-"));
  mkdirSync(join(root, ".agents", "agents"), { recursive: true });
  mkdirSync(join(root, ".agents", "skills", "build-api"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });

  writeFileSync(join(root, ".agents", "agents", "api-engineer.agent.md"), `---\nname: api-engineer\ndescription: Builds APIs\nmodel: gpt-5-mini\n---\n\n# API Engineer\n`, "utf8");
  writeFileSync(join(root, ".agents", "skills", "build-api", "SKILL.md"), `---\nname: build-api\ndescription: Build backend APIs\n---\n\n# Skill\n`, "utf8");

  writeFileSync(join(root, "docs", "EXECUTION-MANIFEST.json"), `${JSON.stringify({
    version: "1.0",
    repoRoot: root,
    harnessRoot: ".agents",
    phases: [
      {
        id: "1",
        title: "Phase 1",
        tasks: [
          {
            id: "1.1",
            title: "Create endpoint",
            description: "Create the API endpoint",
            ownerAgent: "api-engineer",
            dependencies: [],
            expectedOutputs: ["src/api.ts"],
          },
        ],
      },
    ],
    warnings: [],
  }, null, 2)}\n`, "utf8");

  return root;
}

test("compileWorkforcePackage emits valid workforce artifacts", () => {
  const root = fixtureRoot();
  const repo = discoverForgeRepo(root);
  const result = compileWorkforcePackage(repo, { packageId: "dev.agent-forge.fixture" });

  assert.equal(existsSync(result.workforceManifestPath), true);
  assert.equal(existsSync(result.workflowPath), true);
  assert.equal(existsSync(result.bridgePath), true);

  const validation = validateWorkforcePackage(result.workforceDir);
  assert.equal(validation.ok, true);

  const bridge = JSON.parse(readFileSync(result.bridgePath, "utf8")) as { taskNodeMap: Array<{ taskId: string }> };
  assert.equal(bridge.taskNodeMap[0]?.taskId, "1.1");
});
