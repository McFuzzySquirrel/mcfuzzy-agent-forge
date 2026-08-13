# Updates

Detailed release and change notes for McFuzzy Agent Forge.

---

## August 2026 - v3.6

### Workforce compiler + optional FlowForge kernel handoff

- Added `forge-workforce-compiler` (`templates/skills/forge-workforce-compiler/`): portable TypeScript tooling that compiles Forge artifacts into `dist/<package-id>.workforce`, writes FlowForge-style `workforce.json` + workflow files, and emits `docs/KERNEL-BRIDGE.json` for task/node mapping and state/audit bridge metadata.
- Added a FlowForge-compatible schema gate to the compiler (`validate` command and post-compile fail-fast validation).
- Added optional `flowforge-kernel` harness mode to `forge-workflow-engine` so Stage 4 execution can hand off to FlowForge CLI/runtime while preserving existing `opencode`, `openai`, and `stub` modes.
- Added [`docs/workforce-compiler-deep-dive.md`](workforce-compiler-deep-dive.md): deep technical walkthrough of compiler packaging, validation gate, and kernel handoff integration.
- Expanded [`docs/testing-guide.md`](testing-guide.md) with a dedicated manual test path for workforce compilation and FlowForge kernel handoff.
- Updated docs and prompt playbook with the new compile + kernel execution path.

Related architecture decision:

- [ADR-016](adr/016-forge-workforce-compiler-and-kernel-handoff.md): Forge-as-authoring + kernel-as-execution boundary, interop contract v1, and state/audit bridge policy.

---

## August 2026 - v3.5

### Dynamic Workflow Orchestration via `forge-workflow-engine`

- `forge-workflow-engine` (`templates/skills/forge-workflow-engine/`): runtime layer that reads `docs/EXECUTION-MANIFEST.json`, builds a live task DAG, dispatches agent invocations through a pluggable harness adapter, retries failed tasks, and syncs `docs/PROGRESS.md` and `docs/EXECUTION-AUDIT.jsonl` after every state transition.
- `workflow-orchestrator` (`templates/agents/workflow-orchestrator.md`): human-facing companion agent that handles pre-run verification, CLI invocation, blocker escalation, and post-run summaries.
- Three harness adapters ship in MVP: `OpenCodeAdapter` (shells out to `opencode run`), `OpenAIAdapter` (direct API), and `StubAdapter` (synthetic results for testing).
- Machine-readable run state is stored in `docs/WORKFLOW-STATE.json`; `docs/PROGRESS.md` stays in sync so existing `project-orchestrator`-style resume flows remain compatible.
- CLI supports `run`, `status`, `replay`, and `pause` operations.
- `forge-auto-build` now supports either/or build execution: the default Stage 4 path uses `forge-orchestrate-build`, while `GO --workflow-engine` switches Stage 4 to manifest compilation plus autonomous execution with `workflow-engine run --harness opencode`.
- Auto-deployed by bootstrap scripts; no bootstrap changes required.

Related architecture decision:

- [ADR-014](adr/014-dynamic-workflow-orchestration.md): engine architecture, harness adapter interface, DAG ordering, retry policy, and integration with `forge-auto-build`.

### Manual Testing Guide

- [`docs/testing-guide.md`](testing-guide.md): step-by-step manual verification guide covering (1) skill creation from the team builder - confirming `skill-creator` and `skill-review` are invoked and the quality gate is enforced - and (2) workflow engine dark orchestration - verifying manifest compilation, the pre-run gate, autonomous task dispatch, state sync, resume, retry, and replay. Includes a plain-language explanation of "dark orchestration" (background/autonomous execution, not anything security-related) and a troubleshooting section.

---

## August 2026 - v3.4

### Auto-build input auto-detection and launcher handoff alignment

- `forge-auto-build` Step 0 now supports resolving input from repository context when invoked without an explicit argument.
- Input resolution flow now prioritizes explicit user input, then checks `docs/PRD.md`, `docs/IDEA.md`, and `IDEA.md`.
- If multiple candidate sources are present, the skill asks the user to choose one source for that run.
- Launcher handoff guidance now points to `docs/IDEA.md` as the canonical source.

Related architecture decision:

- [ADR-013](adr/013-auto-build-input-auto-detection.md): Auto-detect input source in `forge-auto-build` Step 0.

---

## August 2026 - v3.3

### Forge Execution Adapter - contract-driven bridge for external runners

- `forge-execution-adapter` (`templates/skills/forge-execution-adapter/`): portable TypeScript tooling that discovers a Forge repo, normalizes harness roots, compiles `docs/EXECUTION-MANIFEST.json`, synchronizes `docs/PROGRESS.md`, and appends `docs/EXECUTION-AUDIT.jsonl` for FlowForge-style backends.

Related architecture decision:

- [ADR-011](adr/011-forge-execution-adapter.md): Adapter architecture, MVP scope, and rationale for keeping the bridge separate from Agent Forge authoring.

---

## August 2026 - v3.2

### Forge Launcher - interactive CLI for the full lifecycle

- `forge-launcher` (`scripts/forge-launcher.sh` and `scripts/forge-launcher.ps1`): one terminal command guides users from zero to auto-build by creating a repo, selecting a harness, bootstrapping Agent Forge, capturing project idea context, committing, and optionally spawning the harness CLI.
- Terminal launch hardening and fallback guidance for CLI harnesses.
- PRD-first guidance and seed-document recommendations added to launcher flow docs.

Related architecture decisions:

- [ADR-010](adr/010-forge-launcher.md): launcher design rationale and lifecycle structure.
- [ADR-012](adr/012-launcher-terminal-handoff-and-prd-guidance.md): terminal handoff hardening and PRD-first guidance.

---

## August 2026 - v3.1

### Full auto build, end-to-end pipeline in one command

- `forge-auto-build` meta-skill: one command from one-liner idea (or existing PRD) to fully built, validated, and committed project.
- Single pre-flight gate followed by autonomous execution: PRD -> agent team -> optional model assignment -> all build phases, with validation and commits after each phase.

Related architecture decision:

- [ADR-009](adr/009-full-auto-build-meta-skill.md): rationale and relationship to `forge-bootstrap-project`.

---

## August 2026 - v3.0

### Skill-Forge integration and framework-agnostic skill creation

- Added three integrated skills from skill-forge: `skill-creator`, `skill-review`, and `skill-review-updater`.
- `forge-build-agent-team` now invokes `skill-creator` for project-specific skill generation and validation.
- `skill-review` includes portable TypeScript tooling and CI providers (GitHub Actions, GitLab CI, Azure DevOps).
- Removed `forge-build-agent-framework-solution` to keep the forge framework-agnostic.

Related architecture decision:

- [ADR-008](adr/008-skill-forge-integration.md): integration rationale and expected outcomes.

---

## June 2026 - v2

### Harness-agnostic structure, leaner skills, and built-in best practices

- `.agents/` migration: default bootstrap now targets `.agents/` for harness portability.
- Progressive disclosure adoption: forge skills moved large details to `references/` content.
- Added `## Gotchas` and `## Validation` sections to forge skills and generated skills.
- Added `forge-optimize-skills` for skill quality audits and improvement guidance.

Related architecture decisions:

- [ADR-006](adr/006-agents-directory-migration.md)
- [ADR-007](adr/007-skill-best-practices-adoption.md)

For measured efficiency changes and before/after detail:

- [docs/research/forge-optimization-value.md](research/forge-optimization-value.md)
