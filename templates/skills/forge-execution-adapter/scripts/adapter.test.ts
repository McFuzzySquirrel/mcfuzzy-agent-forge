import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileExecutionManifest } from "./compiler.ts";
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
