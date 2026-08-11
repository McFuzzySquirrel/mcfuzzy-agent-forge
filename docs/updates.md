# Updates

Detailed release and change notes for McFuzzy Agent Forge.

---

## August 2026 - v3.5

### Dynamic Workflow Orchestration via `forge-workflow-engine`

- `forge-workflow-engine` (`templates/skills/forge-workflow-engine/`): runtime layer that reads `docs/EXECUTION-MANIFEST.json`, builds a live task DAG, dispatches agent invocations through a pluggable harness adapter, retries failed tasks, and syncs `docs/PROGRESS.md` and `docs/EXECUTION-AUDIT.jsonl` after every state transition.
- `workflow-orchestrator` (`templates/agents/workflow-orchestrator.md`): human-facing companion agent that handles pre-run verification, CLI invocation, blocker escalation, and post-run summaries.
- Three harness adapters ship in MVP: `OpenCodeAdapter` (shells out to `opencode run`), `OpenAIAdapter` (direct API), and `StubAdapter` (synthetic results for testing).
- Machine-readable run state is stored in `docs/WORKFLOW-STATE.json`; `docs/PROGRESS.md` stays in sync so existing `project-orchestrator`-style resume flows remain compatible.
- CLI supports `run`, `status`, `replay`, and `pause` operations.
- Opt-in Stage 5 for `forge-auto-build`: compile manifest with `forge-execution-adapter`, then execute autonomously with `workflow-engine run --harness opencode`. Stages 1–4 are unchanged.
- Auto-deployed by bootstrap scripts; no bootstrap changes required.

Related architecture decision:

- [ADR-014](adr/014-dynamic-workflow-orchestration.md): engine architecture, harness adapter interface, DAG ordering, retry policy, and integration with `forge-auto-build`.

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
