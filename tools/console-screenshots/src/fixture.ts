import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Deterministic Forge Console fixture.
 *
 * Every timestamp is fixed so captures are byte-stable across runs, and no
 * external authoring or model execution is involved: the fixture only writes
 * the docs/ files the Console reads.
 */

const HARNESS_ROOT = ".agents";
const RUN_ID = "run-2026-09-22";

export interface Fixture {
  root: string;
  repoRoot: string;
  homeDir: string;
  cleanup: () => void;
}

function touch(root: string, relative: string, content: string): void {
  const file = join(root, relative);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function json(root: string, relative: string, value: unknown): void {
  touch(root, relative, JSON.stringify(value, null, 2));
}

function jsonl(root: string, relative: string, values: unknown[]): void {
  touch(root, relative, values.map((value) => JSON.stringify(value)).join("\n"));
}

function agentFrontmatter(name: string, description: string, model: string, modelFallback: string, expertise: string[]): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    `model: ${model}`,
    `modelFallback: ${modelFallback}`,
    "---",
    "",
    `# ${name}`,
    "",
    "## Expertise",
    ...expertise.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

export async function buildFixture(repoRoot: string, homeDir: string): Promise<Fixture> {
  const root = dirname(repoRoot);
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(homeDir, { recursive: true, force: true });
  mkdirSync(join(repoRoot, ".git"), { recursive: true });
  mkdirSync(homeDir, { recursive: true });

  writeIdea(repoRoot);
  writePrd(repoRoot);
  writeFeatures(repoRoot);
  writeAgents(repoRoot);
  writeSkills(repoRoot);
  writeManifest(repoRoot);
  writeState(repoRoot);
  writeAudit(repoRoot);
  writeEngineLog(repoRoot);
  writeDocs(repoRoot);
  writeArtifacts(repoRoot);
  writeConfig(repoRoot);
  await writeAuthoringState(repoRoot);
  writeRegistry(homeDir, repoRoot);

  return {
    root,
    repoRoot,
    homeDir,
    cleanup: () => {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    },
  };
}

function writeIdea(repoRoot: string): void {
  touch(repoRoot, "docs/IDEA.md", [
    "# Ledgerly",
    "",
    "A small-team expense tracker: capture receipts, approve spend, and export",
    "clean books without a spreadsheet.",
    "",
    "## Why now",
    "- Finance currently reconciles three spreadsheets by hand every month.",
    "- Teams overspend because approvals happen after the fact.",
    "",
    "## Success looks like",
    "- A purchase is approved before the card statement lands.",
    "- The month closes without a manual reconciliation pass.",
  ].join("\n"));
}

function writePrd(repoRoot: string): void {
  touch(repoRoot, "docs/PRD.md", [
    "# Product Requirements: Ledgerly",
    "",
    "## 1. Overview",
    "",
    "Ledgerly gives a small company one place to capture spend, route approvals,",
    "and export bookkeeping-ready reports. It targets teams of 5-40 people who",
    "outgrew a shared spreadsheet but do not want a full ERP.",
    "",
    "## 2. Goals",
    "",
    "- Capture an expense in under 30 seconds from a phone.",
    "- Route each expense to the right approver automatically.",
    "- Export an accountant-ready ledger for any month.",
    "",
    "## 3. Non-goals",
    "",
    "- Payroll and invoicing.",
    "- Corporate card issuance.",
    "",
    "## 5. Functional requirements",
    "",
    "```forge-requirement",
    JSON.stringify({ id: "AUTH-FR-01", kind: "requirement", text: "Users sign in with a single-use email magic link." }),
    "```",
    "",
    "```forge-requirement",
    JSON.stringify({ id: "AUTH-FR-02", kind: "constraint", text: "Session tokens are HTTP-only and expire after 12 hours." }),
    "```",
    "",
    "```forge-requirement",
    JSON.stringify({ id: "EXP-FR-01", kind: "requirement", text: "An expense requires an amount, a merchant, and a category." }),
    "```",
    "",
    "```forge-requirement",
    JSON.stringify({ id: "EXP-FR-02", kind: "requirement", text: "Approvals of $500 or more require a second approver." }),
    "```",
    "",
    "```forge-requirement",
    JSON.stringify({ id: "REP-FR-01", kind: "requirement", text: "Monthly exports include per-category totals and receipt links." }),
    "```",
    "",
    "## 8. Non-functional requirements",
    "",
    "- p95 page interaction under 200ms on a mid-range laptop.",
    "- All amounts stored as integer minor units; no floating-point currency.",
    "- Every money movement is append-only auditable.",
    "",
    "## 14. Features",
    "",
    "| # | Feature | File | Dependencies |",
    "| - | --- | --- | --- |",
    "| 1 | Authentication | features/auth.md | None |",
    "| 2 | Capture & workspace | features/workspace.md | Authentication |",
    "| 3 | Reporting & billing | features/billing.md | Capture & workspace |",
    "",
    "## 15. Open questions",
    "",
    "- Do we support multi-currency receipts in the first release?",
    "- Which accounting export formats are mandatory (CSV, QBO, Xero)?",
  ].join("\n"));
}

function writeFeatures(repoRoot: string): void {
  touch(repoRoot, "docs/features/auth.md", featureDoc(
    "Authentication",
    "AUTH",
    [
      task("AUTH-1", "Magic-link sign in", "Issue and verify single-use magic-link tokens.", "api-engineer", [], ["auth-fr-01"], ["docs/PRD.md#5-functional-requirements"], ["Users can request and consume an email magic link."], ["src/auth/magic-link.ts"], ["npm test -- auth"]),
      task("AUTH-2", "Session management", "Create HTTP-only sessions with a 12-hour lifetime.", "api-engineer", ["AUTH-1"], ["auth-fr-02"], ["docs/PRD.md#5-functional-requirements"], ["Sessions are HTTP-only and expire after 12 hours."], ["src/auth/session.ts"], ["npm test -- session"]),
    ],
  ));

  touch(repoRoot, "docs/features/workspace.md", featureDoc(
    "Capture & workspace",
    "EXP",
    [
      task("EXP-1", "Expense capture", "Capture amount, merchant, category, and receipt.", "ui-engineer", ["AUTH-2"], ["exp-fr-01"], ["docs/PRD.md#5-functional-requirements"], ["A valid expense requires amount, merchant, and category."], ["src/expenses/capture.tsx"], ["npm test -- capture"]),
      task("EXP-2", "Approval routing", "Route expenses at or above $500 to a second approver.", "api-engineer", ["EXP-1"], ["exp-fr-02"], ["docs/PRD.md#5-functional-requirements"], ["A $500 expense requires two distinct approvals."], ["src/expenses/approvals.ts"], ["npm test -- approvals"]),
    ],
  ));

  touch(repoRoot, "docs/features/billing.md", featureDoc(
    "Reporting & billing",
    "REP",
    [
      task("REP-1", "Monthly export", "Export per-category totals and receipt links for a month.", "api-engineer", ["EXP-2"], ["rep-fr-01"], ["docs/PRD.md#5-functional-requirements"], ["Exports include per-category totals and receipt links."], ["src/reports/monthly.ts"], ["npm test -- reports"]),
      task("REP-2", "Reporting dashboard", "Surface spend by category, team, and month.", "ui-engineer", ["REP-1"], [], ["docs/PRD.md#2-goals"], ["The dashboard renders spend breakdowns without a manual refresh."], ["src/reports/dashboard.tsx"], ["npm test -- dashboard"]),
    ],
  ));
}

function featureDoc(title: string, code: string, tasks: string[]): string {
  return [
    `# Feature: ${title}`,
    "",
    `Requirement codes in this document use the \`${code}\` prefix and resolve against`,
    "docs/PRD.md.",
    "",
    ...tasks,
    "",
  ].join("\n");
}

function task(
  id: string,
  title: string,
  description: string,
  ownerAgent: string,
  dependencies: string[],
  requirementRefs: string[],
  references: string[],
  acceptanceCriteria: string[],
  expectedOutputs: string[],
  validationCommands: string[],
): string {
  return [
    "```forge-task",
    JSON.stringify({
      id,
      title,
      description,
      ownerAgent,
      dependencies,
      expectedOutputs,
      validationCommands,
      contract: {
        version: 1,
        kind: "implementation",
        requirements: [],
        requirementRefs,
        acceptanceCriteria,
        constraints: [],
        constraintRefs: [],
        references,
      },
    }),
    "```",
  ].join("\n");
}

function writeAgents(repoRoot: string): void {
  touch(repoRoot, `${HARNESS_ROOT}/agents/api-engineer.md`, agentFrontmatter(
    "api-engineer",
    "Owns the API, persistence, and authentication surface.",
    "github-copilot/claude-sonnet-4.5",
    "opencode/qwen3-coder",
    ["REST and service design", "Relational persistence", "Authentication and sessions"],
  ));
  touch(repoRoot, `${HARNESS_ROOT}/agents/ui-engineer.md`, agentFrontmatter(
    "ui-engineer",
    "Owns the React UI, forms, and accessible interactions.",
    "github-copilot/gpt-5.6-luna",
    "opencode/qwen3-coder",
    ["React and state management", "Accessible form design", "Data visualisation"],
  ));
  touch(repoRoot, `${HARNESS_ROOT}/agents/qa-engineer.md`, agentFrontmatter(
    "qa-engineer",
    "Owns test strategy, coverage, and release quality gates.",
    "opencode/qwen3-coder",
    "github-copilot/gpt-5.6-luna",
    ["Unit and integration testing", "Release validation", "Regression triage"],
  ));
}

function writeSkills(repoRoot: string): void {
  touch(repoRoot, `${HARNESS_ROOT}/skills/add-endpoint/SKILL.md`, [
    "---",
    "name: add-endpoint",
    "description: Adds a REST endpoint following project conventions.",
    "---",
    "",
    "# Skill: Add Endpoint",
    "",
    "Scaffold a route, handler, validation, and test for a new API endpoint.",
  ].join("\n"));
  touch(repoRoot, `${HARNESS_ROOT}/skills/design-system/SKILL.md`, [
    "---",
    "name: design-system",
    "description: Applies the Ledgerly design system to new UI.",
    "---",
    "",
    "# Skill: Design System",
    "",
    "Use the shared spacing scale, colour tokens, and accessible components.",
  ].join("\n"));
  touch(repoRoot, `${HARNESS_ROOT}/skills/forge-workflow-engine/SKILL.md`, [
    "---",
    "name: forge-workflow-engine",
    "description: Autonomous execution engine for MyForge manifests.",
    "---",
    "",
    "# Skill: Workflow Engine",
  ].join("\n"));
}

interface FixtureTask {
  id: string;
  title: string;
  description: string;
  ownerAgent: string;
  dependencies: string[];
  expectedOutputs: string[];
  validationCommands: string[];
  requirementRefs: string[];
  acceptanceCriteria: string[];
  inputs?: string[];
  produces?: string;
}

function manifestTask(task: FixtureTask) {
  return {
    id: task.id,
    contract: {
      version: 1,
      kind: "implementation",
      requirements: [],
      requirementRefs: task.requirementRefs,
      acceptanceCriteria: task.acceptanceCriteria,
      constraints: [],
      constraintRefs: [],
      references: ["docs/PRD.md"],
    },
    title: task.title,
    description: task.description,
    ownerAgent: task.ownerAgent,
    requiredCapabilities: ["repository-tools"],
    dependencies: task.dependencies,
    expectedOutputs: task.expectedOutputs,
    validationCommands: task.validationCommands,
    approvalRequired: false,
    sourceLines: [],
    ...(task.inputs ? { inputs: task.inputs } : {}),
    ...(task.produces ? { produces: task.produces } : {}),
  };
}

function writeManifest(repoRoot: string): void {
  json(repoRoot, "docs/EXECUTION-MANIFEST.json", {
    version: "1.0",
    generatedAt: "2026-09-22T12:00:00.000Z",
    granularity: "fine",
    sourceLayout: "features",
    repoRoot,
    harnessRoot: HARNESS_ROOT,
    prdPath: "docs/PRD.md",
    visionPath: "docs/PRD.md",
    featureOrder: ["Authentication", "Capture & workspace", "Reporting & billing"],
    responsibilityMatrixPath: "docs/AGENT-RESPONSIBILITY-MATRIX.md",
    progressPath: "docs/PROGRESS.md",
    auditPath: "docs/EXECUTION-AUDIT.jsonl",
    validationCommands: [],
    approvalGates: { preflight: true, betweenPhases: true },
    phases: [
      {
        id: "1",
        title: "Foundation",
        description: "Authentication and the persistence layer.",
        feature: "Authentication",
        ownerAgents: ["api-engineer"],
        dependencies: [],
        approvalRequired: false,
        tasks: [
          manifestTask({ id: "1.1", title: "Scaffold workspace", description: "Set up the app, build tooling, and CI entry points.", ownerAgent: "api-engineer", dependencies: [], expectedOutputs: ["package.json", "src/index.ts"], validationCommands: ["npm run typecheck"], requirementRefs: [], acceptanceCriteria: ["The workspace builds and type-checks."] }),
          manifestTask({ id: "1.2", title: "Magic-link sign in", description: "Issue and verify single-use magic-link tokens.", ownerAgent: "api-engineer", dependencies: ["1.1"], expectedOutputs: ["src/auth/magic-link.ts"], validationCommands: ["npm test -- auth"], requirementRefs: ["AUTH-FR-01"], acceptanceCriteria: ["Users can request and consume an email magic link."] }),
          manifestTask({ id: "1.3", title: "Session management", description: "Create HTTP-only sessions with a 12-hour lifetime.", ownerAgent: "api-engineer", dependencies: ["1.2"], expectedOutputs: ["src/auth/session.ts"], validationCommands: ["npm test -- session"], requirementRefs: ["AUTH-FR-02"], acceptanceCriteria: ["Sessions are HTTP-only and expire after 12 hours."] }),
        ],
      },
      {
        id: "2",
        title: "Experience",
        description: "Capture, approvals, and reporting.",
        feature: "Capture & workspace",
        ownerAgents: ["ui-engineer", "api-engineer"],
        dependencies: ["1"],
        approvalRequired: false,
        tasks: [
          manifestTask({ id: "2.1", title: "Expense capture", description: "Capture amount, merchant, category, and receipt.", ownerAgent: "ui-engineer", dependencies: ["1.3"], expectedOutputs: ["src/expenses/capture.tsx"], validationCommands: ["npm test -- capture"], requirementRefs: ["EXP-FR-01"], acceptanceCriteria: ["A valid expense requires amount, merchant, and category."], produces: "solution.capture" }),
          manifestTask({ id: "2.2", title: "Approval routing", description: "Route expenses at or above $500 to a second approver.", ownerAgent: "api-engineer", dependencies: ["2.1"], expectedOutputs: ["src/expenses/approvals.ts"], validationCommands: ["npm test -- approvals"], requirementRefs: ["EXP-FR-02"], acceptanceCriteria: ["A $500 expense requires two distinct approvals."], inputs: ["solution.capture"], produces: "solution.approvals" }),
        ],
      },
      {
        id: "3",
        title: "Hardening",
        description: "Reporting, validation, and release.",
        feature: "Reporting & billing",
        ownerAgents: ["qa-engineer", "api-engineer"],
        dependencies: ["2"],
        approvalRequired: false,
        tasks: [
          manifestTask({ id: "3.1", title: "Monthly export", description: "Export per-category totals and receipt links.", ownerAgent: "api-engineer", dependencies: ["2.2"], expectedOutputs: ["src/reports/monthly.ts"], validationCommands: ["npm test -- reports"], requirementRefs: ["REP-FR-01"], acceptanceCriteria: ["Exports include per-category totals and receipt links."] }),
          manifestTask({ id: "3.2", title: "Reporting dashboard", description: "Surface spend by category, team, and month.", ownerAgent: "ui-engineer", dependencies: ["3.1"], expectedOutputs: ["src/reports/dashboard.tsx"], validationCommands: ["npm test -- dashboard"], requirementRefs: [], acceptanceCriteria: ["The dashboard renders spend breakdowns without a manual refresh."] }),
          manifestTask({ id: "3.3", title: "Release validation", description: "Run the full suite and record release evidence.", ownerAgent: "qa-engineer", dependencies: ["3.2"], expectedOutputs: ["docs/RELEASE-EVIDENCE.md"], validationCommands: ["npm test"], requirementRefs: [], acceptanceCriteria: ["The full suite passes and evidence is recorded."] }),
        ],
      },
    ],
    warnings: [],
  });
}

function writeState(repoRoot: string): void {
  const task = (taskId: string, status: string, overrides: Record<string, unknown> = {}) => ({
    taskId,
    status,
    attempt: 1,
    outputFiles: [],
    ...overrides,
  });
  json(repoRoot, "docs/WORKFLOW-STATE.json", {
    runId: RUN_ID,
    startedAt: "2026-09-22T12:05:00.000Z",
    lastUpdatedAt: "2026-09-22T14:02:11.000Z",
    manifestPath: "docs/EXECUTION-MANIFEST.json",
    manifestVersion: "1.0",
    harness: "opencode",
    status: "running",
    currentPhase: "2",
    tasks: {
      "1.1": task("1.1", "complete", { ownerAgent: "api-engineer", startedAt: "2026-09-22T12:05:10.000Z", completedAt: "2026-09-22T12:11:42.000Z", outputFiles: ["package.json", "src/index.ts"], artifactId: "solution-001" }),
      "1.2": task("1.2", "complete", { ownerAgent: "api-engineer", startedAt: "2026-09-22T12:12:00.000Z", completedAt: "2026-09-22T12:24:18.000Z", outputFiles: ["src/auth/magic-link.ts"], artifactId: "solution-001" }),
      "1.3": task("1.3", "complete", { ownerAgent: "api-engineer", startedAt: "2026-09-22T12:25:00.000Z", completedAt: "2026-09-22T12:39:51.000Z", outputFiles: ["src/auth/session.ts"], artifactId: "decision-001" }),
      "2.1": task("2.1", "complete", { ownerAgent: "ui-engineer", startedAt: "2026-09-22T13:05:00.000Z", completedAt: "2026-09-22T13:31:07.000Z", outputFiles: ["src/expenses/capture.tsx"], artifactId: "solution-002" }),
      "2.2": task("2.2", "running", { ownerAgent: "api-engineer", startedAt: "2026-09-22T13:58:00.000Z" }),
      "3.1": task("3.1", "failed", { attempt: 2, ownerAgent: "api-engineer", startedAt: "2026-09-22T13:40:00.000Z", completedAt: "2026-09-22T13:52:33.000Z", errorMessage: "Validation command failed: npm test -- reports (exit 1)", failureKind: "retryable" }),
      "3.2": task("3.2", "pending", { ownerAgent: "ui-engineer" }),
      "3.3": task("3.3", "pending", { ownerAgent: "qa-engineer" }),
    },
    blockers: [],
    auditLog: [],
    selection: { mode: "auto", taskIds: [] },
  });
}

function writeAudit(repoRoot: string): void {
  const event = (timestamp: string, action: string, extra: Record<string, unknown> = {}) => ({
    timestamp,
    action,
    runId: RUN_ID,
    ...extra,
  });
  jsonl(repoRoot, "docs/EXECUTION-AUDIT.jsonl", [
    event("2026-09-22T12:05:00.000Z", "run.started", { note: "harness=opencode" }),
    event("2026-09-22T12:05:05.000Z", "phase.started", { phaseId: "1" }),
    event("2026-09-22T12:05:10.000Z", "task.started", { taskId: "1.1", phaseId: "1", attempt: 1 }),
    event("2026-09-22T12:11:42.000Z", "task.complete", { taskId: "1.1", phaseId: "1", durationMs: 392000, outputFiles: ["package.json", "src/index.ts"] }),
    event("2026-09-22T12:11:44.000Z", "task.committed", { taskId: "1.1", commitSha: "9f3c1a7d2e5b4c8a1f0d3e6b9a2c5f8d1e4b7a0c" }),
    event("2026-09-22T12:12:00.000Z", "task.started", { taskId: "1.2", phaseId: "1", attempt: 1 }),
    event("2026-09-22T12:18:30.000Z", "context.projected", { taskId: "1.2", sourceTokenEstimate: 48210, projectedTokenEstimate: 12440, reductionPercent: 74.2, note: "3 artifact(s) projected for task 1.2" }),
    event("2026-09-22T12:24:18.000Z", "task.complete", { taskId: "1.2", phaseId: "1", durationMs: 738000, outputFiles: ["src/auth/magic-link.ts"] }),
    event("2026-09-22T12:25:00.000Z", "task.started", { taskId: "1.3", phaseId: "1", attempt: 1 }),
    event("2026-09-22T12:39:51.000Z", "task.complete", { taskId: "1.3", phaseId: "1", durationMs: 891000, outputFiles: ["src/auth/session.ts"] }),
    event("2026-09-22T12:40:00.000Z", "phase.complete", { phaseId: "1" }),
    event("2026-09-22T13:05:00.000Z", "phase.started", { phaseId: "2" }),
    event("2026-09-22T13:05:00.000Z", "task.started", { taskId: "2.1", phaseId: "2", attempt: 1 }),
    event("2026-09-22T13:31:07.000Z", "task.complete", { taskId: "2.1", phaseId: "2", durationMs: 1567000, outputFiles: ["src/expenses/capture.tsx"] }),
    event("2026-09-22T13:40:00.000Z", "task.started", { taskId: "3.1", phaseId: "3", attempt: 1 }),
    event("2026-09-22T13:52:33.000Z", "task.attempt.finished", { taskId: "3.1", phaseId: "3", attempt: 1, durationMs: 753000, note: "outputs gate failed: expected src/reports/monthly.ts" }),
    event("2026-09-22T13:52:35.000Z", "task.retrying", { taskId: "3.1", attempt: 2, note: "outputs gate failed: expected src/reports/monthly.ts" }),
    event("2026-09-22T13:58:00.000Z", "task.started", { taskId: "2.2", phaseId: "2", attempt: 1 }),
    event("2026-09-22T14:02:11.000Z", "state.saved", { note: "after wave" }),
  ]);
}

function writeEngineLog(repoRoot: string): void {
  touch(repoRoot, "docs/engine-run.log", [
    "[engine] Forge Workflow Engine starting (harness=opencode, concurrency=1)",
    `[engine] harness invocation [requested] at=2026-09-22T13:58:00.000Z harness=opencode run=${RUN_ID} task=2.2 attempt=1 cwd=` + JSON.stringify(repoRoot) + " exec=\"opencode\" args=[\"run\",\"--model\",\"github-copilot/claude-sonnet-4.5\",\"--agent\",\"api-engineer\",\"--dir\"," + JSON.stringify(repoRoot) + ",\"--auto\",\"docs/artifacts/2.2.md\"]",
    "[engine] harness activity stdout task=2.2 attempt=1 at=2026-09-22T13:58:04.000Z Reading execution file docs/artifacts/2.2.md",
    "[engine] harness activity stdout task=2.2 attempt=1 at=2026-09-22T13:58:19.000Z Implementing approveExpense() with the two-approver rule for >= $500",
    "[engine] harness activity stderr task=2.2 attempt=1 at=2026-09-22T13:59:02.000Z warning: receipt upload skipped (no object store configured)",
    "[engine] …still working on task 2.2 (@api-engineer, 60s elapsed)",
    "[engine] === Phase 2 ===",
    "[engine] Task 2.1 complete (1567000ms)",
    "[engine] Task 2.1 committed (7c2e9b1)",
    "[engine] Warning: 1 task(s) completed with no recorded output files: 1.2",
    "[engine] Context projected for 2.2: ~12440 tokens (74.2% reduction from ~48210)",
    "[engine] …still working on task 2.2 (@api-engineer, 120s elapsed)",
  ].join("\n"));
}

function writeDocs(repoRoot: string): void {
  touch(repoRoot, "docs/PROGRESS.md", [
    "# Progress",
    "",
    `Run: ${RUN_ID} (opencode)`,
    "",
    "| Phase | Task | Owner | Status |",
    "| --- | --- | --- | --- |",
    "| 1 Foundation | 1.1 Scaffold workspace | api-engineer | Complete |",
    "| 1 Foundation | 1.2 Magic-link sign in | api-engineer | Complete |",
    "| 1 Foundation | 1.3 Session management | api-engineer | Complete |",
    "| 2 Experience | 2.1 Expense capture | ui-engineer | Complete |",
    "| 2 Experience | 2.2 Approval routing | api-engineer | In Progress |",
    "| 3 Hardening | 3.1 Monthly export | api-engineer | Failed |",
    "| 3 Hardening | 3.2 Reporting dashboard | ui-engineer | Pending |",
    "| 3 Hardening | 3.3 Release validation | qa-engineer | Pending |",
  ].join("\n"));

  touch(repoRoot, "docs/MODEL-PLAN.md", [
    "# Model Plan",
    "",
    "| Agent | Primary | Fallback |",
    "| --- | --- | --- |",
    "| api-engineer | github-copilot/claude-sonnet-4.5 | opencode/qwen3-coder |",
    "| ui-engineer | github-copilot/gpt-5.6-luna | opencode/qwen3-coder |",
    "| qa-engineer | opencode/qwen3-coder | github-copilot/gpt-5.6-luna |",
  ].join("\n"));

  touch(repoRoot, "docs/research/notes.md", [
    "# Research notes",
    "",
    "- Accounting exports: QBO and Xero both accept a CSV with category totals.",
    "- Magic links beat passwords for a 5-40 person internal tool.",
  ].join("\n"));

  json(repoRoot, "docs/research/model-inventory.json", {
    last_verified: "2026-09-20T09:00:00.000Z",
    copilot_cli: { available: true, last_verified: "2026-09-20T09:00:00.000Z", models: [
      { id: "github-copilot/claude-sonnet-4.5", name: "Claude Sonnet 4.5", tool_calling: true },
      { id: "github-copilot/gpt-5.6-luna", name: "GPT-5.6 Luna", tool_calling: true },
    ] },
    opencode_cli: { available: true, last_verified: "2026-09-20T09:00:00.000Z", models: [
      { id: "opencode/qwen3-coder", name: "Qwen3 Coder", tool_calling: true },
      { id: "opencode/grok-code", name: "Grok Code", tool_calling: true },
      { id: "opencode/kimi-k2", name: "Kimi K2", tool_calling: true },
    ] },
  });

  json(repoRoot, "docs/AGENT-RESPONSIBILITY-MATRIX.md", {});
}

function writeArtifacts(repoRoot: string): void {
  const artifact = (overrides: Record<string, unknown>) => ({
    category: "work",
    status: "complete",
    confidence: 0.9,
    inputs: [],
    nextActions: [],
    ...overrides,
  });
  json(repoRoot, "docs/artifacts/solution/solution-001.json", artifact({
    artifactId: "solution-001",
    type: "solution.architecture",
    taskId: "1.1",
    producedBy: "api-engineer",
    summary: "Workspace scaffold and module boundaries decided.",
    createdAt: "2026-09-22T12:11:42.000Z",
    filesChanged: ["package.json", "src/index.ts", "tsconfig.json"],
    payload: { decision: "Vite + React + Express", rationale: "Small operational surface for a 5-40 person team." },
  }));
  json(repoRoot, "docs/artifacts/solution/solution-002.json", artifact({
    artifactId: "solution-002",
    type: "solution.capture",
    taskId: "2.1",
    producedBy: "ui-engineer",
    summary: "Expense capture form with inline validation.",
    createdAt: "2026-09-22T13:31:07.000Z",
    filesChanged: ["src/expenses/capture.tsx"],
    payload: { fields: ["amount", "merchant", "category", "receipt"], validation: "client and server" },
  }));
  json(repoRoot, "docs/artifacts/decision/decision-001.json", artifact({
    artifactId: "decision-001",
    type: "decision.interface",
    taskId: "1.3",
    producedBy: "api-engineer",
    summary: "Session cookie contract fixed for the auth surface.",
    createdAt: "2026-09-22T12:39:51.000Z",
    filesChanged: ["src/auth/session.ts"],
    payload: { cookie: "ledgerly_session", sameSite: "Lax", maxAgeSeconds: 43200, httpOnly: true },
  }));
  json(repoRoot, "docs/artifacts/review/review-001.json", artifact({
    artifactId: "review-001",
    type: "review.result",
    taskId: "1.2",
    producedBy: "qa-engineer",
    summary: "Magic-link verification passed review with two minor notes.",
    createdAt: "2026-09-22T12:24:20.000Z",
    filesChanged: [],
    payload: { outcome: "approved-with-notes", notes: ["Add rate limiting later", "Log failed verifications"] },
  }));
}

function writeConfig(repoRoot: string): void {
  json(repoRoot, "docs/engine-config.json", {
    harness: "opencode",
    granularity: "fine",
    concurrency: "3",
    taskTimeoutMs: "600000",
    maxRetries: "2",
    viz: false,
    vizPort: "",
    keepAlive: true,
    attach: "",
    autoCommit: true,
    logHarnessActivity: false,
    executionMode: "auto",
    selectedTaskIds: [],
  });
  json(repoRoot, "docs/authoring-config.json", {
    version: 1,
    models: {
      prd: "opencode/qwen3-coder",
      team: "opencode/grok-code",
      skills: "opencode/kimi-k2",
    },
    runner: "opencode",
  });
  jsonl(repoRoot, "docs/AUTHORING-EVENTS.jsonl", [
    { type: "authoring.started", operation: "prd", timestamp: "2026-09-22T10:00:00.000Z" },
    { type: "authoring.complete", operation: "prd", timestamp: "2026-09-22T10:14:00.000Z" },
    { type: "authoring.started", operation: "team", timestamp: "2026-09-22T10:15:00.000Z" },
    { type: "authoring.complete", operation: "team", timestamp: "2026-09-22T10:27:00.000Z" },
    { type: "authoring.started", operation: "skills", timestamp: "2026-09-22T10:28:00.000Z" },
    { type: "authoring.complete", operation: "skills", timestamp: "2026-09-22T10:33:00.000Z" },
  ]);
}

/**
 * Seeds docs/authoring-state.json with current fingerprints so the Overview
 * pipeline shows every authoring stage complete. The fingerprint helpers live
 * in the launcher's compiled dist (built before capture); if it is unavailable
 * the state file is omitted, which `authoringReadiness` treats as ready.
 */
async function writeAuthoringState(repoRoot: string): Promise<void> {
  const distUrl = pathToFileURL(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../scripts/forge-launcher/dist/authoring-state.js"),
  ).href;
  let module: {
    stageInputFingerprint: (repo: string, stage: string, harnessRoot: string) => string;
    fingerprintFiles: (repo: string, inputs: string[]) => string;
  };
  try {
    module = await import(distUrl) as typeof module;
  } catch {
    return;
  }
  const stages = {
    prd: { outputs: ["docs/PRD.md", "docs/features"] },
    team: { outputs: [`${HARNESS_ROOT}/agents`] },
    skills: { outputs: [`${HARNESS_ROOT}/skills`] },
  } as const;
  const state: Record<string, unknown> = { version: 1, stages: {} };
  const stageState: Record<string, unknown> = {};
  for (const [stage, { outputs }] of Object.entries(stages)) {
    stageState[stage] = {
      status: "complete",
      inputFingerprint: module.stageInputFingerprint(repoRoot, stage, HARNESS_ROOT),
      outputs,
      outputFingerprint: module.fingerprintFiles(repoRoot, [...outputs]),
      startedAt: "2026-09-22T09:40:00.000Z",
      completedAt: `2026-09-22T10:0${stage === "prd" ? 0 : stage === "team" ? 1 : 2}:00.000Z`,
    };
  }
  state.stages = stageState;
  json(repoRoot, "docs/authoring-state.json", state);
}

function writeRegistry(homeDir: string, repoRoot: string): void {
  json(homeDir, "projects.json", [
    { path: repoRoot, name: "ledgerly", harness: "agents", createdAt: "2026-09-22T09:30:00.000Z", lastOpenedAt: "2026-09-22T14:00:00.000Z" },
    { path: join(homeDir, "acme-portal"), name: "acme-portal", harness: "github", createdAt: "2026-08-04T11:00:00.000Z", lastOpenedAt: "2026-09-12T16:20:00.000Z" },
    { path: join(homeDir, "inventory-sync"), name: "inventory-sync", harness: "claude", createdAt: "2026-07-18T08:15:00.000Z", lastOpenedAt: "2026-09-02T09:05:00.000Z" },
  ]);
}
