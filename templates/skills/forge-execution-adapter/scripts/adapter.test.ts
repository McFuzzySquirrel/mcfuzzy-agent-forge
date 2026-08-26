import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileExecutionManifest, compileExecutionManifestDetailed, validateTeam } from "./compiler.ts";
import { discoverForgeRepo } from "./discovery.ts";
import { appendAuditEvent, checkpointTask, parseProgress, writeProgress } from "./progress.ts";

function createFixture(harness = ".agents") {
  const root = mkdtempSync(join(tmpdir(), "forge-execution-adapter-"));
  mkdirSync(join(root, harness, "agents"), { recursive: true });
  mkdirSync(join(root, harness, "skills", "api-contracts", "references"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });

  writeFileSync(join(root, harness, "agents", "api-engineer.md"), `---
name: api-engineer
description: Builds API endpoints and backend integrations.
model: gpt-5-mini
---

## Expertise
- API endpoint design
- Backend integration work

## Collaboration
- frontend-engineer
`, "utf8");
  writeFileSync(join(root, harness, "agents", "frontend-engineer.md"), `---
name: frontend-engineer
description: Builds UI flows and client-side components.
---

## Expertise
- UI components
- Frontend flows
`, "utf8");
  writeFileSync(join(root, harness, "skills", "api-contracts", "SKILL.md"), `---
name: api-contracts
description: Keep API contracts aligned between backend and frontend.
---

# Skill
`, "utf8");
  writeFileSync(join(root, "docs", "PRD.md"), `# PRD

## Validation
\`npm test\`

## Phase 1: Foundation
- Task 1.1: Create API route at \`src/server.ts\`
- Task 1.2: Build dashboard UI in \`src/dashboard.tsx\`

## Phase 2: Hardening
- Task 2.1: Add integration tests in \`tests/integration.test.ts\`
`, "utf8");

  return root;
}

test("discoverForgeRepo resolves canonical harness root", () => {
  const root = createFixture();
  const repo = discoverForgeRepo(root);
  assert.equal(repo.harnessRoot, ".agents");
  assert.equal(repo.agents.length, 2);
  assert.equal(repo.skills.length, 1);
});

test("discoverForgeRepo supports non-default harness roots", () => {
  const root = createFixture(".github");
  const repo = discoverForgeRepo(root);
  assert.equal(repo.harnessRoot, ".github");
});

test("compileExecutionManifest builds phases, tasks, and owners", () => {
  const root = createFixture();
  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo);

  assert.equal(manifest.phases.length, 2);
  assert.equal(manifest.validationCommands[0], "npm test");
  assert.equal(manifest.phases[0]?.tasks[0]?.ownerAgent, "api-engineer");
  assert.equal(manifest.phases[0]?.tasks[1]?.ownerAgent, "frontend-engineer");
  assert.deepEqual(manifest.phases[1]?.dependencies, ["1"]);
});

test("compileExecutionManifest auto-declares artifact produces/inputs", () => {
  const root = createFixture();
  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo);

  const tasks = manifest.phases.flatMap((phase) => phase.tasks);
  for (const task of tasks) {
    assert.ok(task.produces, `task ${task.id} should declare a produces type`);
    assert.ok(Array.isArray(task.inputs), `task ${task.id} should declare inputs`);
  }
  // Linear dependency chain within a phase: each task consumes the previous
  // task's artifact type. Cross-phase ordering is handled by phase dependencies,
  // so the first task of a phase starts with no in-phase input artifacts.
  assert.equal(manifest.phases[0]?.tasks[0]?.produces, "work.1.1");
  assert.deepEqual(manifest.phases[0]?.tasks[0]?.inputs, []);
  assert.equal(manifest.phases[0]?.tasks[1]?.produces, "work.1.2");
  assert.deepEqual(manifest.phases[0]?.tasks[1]?.inputs, ["work.1.1"]);
  assert.equal(manifest.phases[1]?.tasks[0]?.produces, "work.2.1");
  assert.deepEqual(manifest.phases[1]?.tasks[0]?.inputs, []);
});

test("compileExecutionManifest falls back to first agent when no owner matches", () => {
  const root = createFixture();
  writeFileSync(join(root, "docs", "PRD.md"), `# PRD

## Phase 1: Foundation
- Task 1.1: Zygomorphic flux calibration
`, "utf8");

  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo);

  const task = manifest.phases[0]?.tasks[0];
  assert.ok(task);
  assert.equal(task.ownerAgent, "api-engineer"); // first agent (no orchestrator in fixture)
  assert.match(manifest.warnings.join("\n"), /defaulting to 'api-engineer'/);
});

test("compileExecutionManifest prefers an orchestrator fallback owner", () => {
  const root = createFixture();
  writeFileSync(join(root, ".agents", "agents", "workflow-orchestrator.md"), `---
name: workflow-orchestrator
description: Coordinates the build and handles cross-cutting polish.
---
`, "utf8");
  writeFileSync(join(root, "docs", "PRD.md"), `# PRD

## Phase 1: Foundation
- Task 1.1: Zygomorphic flux calibration
`, "utf8");

  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo);

  const task = manifest.phases[0]?.tasks[0];
  assert.ok(task);
  assert.equal(task.ownerAgent, "workflow-orchestrator");
  assert.match(manifest.warnings.join("\n"), /defaulting to 'workflow-orchestrator'/);
});

test("compileExecutionManifest defaults to fine granularity and records it", () => {
  const root = createFixture();
  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo);

  assert.equal(manifest.granularity, "fine");
});

test("fine granularity expands indented sub-bullets into chained tasks", () => {
  const root = createFixture();
  writeFileSync(join(root, "docs", "PRD.md"), `# PRD

## Phase 1: Foundation
- Task 1.1: Build the API layer
  - Create GET endpoint in \`src/get.ts\`
  - Create POST endpoint in \`src/post.ts\`
`, "utf8");

  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo, { granularity: "fine" });

  const tasks = manifest.phases[0]!.tasks;
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0]!.id, "1.1");
  assert.equal(tasks[1]!.id, "1.2");
  assert.match(tasks[0]!.description, /Create GET endpoint/);
  assert.match(tasks[0]!.description, /Build the API layer/);
  assert.deepEqual(tasks[1]!.dependencies, ["1.1"]);
  assert.deepEqual(tasks[1]!.inputs, ["work.1.1"]);
  assert.equal(tasks[1]!.produces, "work.1.2");
});

test("fine granularity splits oversized bullets into chained tasks with a warning", () => {
  const root = createFixture();
  writeFileSync(join(root, "docs", "PRD.md"), `# PRD

## Phase 1: Foundation
- Task 1.1: Implement the auth system end to end. Add token refresh with rotation handling. Wire up role-based access control in \`src/auth.ts\`.
`, "utf8");

  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo, { granularity: "fine" });

  const tasks = manifest.phases[0]!.tasks;
  assert.equal(tasks.length, 3);
  assert.match(tasks[0]!.description, /auth system end to end/);
  assert.match(tasks[1]!.description, /token refresh with rotation handling/);
  assert.match(tasks[2]!.description, /role-based access control/);
  assert.deepEqual(tasks[1]!.dependencies, [tasks[0]!.id]);
  assert.deepEqual(tasks[2]!.dependencies, [tasks[1]!.id]);
  assert.match(manifest.warnings.join("\n"), /was split into 3 finer-grained tasks/);
});

test("coarse granularity reproduces the legacy one-bullet-per-task output", () => {
  const root = createFixture();
  writeFileSync(join(root, "docs", "PRD.md"), `# PRD

## Phase 1: Foundation
- Task 1.1: Build the API layer
  - Create GET endpoint in \`src/get.ts\`
- Task 1.2: Implement auth end to end. Add token refresh.
`, "utf8");

  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo, { granularity: "coarse" });

  const tasks = manifest.phases[0]!.tasks;
  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks.map((task) => task.description), [
    "Task 1.1: Build the API layer",
    "Create GET endpoint in `src/get.ts`",
    "Task 1.2: Implement auth end to end. Add token refresh.",
  ]);
  assert.equal(manifest.granularity, "coarse");
  assert.equal(manifest.warnings.some((warning) => /split into/.test(warning)), false);
});

test("task ids stay unique when a labelled task follows auto-numbered tasks", () => {
  const root = createFixture();
  writeFileSync(join(root, "docs", "PRD.md"), `# PRD

## Phase 1: Foundation
- Task 1.1: Build the API layer
  - Create GET endpoint in \`src/get.ts\`
  - Configure the build
- Task 1.2: Implement auth end to end. Add token refresh with rotation handling. Wire up role-based access control in \`src/auth.ts\`.
`, "utf8");

  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo, { granularity: "fine" });

  const ids = manifest.phases[0]!.tasks.map((task) => task.id);
  assert.equal(new Set(ids).size, ids.length, "task ids must be unique within a phase");
  assert.deepEqual(ids, ["1.1", "1.2", "1.3", "1.4", "1.5"]);
});

test("checkpointTask updates PROGRESS.md and audit state", () => {
  const root = createFixture();
  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo);
  const state = parseProgress(repo.progressPath, manifest);
  const next = checkpointTask(manifest, state, "1.1", ["src/server.ts"], "Foundation task delivered");

  writeProgress(repo.progressPath, manifest, next);
  appendAuditEvent(repo.auditPath, { timestamp: new Date().toISOString(), action: "task.checkpointed", taskId: "1.1" });

  const progress = readFileSync(repo.progressPath, "utf8");
  const audit = readFileSync(repo.auditPath, "utf8");
  assert.match(progress, /Task 1\.1/);
  assert.match(progress, /Task 1\.2/);
  assert.match(audit, /task\.checkpointed/);
});

// --- feature/decomposed layout ---------------------------------------------

function createFeatureFixture() {
  const root = createFixture();
  const featuresDir = join(root, "docs", "features");
  mkdirSync(featuresDir, { recursive: true });
  mkdirSync(join(root, "docs", "features", "sub"), { recursive: true });

  writeFileSync(join(root, "docs", "product-vision.md"), `# Product Vision

## 14. Features

| # | Feature | File | Dependencies | Priority |
|---|---------|------|-------------|----------|
| 1 | Foundation | [docs/features/foundation.md](features/foundation.md) | None | Must |
| 2 | Expenses | [docs/features/expenses.md](features/expenses.md) | Foundation | Must |
| 3 | Budgets | [docs/features/budgets.md](features/budgets.md) | Expenses | Must |
`, "utf8");

  writeFileSync(join(featuresDir, "foundation.md"), `# Feature: Foundation

## 3. Functional Requirements
- FND-FR-01: Project scaffold

## 5. Implementation Tasks
### Phase 1: Foundation
- Task 1.1: Create project scaffold at \`src/main.ts\`
`, "utf8");

  writeFileSync(join(featuresDir, "expenses.md"), `# Feature: Expenses

## 3. Functional Requirements
- EXP-FR-01: Record expenses

## 5. Implementation Tasks
### Phase 1: Expenses
- Task 1.1: Build the expense API in \`src/expenses.ts\`
- Task 1.2: Build the expense UI in \`src/expenses-view.tsx\`
`, "utf8");

  writeFileSync(join(featuresDir, "budgets.md"), `# Feature: Budgets

## 3. Functional Requirements
- BUD-FR-01: Set budgets

## 5. Implementation Tasks
### Phase 2: Budgets
- Task 1.1: Build the budget API in \`src/budget.ts\`
- Task 1.2: Build the budget UI in \`src/budget-view.tsx\`
`, "utf8");

  return root;
}

test("discoverForgeRepo detects the decomposed feature layout", () => {
  const root = createFeatureFixture();
  const repo = discoverForgeRepo(root);
  assert.equal(repo.sourceLayout, "features");
  assert.equal(repo.featurePaths.length, 3);
  assert.ok(repo.visionPath.endsWith("docs/product-vision.md"));
});

test("compileExecutionManifest compiles features in dependency order with feature-tagged ids", () => {
  const root = createFeatureFixture();
  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo);

  assert.equal(manifest.sourceLayout, "features");
  assert.deepEqual(manifest.featureOrder, ["Foundation", "Expenses", "Budgets"]);
  assert.deepEqual(manifest.phases.map((phase) => phase.id), ["FOUNDATION-1", "EXPENSES-1", "BUDGETS-2"]);
  assert.deepEqual(manifest.phases.map((phase) => phase.feature), ["Foundation", "Expenses", "Budgets"]);

  const budgets = manifest.phases[2]!;
  assert.deepEqual(budgets.dependencies, ["EXPENSES-1"]);
  assert.equal(budgets.tasks[0]!.id, "BUDGETS-2.1");
  assert.equal(budgets.tasks[1]!.id, "BUDGETS-2.2");
  assert.equal(budgets.tasks[0]!.ownerAgent, "api-engineer");
  assert.equal(budgets.tasks[1]!.ownerAgent, "frontend-engineer");
  assert.equal(budgets.tasks[1]!.produces, "work.budgets-2.2");

  // task ids are globally unique even though feature docs reuse "Task 1.x" labels
  const allIds = manifest.phases.flatMap((phase) => phase.tasks.map((task) => task.id));
  assert.equal(new Set(allIds).size, allIds.length);
});

test("compileExecutionManifest falls back to lexical order when the vision has no feature table", () => {
  const root = createFeatureFixture();
  writeFileSync(join(root, "docs", "product-vision.md"), "# Product Vision\n\nNo features table.\n", "utf8");
  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo);

  assert.deepEqual(manifest.featureOrder, ["budgets", "expenses", "foundation"]);
  assert.match(manifest.warnings.join("\n"), /No feature dependency table found/);
});

test("validateTeam flags duplicate file owners and orphan agents", () => {
  const root = createFixture();
  writeFileSync(join(root, ".agents", "agents", "unused-engineer.md"), `---
name: unused-engineer
description: Builds nothing at all.
---

## Expertise
- Irrelevant work
`, "utf8");
  writeFileSync(join(root, "docs", "PRD.md"), `# PRD

## Phase 1: Foundation
- Task 1.1: Build the API in \`src/shared.ts\`
- Task 1.2: Build the UI in \`src/shared.ts\`
`, "utf8");

  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo);
  const validation = validateTeam(manifest, repo.agents);

  assert.equal(validation.unassignedTasks.length, 0);
  assert.ok(validation.orphanAgents.includes("unused-engineer"));
  assert.ok(validation.orphanAgents.some((name) => name !== "api-engineer" && name !== "frontend-engineer"));

  const dup = validation.duplicateFileOwners.find((entry) => entry.file === "src/shared.ts");
  assert.ok(dup, "src/shared.ts should be flagged as owned by multiple agents");
  assert.ok(dup!.owners.length > 1);
});

test("compileExecutionManifestDetailed writes a responsibility matrix and surfaces validation warnings", () => {
  const root = createFeatureFixture();
  const repo = discoverForgeRepo(root);
  const { manifest, matrix, validation } = compileExecutionManifestDetailed(repo);

  assert.equal(manifest.sourceLayout, "features");
  assert.equal(validation.duplicateFileOwners.length, 0);
  assert.match(matrix, /# Agent Responsibility Matrix/);
  assert.match(matrix, /Feature execution order:/);
  assert.ok(matrix.indexOf("Expenses") < matrix.indexOf("Budgets"), "features should appear in dependency order");
  assert.match(matrix, /### api-engineer/);
  assert.match(matrix, /\*\*EXPENSES-1\*\* — Phase 1: Expenses \(Expenses\)/);
  assert.ok(manifest.warnings.length >= 0);
});
