import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";

import { compileExecutionManifest, compileExecutionManifestDetailed, validateManifestSafety, validateTeam } from "./compiler.ts";
import { discoverForgeRepo } from "./discovery.ts";
import { appendAuditEvent, checkpointTask, parseProgress, writeProgress } from "./progress.ts";

function foundationLayout(root: string): void {
  mkdirSync(join(root, "docs/features"), { recursive: true });
  writeFileSync(join(root, "docs/PRD.md"), "# Product Vision\n## Validation\n`npm test`\n## 14. Features\n| # | Feature | File | Dependencies |\n| 1 | Foundation | features/foundation.md | None |\n");
}

function createFixture(harness = ".agents") {
  const root = mkdtempSync(join(tmpdir(), "forge-execution-adapter-"));
  mkdirSync(join(root, harness, "agents"), { recursive: true });
  mkdirSync(join(root, harness, "skills", "api-contracts", "references"), { recursive: true });
  foundationLayout(root);

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
  writeFileSync(join(root, "docs", "features", "foundation.md"), `# PRD

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

test("legacy version numbers and explicit source references are not outputs", () => {
  const root = createFixture();
  writeFileSync(join(root, "docs", "features", "foundation.md"), '# PRD\n## Phase 1: Checks\n- Automated WCAG 2.2 AA scanning\n- Compile evaluation report from `docs/EVALUATION.md`\n- Calibrate per `docs/SCENARIO-PROFILES.md`\n');
  const tasks = compileExecutionManifest(discoverForgeRepo(root)).phases[0]!.tasks;
  assert.ok(tasks.every((task) => task.expectedOutputs.length === 0));
  assert.equal(tasks[0]!.title, "Automated WCAG 2.2 AA scanning");
});

test("phase-opening tasks consume prerequisite phase artifacts", () => {
  const manifest = compileExecutionManifest(discoverForgeRepo(createFixture()));
  assert.deepEqual(manifest.phases[1]!.tasks[0]!.inputs, ["work.foundation-1.1", "work.foundation-1.2"]);
});

test("structured tasks preserve atomic scope and reject unknown or cyclic dependencies", () => {
  const root = createFixture();
  const task = { id: "api-one", title: "API 2.2: Upload", description: "Implement upload; verify all boundaries. Preserve valid existing behavior.", ownerAgent: "api-engineer", dependencies: [] as string[], expectedOutputs: ["src/upload.ts"], validationCommands: ["npm test"], contract: { version: 1, kind: "implementation", references: ["docs/features/foundation.md"], requirements: ["FR-1: Upload"], acceptanceCriteria: ["Oversize upload rejected"], constraints: [] } };
  const write = () => writeFileSync(join(root, "docs", "features", "foundation.md"), '# PRD\n## Phase 1: Upload\n```forge-task\n' + JSON.stringify(task) + '\n```\n');
  write();
  assert.equal(compileExecutionManifest(discoverForgeRepo(root)).phases[0]!.tasks.length, 1);
  task.dependencies = ["missing"]; write();
  assert.throws(() => compileExecutionManifest(discoverForgeRepo(root)), /unknown dependency/);
  task.dependencies = [task.id]; write();
  assert.throws(() => compileExecutionManifest(discoverForgeRepo(root)), /cycle/);
});

test("compact feature contracts compile complete rules and reject duplicate canonical ownership", () => {
  const root = createFixture();
  const definition = '```forge-requirement\n{"id":"FR-1","kind":"requirement","text":"Reject oversized uploads before extraction."}\n```\n';
  const task = { id: "UPLOAD-1", title: "Validate uploads", description: "Enforce upload limits", ownerAgent: "api-engineer", dependencies: [], expectedOutputs: ["src/upload.ts"], validationCommands: ["npm test"], contract: { version: 2, kind: "implementation", requirements: [], requirementRefs: ["docs/features/foundation.md#FR-1"], constraints: [], constraintRefs: [], acceptanceCriteria: ["Extractor never sees rejected bytes"], references: [] } };
  writeFileSync(join(root, "docs/features/foundation.md"), '# Feature: Foundation\n' + definition + '\n## Phase 1: Upload\n```forge-task\n' + JSON.stringify(task) + '\n```\n');
  const manifest = compileExecutionManifest(discoverForgeRepo(root));
  assert.equal(manifest.sourceLayout, "features");
  const compiled = manifest.phases[0]!.tasks[0]!;
  assert.equal(compiled.id, "UPLOAD-1");
  assert.equal(compiled.contract!.version, 1);
  assert.deepEqual(compiled.contract!.requirements, ["FR-1: Reject oversized uploads before extraction."]);
  assert.deepEqual(compiled.contract!.references, ["docs/features/foundation.md#FR-1"]);
  const vision = join(root, "docs/PRD.md");
  writeFileSync(vision, readFileSync(vision, "utf8") + definition);
  assert.throws(() => compileExecutionManifest(discoverForgeRepo(root)), /Duplicate canonical definition/);
});

test("detailed compilation reports stable task reconciliation", () => {
  const root = createFixture();
  const repo = discoverForgeRepo(root);
  const first = compileExecutionManifest(repo);
  writeFileSync(repo.manifestPath, JSON.stringify(first), "utf8");
  writeFileSync(join(root, "docs", "features", "foundation.md"), readFileSync(join(root, "docs", "features", "foundation.md"), "utf8") + "\n- Task 1.3: Add API tests in `tests/api.test.ts`\n", "utf8");
  const next = compileExecutionManifestDetailed(repo).manifest;
  assert.deepEqual(next.reconciliation?.preservedTaskIds, ["FOUNDATION-1.1", "FOUNDATION-1.2", "FOUNDATION-2.1"]);
  assert.deepEqual(next.reconciliation?.newTaskIds, ["FOUNDATION-2.2"]);
});

test("discoverForgeRepo supports non-default harness roots", () => {
  const root = createFixture(".github");
  const repo = discoverForgeRepo(root);
  assert.equal(repo.harnessRoot, ".github");
});

test("discoverForgeRepo prefers an agents root over a skills-only root", () => {
  const root = createFixture(".opencode");
  // A skills-only root (e.g. a stray .github/) must not shadow the .opencode
  // agents root, or every task would fail owner matching and get skipped.
  mkdirSync(join(root, ".github", "skills", "create-readme"), { recursive: true });
  writeFileSync(join(root, ".github", "skills", "create-readme", "SKILL.md"), `---
name: create-readme
description: Writes project READMEs.
---

# Skill
`, "utf8");

  const repo = discoverForgeRepo(root);
  assert.equal(repo.harnessRoot, ".opencode");
  assert.equal(repo.agents.length, 2);
  assert.match(repo.warnings.join("\n"), /skills-only harness root.*\.github/);
});

test("compileExecutionManifest builds phases, tasks, and owners", () => {
  const root = createFixture();
  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo);

  assert.equal(manifest.phases.length, 2);
  assert.equal(manifest.validationCommands[0], "npm test");
  assert.equal(manifest.phases[0]?.tasks[0]?.ownerAgent, "api-engineer");
  assert.equal(manifest.phases[0]?.tasks[1]?.ownerAgent, "frontend-engineer");
  assert.deepEqual(manifest.phases[1]?.dependencies, ["FOUNDATION-1"]);
});

test("compileExecutionManifest keeps independent features independent", () => {
  const root = createFixture();
  writeFileSync(join(root, "docs/PRD.md"), readFileSync(join(root, "docs/PRD.md"), "utf8") + "| 2 | notifications | features/notifications.md | None |\n");
  mkdirSync(join(root, "docs", "features"), { recursive: true });
  writeFileSync(join(root, "docs", "features", "notifications.md"), `# Feature: Notifications

## 3. Functional Requirements
- Send notifications from \`src/notifications.ts\`
`, "utf8");

  const manifest = compileExecutionManifest(discoverForgeRepo(root));
  const featurePhase = manifest.phases.find((phase) => phase.feature === "notifications");
  assert.ok(featurePhase);
  assert.deepEqual(featurePhase!.dependencies, []);
  assert.deepEqual(manifest.phases.slice(0, 2).map((phase) => phase.dependencies), [[], ["FOUNDATION-1"]]);
});

test("manifest safety rejects duplicate global task ids and warns on orphan dependencies", () => {
  const root = createFixture();
  const manifest = compileExecutionManifest(discoverForgeRepo(root));
  manifest.phases[1]!.tasks[0]!.id = "FOUNDATION-1.1";
  assert.throws(() => validateManifestSafety(manifest), /Duplicate global task id/);

  const clean = compileExecutionManifest(discoverForgeRepo(root));
  clean.phases[0]!.tasks[0]!.dependencies = ["missing-task"];
  validateManifestSafety(clean);
  assert.match(clean.warnings.join("\n"), /orphan task 'missing-task'/);
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
  assert.equal(manifest.phases[0]?.tasks[0]?.produces, "work.foundation-1.1");
  assert.deepEqual(manifest.phases[0]?.tasks[0]?.inputs, []);
  assert.equal(manifest.phases[0]?.tasks[1]?.produces, "work.foundation-1.2");
  assert.deepEqual(manifest.phases[0]?.tasks[1]?.inputs, ["work.foundation-1.1"]);
  assert.equal(manifest.phases[1]?.tasks[0]?.produces, "work.foundation-2.1");
  assert.deepEqual(manifest.phases[1]?.tasks[0]?.inputs, ["work.foundation-1.1", "work.foundation-1.2"]);
});

test("compileExecutionManifest falls back to first agent when no owner matches", () => {
  const root = createFixture();
  writeFileSync(join(root, "docs", "features", "foundation.md"), `# PRD

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

test("compileExecutionManifest does not treat framework names like ASP.NET as expected outputs", () => {
  const root = createFixture();
  writeFileSync(join(root, "docs", "features", "foundation.md"), `# PRD

## Phase 1: Foundation
- Task 1.1: Build ASP.NET Core minimal API with SQLite (WAL mode) schema for conversations, messages, deliveries, artifacts, participants
- Task 1.2: Implement durable inbox/outbox against src/HumanGateway.Core
`, "utf8");

  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo);

  const task1 = manifest.phases[0]?.tasks[0];
  assert.ok(task1);
  assert.deepEqual(task1.expectedOutputs, [], "ASP.NET must not be extracted as an expected output");

  const task2 = manifest.phases[0]?.tasks[1];
  assert.ok(task2);
  assert.ok(task2.expectedOutputs.includes("src/HumanGateway.Core"), "real paths still extracted");
});

test("compileExecutionManifest excludes Forge coordinators from fallback owners", () => {
  const root = createFixture();
  writeFileSync(join(root, ".agents", "agents", "workflow-orchestrator.md"), `---
name: workflow-orchestrator
description: Coordinates the build and handles cross-cutting polish.
---
`, "utf8");
  writeFileSync(join(root, "docs", "features", "foundation.md"), `# PRD

## Phase 1: Foundation
- Task 1.1: Zygomorphic flux calibration
`, "utf8");

  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo);

  const task = manifest.phases[0]?.tasks[0];
  assert.ok(task);
  assert.equal(task.ownerAgent, "api-engineer");
  assert.match(manifest.warnings.join("\n"), /defaulting to 'api-engineer'/);
});

test("bootstrapped tooling agents cannot displace a generated specialist during compilation", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-bootstrapped-team-"));
  const agentRoot = join(root, ".github", "agents");
  mkdirSync(agentRoot, { recursive: true });
  foundationLayout(root);
  for (const name of ["forge-team-builder", "project-orchestrator", "workflow-orchestrator"]) {
    writeFileSync(join(agentRoot, `${name}.md`),
      `---\nname: ${name}\ndescription: Creates service entry point src/index.ts and coordinates the foundation build.\n---\n`);
  }
  writeFileSync(join(agentRoot, "service-engineer.md"),
    "---\nname: service-engineer\ndescription: Implements application services.\n---\n");
  writeFileSync(join(root, "docs", "features", "foundation.md"),
    "# PRD\n\n## Phase 1: Foundation\n- Create service entry point `src/index.ts`\n- Zygomorphic flux calibration\n");
  const repo = discoverForgeRepo(root, ".github");
  assert.equal(repo.agents.length, 4, "discovery must retain tooling for legacy execution");
  const compiled = compileExecutionManifestDetailed(repo);
  const tasks = compiled.manifest.phases.flatMap((phase) => phase.tasks);
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every((task) => task.ownerAgent === "service-engineer"), "both scoring and fallback use implementation candidates only");
  assert.deepEqual(compiled.manifest.phases[0]?.ownerAgents, ["service-engineer"]);
  assert.deepEqual(compiled.validation.orphanAgents, []);
  assert.deepEqual(compiled.validation.unassignedTasks, []);
  assert.ok(!compiled.manifest.warnings.some((warning) => /(?:→|defaulting to).*forge-team-builder/.test(warning)));
});

test("tooling-only compilation leaves implementation work unassigned with an actionable warning", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-tooling-only-"));
  mkdirSync(join(root, ".github", "agents"), { recursive: true });
  foundationLayout(root);
  writeFileSync(join(root, ".github", "agents", "forge-team-builder.md"),
    "---\nname: forge-team-builder\ndescription: Create service entry point.\n---\n");
  writeFileSync(join(root, "docs", "features", "foundation.md"), "# PRD\n\n## Phase 1: Foundation\n- Create service entry point `src/index.ts`\n");
  const compiled = compileExecutionManifestDetailed(discoverForgeRepo(root, ".github"));
  assert.equal(compiled.manifest.phases[0]?.tasks[0]?.ownerAgent, undefined);
  assert.deepEqual(compiled.validation.unassignedTasks, ["FOUNDATION-1.1"]);
  assert.match(compiled.manifest.warnings.join("\n"), /Generate a project-specific team/);
});

test("compileExecutionManifest defaults to fine granularity and records it", () => {
  const root = createFixture();
  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo);

  assert.equal(manifest.granularity, "fine");
});

test("fine granularity expands indented sub-bullets into chained tasks", () => {
  const root = createFixture();
  writeFileSync(join(root, "docs", "features", "foundation.md"), `# PRD

## Phase 1: Foundation
- Task 1.1: Build the API layer
  - Create GET endpoint in \`src/get.ts\`
  - Create POST endpoint in \`src/post.ts\`
`, "utf8");

  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo, { granularity: "fine" });

  const tasks = manifest.phases[0]!.tasks;
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0]!.id, "FOUNDATION-1.1");
  assert.equal(tasks[1]!.id, "FOUNDATION-1.2");
  assert.match(tasks[0]!.description, /Create GET endpoint/);
  assert.match(tasks[0]!.description, /Build the API layer/);
  assert.deepEqual(tasks[1]!.dependencies, ["FOUNDATION-1.1"]);
  assert.deepEqual(tasks[1]!.inputs, ["work.foundation-1.1"]);
  assert.equal(tasks[1]!.produces, "work.foundation-1.2");
});

test("fine granularity splits oversized bullets into chained tasks with a warning", () => {
  const root = createFixture();
  writeFileSync(join(root, "docs", "features", "foundation.md"), `# PRD

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
  writeFileSync(join(root, "docs", "features", "foundation.md"), `# PRD

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
  writeFileSync(join(root, "docs", "features", "foundation.md"), `# PRD

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
  assert.deepEqual(ids, ["FOUNDATION-1.1", "FOUNDATION-1.2", "FOUNDATION-1.3", "FOUNDATION-1.4", "FOUNDATION-1.5"]);
});

test("checkpointTask updates PROGRESS.md and audit state", () => {
  const root = createFixture();
  const repo = discoverForgeRepo(root);
  const manifest = compileExecutionManifest(repo);
  const state = parseProgress(repo.progressPath, manifest);
  const next = checkpointTask(manifest, state, "FOUNDATION-1.1", ["src/server.ts"], "Foundation task delivered");

  writeProgress(repo.progressPath, manifest, next);
  appendAuditEvent(repo.auditPath, { timestamp: new Date().toISOString(), action: "task.checkpointed", taskId: "FOUNDATION-1.1" });

  const progress = readFileSync(repo.progressPath, "utf8");
  const audit = readFileSync(repo.auditPath, "utf8");
  assert.match(progress, /Task FOUNDATION-1\.1/);
  assert.match(progress, /Task FOUNDATION-1\.2/);
  assert.match(audit, /task\.checkpointed/);
});

// --- feature/decomposed layout ---------------------------------------------

function createFeatureFixture() {
  const root = createFixture();
  const featuresDir = join(root, "docs", "features");
  mkdirSync(featuresDir, { recursive: true });
  mkdirSync(join(root, "docs", "features", "sub"), { recursive: true });

  writeFileSync(join(root, "docs", "PRD.md"), `# Product Vision

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

test("structured feature tasks preserve contracts and reject unresolved feature dependencies", () => {
  const root = createFeatureFixture();
  const task = { id: "foundation-task", title: "Foundation", description: "Build the foundation", ownerAgent: "api-engineer", dependencies: [], expectedOutputs: ["src/main.ts"], validationCommands: ["npm test"], contract: { version: 1, kind: "implementation", references: ["docs/features/foundation.md"], requirements: ["Foundation"], acceptanceCriteria: ["Tests pass"], constraints: [] } };
  writeFileSync(join(root, "docs/features/foundation.md"), '# Feature: Foundation\n## 5. Implementation Tasks\n### Phase 1: Foundation\n```forge-task\n' + JSON.stringify(task) + '\n```\n');
  const manifest = compileExecutionManifest(discoverForgeRepo(root));
  assert.equal(manifest.phases[0]!.tasks[0]!.id, task.id);
  assert.deepEqual(manifest.phases[1]!.tasks[0]!.inputs, ["work.foundation-task"]);
  const vision = join(root, "docs/PRD.md");
  writeFileSync(vision, readFileSync(vision, "utf8").replace("| Foundation | Must |", "| Missing | Must |"));
  assert.throws(() => compileExecutionManifest(discoverForgeRepo(root)), /unknown dependency 'Missing'/);
});

test("discoverForgeRepo detects the decomposed feature layout", () => {
  const root = createFeatureFixture();
  const repo = discoverForgeRepo(root);
  assert.equal(repo.sourceLayout, "features");
  assert.equal(repo.featurePaths.length, 3);
  assert.equal(normalize(repo.visionPath), normalize(join(root, "docs", "PRD.md")));
  assert.equal(repo.prdPath, repo.visionPath);
});

test("historical source documents never supply tasks or validation commands", () => {
  const root = createFixture();
  writeFileSync(join(root, "docs/product-vision.md"), "# Historical source\n## Validation\n`npm run obsolete`\n## Phase 1: Retired\n- Run obsolete work\n");
  const manifest = compileExecutionManifest(discoverForgeRepo(root));
  assert.equal(manifest.phases.flatMap((phase) => phase.tasks).length, 3);
  assert.ok(!manifest.validationCommands.includes("npm run obsolete"));
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
  writeFileSync(join(root, "docs", "PRD.md"), "# Product Vision\n\nNo features table.\n", "utf8");
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
  writeFileSync(join(root, "docs", "features", "foundation.md"), `# PRD

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
