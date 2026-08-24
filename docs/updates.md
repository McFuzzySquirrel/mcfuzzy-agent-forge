# Updates

Detailed release and change notes for McFuzzy Agent Forge.

---

## August 2026 - v3.11

### Workflow-engine heartbeat, OpenCode adapter fix, and clearer engine handoff

- **OpenCode adapter no longer passes `--system-prompt`.** `opencode run` (v1.18+)
  has no such flag, so the previous invocation printed the CLI usage and failed
  every task. The agent persona (`agent.rawBody`) is now inlined into the prompt,
  matching the copilot and openai adapters. Docs (SKILL.md, deep-dive) updated.
- **Shell-safe child invocation.** The `opencode` and `copilot` adapters now use
  asynchronous `spawn` (via a shared `harness/run.ts`) instead of `spawnSync`
  with a shell string. This fixes `/bin/sh` interpolation errors from backticks
  and `$` in agent bodies, and keeps the event loop free for the heartbeat.
- **Engine heartbeat.** While a task is executing, the engine prints
  `…still working on task <id> (@<agent>, Ns elapsed)` every
  `--heartbeat-ms <ms>` (default 15s; `0` disables, `FORGE_ENGINE_HEARTBEAT_MS`
  env override) so a quiet terminal doesn't look hung.
- **`--yes` actually skips the pre-run gate.** The boolean flag was parsed with a
  value-expecting helper, so it never matched; added a proper `hasFlag` check
  (alongside `FORGE_ENGINE_YES=1`).
- **Clearer engine handoff in the launcher.** Choosing "Run the workflow-engine
  build now (detached)" now sets an engine-started flag, skips the subsequent
  interactive CLI launch prompt, prints `tail -f` / `Get-Content -Wait` monitor
  commands, and makes the Step 9 summary reflect the running engine instead of
  the manual `@workspace /forge-auto-build` steps. Fixed the `Skip -I will…`
  menu typo. (Bash + PowerShell.)

---

## August 2026 - v3.10

### Forge launcher: auto-draft flow and friendlier path input

The launcher's interactive and headless paths get three quality-of-life upgrades
for getting from an idea to a reviewable PRD/team to an engine run.

- **Path prompts support Tab completion and shell shorthand.** Parent-directory,
  PRD, and research/seed path prompts now use bash readline (`read -e`) on Bash
  and PSReadLine (`PSConsoleReadLine::ReadLine`) on PowerShell for **Tab
  completion** to existing files/folders. Typed paths also expand `~`, `~/`,
  `~user`, and `$VAR` / `${VAR}` (e.g. `$HOME/docs/prd.md`) before validation -
  so external PRD/seed locations work without typing full absolute paths.
  Validation now normalises paths (`realpath -m`) and reports *"file not found"*
  vs. *"not a regular file"* distinctly.
- **Optional auto-draft flow.** At Step 8, the launcher can run the authoring
  stages non-interactively with **review boundaries**:
  - **Idea → PRD:** runs `forge-auto-build-prd` headless (auto-proceed, every
    unknown recorded as an Open Question), commits `docs: add auto-drafted PRD`,
    then points you at the result (monolithic or decomposed) for review.
  - **PRD → team:** runs `forge-build-agent-team` headless, commits
    `feat: generate auto-drafted agent team`, then points you at the generated
    agents/skills for review. When a decomposed layout exists, the team is built
    from `docs/product-vision.md` + `docs/features/*.md` (Vision + Features
    mode); otherwise from `docs/PRD.md`.
  - **Engine decision:** after the team, choose to run the workflow engine now
    (detached via `forge-engine-run.sh --repo <repo> --harness <h> --yes`), print
    the command to run later, or skip and build manually.
  - Exposed as interactive prompts, pre-answered with `--draft` (`-Draft` on
    PowerShell), or forced headlessly with `FORGE_AUTO_DRAFT=1`.
- **Generalised headless runner.** The queued-skill headless path and the
  auto-draft stages share `headless_cmd_for` / `run_skill_headless` (Bash) and
  `Get-HeadlessCommandFor` / `Invoke-SkillHeadless` (PowerShell), so `--headless`,
  `--draft`, and `FORGE_AUTO_DRAFT=1` all print the same `opencode run --auto` /
  `copilot -p --yolo` command shape under `--dry-run`.
- **"Still running" indicator.** Long-running steps (bootstrap, headless/auto-draft
  skill runs, GitHub repo creation, push) show a periodic `still running… Ns`
  heartbeat (Bash: `run_with_heartbeat`, TTY-only and zombie-safe; PowerShell:
  indeterminate `Write-Progress`) so users don't think the launcher is hung.
  Output stays visible, and the interval is configurable via
  `FORGE_HEARTBEAT_INTERVAL` (default `15`s). Skipped for piped/CI output.

Related architecture decision:

- [ADR-020](adr/020-launcher-auto-draft-and-path-input.md): auto-draft review-boundary flow and path-input handling.

---

## August 2026 - v3.9

### Authoring/execution split, detached engine, and GitHub Copilot harness

The workflow engine no longer runs *inside* the CLI session. Authoring (PRD → team → manifest) stays in the chat; **execution runs detached**, as a standalone process that outlives the terminal and resumes with `run`.

- **Detached engine handoff.** `forge-auto-build`'s engine path (`GO --workflow-engine`) now compiles the manifest, starts the engine with `nohup … >> docs/engine-run.log 2>&1 &`, and polls `docs/WORKFLOW-STATE.json` to completion instead of blocking the session. The build survives the chat and never dies with it.
- **Standalone runner.** New `scripts/forge-engine-run.sh` / `forge-engine-run.ps1` run the engine from outside any CLI (second terminal, CI, or `nohup`): install deps, compile the manifest if missing, then `npm run workflow-engine -- run --harness <h> --yes`. `--dry-run` prints the sequence.
- **GitHub Copilot per-task harness.** New `--harness copilot` adapter invokes `copilot -p "<agent context + task prompt>" --yolo` per task (agent contents inlined -`copilot -p` has no `--system-prompt` flag). Env vars: `COPILOT_BIN`, `COPILOT_EXTRA_FLAGS`. Per-task harness selected with `FORGE_ENGINE_HARNESS` (default `opencode`).
- **Engine dependencies are explicit and never committed.** `bootstrap.sh` / `bootstrap.ps1` ensure the target repo's `.gitignore` excludes `node_modules/` and `docs/engine-run.log`; `forge-auto-build`'s final commit skips `**/node_modules/**`. Docs state the engine needs `node >= 18` + npm at build time.

Related architecture decision:

- [ADR-019](adr/019-authoring-execution-split-and-copilot-harness.md): authoring/execution split, detached engine, Copilot adapter, dependency hygiene.

---

## August 2026 - v3.8

### Automatic PRD quality gates and PRD-prerequisite build execution

Implements CR-001. Two principles: automate deterministic mechanical gates, preserve deliberate human gates.

- **PRD decomposition is automatic.** `forge-build-prd` gains a Step 5 that evaluates the existing criteria (15+ functional requirements or 3+ implementation phases) immediately after the user confirms the PRD. A qualifying PRD automatically invokes `forge-decompose-prd` -no opt-in question. A non-qualifying PRD stays monolithic and the outcome is reported. `forge-decompose-prd` remains independently invokable.
- **`forge-build-prd` absorbs the PRD review checklist.** The review gate from the retired `forge-bootstrap-project` (Scope & intent, Requirements, Technical choices, Plan, Open items) is now part of `forge-build-prd` Step 4.
- **`forge-bootstrap-project` is retired** and its skill directory removed. Its idea-confirmation pattern is reused by the new `forge-auto-build-prd` skill; its PRD review checklist is reused by `forge-build-prd`.
- **New `forge-auto-build-prd` skill.** A meta-skill that confirms an idea, invokes `forge-build-prd` (review + automatic decomposition), verifies the outputs, and stops before team generation - the PRD-creation fast path.
- **`forge-auto-build` requires an existing PRD.** It no longer generates a PRD or interviews for a one-line idea. Its pre-flight check requires `docs/PRD.md` or the decomposed `docs/product-vision.md` + `docs/features/*.md`; if neither exists it stops and directs the user to `forge-auto-build-prd` / `forge-build-prd`. Stages are reduced to team generation → optional model assignment → build execution (`forge-orchestrate-build` or `--workflow-engine`).
- **Launcher handoff updated.** `forge-launcher` (Bash + PowerShell) queues `forge-auto-build` when a PRD was captured in Step 6, or `forge-auto-build-prd` when it was not, so the build pipeline (agent team + build execution, including the workflow-engine path) runs once the PRD exists.
- **`detect-harness.md` relocated** from `forge-bootstrap-project/references/` to `forge-build-agent-team/references/`; all referencing skills updated.

Related architecture decision:

- [ADR-018](adr/018-auto-prd-decomposition-and-build-prerequisite.md): automatic decomposition gate, `forge-bootstrap-project` retirement, and the PRD-prerequisite build pipeline.

---

## August 2026 - v3.7

### Artifact Store and Context Projection in `forge-workflow-engine`

- Added a file-based **artifact store** (`templates/skills/forge-workflow-engine/scripts/artifacts.ts`) that persists every meaningful agent output as a compact, typed JSON artifact under `docs/artifacts/<type-prefix>/<artifact-id>.json`.
- Artifacts are organised into three categories: **decision** (what we are building and why), **work** (what has been done), and **evidence** (how we know it is correct).
- Added **context projection**: before each task is dispatched, the engine resolves the task's declared `inputs`, fetches the relevant artifacts from the store, and builds a minimal markdown `contextBlock` that replaces the full workflow state in the agent prompt — dramatically reducing per-task token consumption.
- Extended `ManifestTask` with two optional fields (`inputs` and `produces`) so workflows can declare the artifact hand-off contract directly in `EXECUTION-MANIFEST.json`.
- Extended the `HarnessAdapter` interface with an optional `contextBlock` parameter; `OpenCodeAdapter` and `OpenAIAdapter` both prepend it when present. Existing adapters that ignore it remain unchanged.
- Added two new audit event actions: `artifact.created` and `context.projected` (with `sourceTokenEstimate`, `projectedTokenEstimate`, and `reductionPercent` fields).
- Added [`docs/artifact-store-deep-dive.md`](artifact-store-deep-dive.md): full walkthrough of the pattern, artifact schema, the three-category taxonomy, projection mechanics, and extension points.

Related architecture decision:

- [ADR-017](adr/017-artifact-store-and-context-projection.md): artifact store design, context projection layer, manifest extension, and adapter interface change.

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
