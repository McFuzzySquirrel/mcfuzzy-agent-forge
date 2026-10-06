# Repository Analysis: mcfuzzy-agent-forge (MyForge)

Scope: full history on `main` (2026-03-13 → 2026-10-02, 203 days), 421 commits in
scope. Author dates throughout. Companion narrative: `docs/THE_STORY_OF_THIS_REPO.md`.

## Overview

MyForge is a PRD-first orchestration system that turns a product idea into an
implemented project. It combines four things in one path: a launcher that collects
the idea and bootstraps a target repository, an authoring chain that turns a PRD
into a specialist agent team and project skills, an execution adapter that compiles
those authored artifacts into a machine-readable manifest, and a workflow engine
that executes the manifest through pluggable agent-harness adapters with retry,
timeout, cancellation, and replay policy. A local web console observes the same
artifacts.

The problem it solves is agent-driven implementation losing traceability: a PRD is
authored and reviewed before code, every requirement has exactly one owning
document, tasks carry explicit contracts and expected outputs, and completion is
evidence-based rather than self-reported.

## Architecture

Four layers, one load-bearing boundary. Per `ARCHITECTURE.md`:

1. **Authoring and intake** — `scripts/forge-launcher`. Collects the idea, selects or
   creates a repository, bootstraps templates into the target harness.
2. **Planning and generation** — skills in `templates/skills/` (`forge-build-prd`,
   `forge-build-feature-prd`, `forge-build-agent-team`, `forge-build-project-skills`)
   produce a PRD, feature documents, an agent team, and skills.
3. **Compilation** — `templates/skills/forge-execution-adapter` compiles the authored
   documents into `docs/EXECUTION-MANIFEST.json`. This is a **compile-time boundary**,
   explicitly not the runtime scheduler.
4. **Execution** — `templates/skills/forge-workflow-engine` reads the manifest,
   schedules dependency-ready tasks, invokes harness adapters, verifies outputs,
   and persists state so runs can pause and resume.
5. **Observation** — `scripts/forge-launcher/scripts/console` serves a local web UI
   over the same artifacts; it does not replace the CLI.

The load-bearing boundary is **compile → execute**. The adapter owns manifest
compilation and validation; the engine owns dispatch, verification, retries,
timeouts, cancellation, replay, and durable state. ADR-038 records a retirement made
specifically to protect this boundary: an earlier `forge-workflow-compiler` /
`flowforge-kernel` integration duplicated runtime responsibilities and made the
documentation present two competing execution paths.

Data is persisted as files in the target repository (`docs/EXECUTION-MANIFEST.json`,
`docs/PROGRESS.md`, `docs/engine-run.log`, engine state, artifacts), not a database.

## Key Components

### `scripts/forge-launcher` — npm package `forge-launcher@1.0.0-beta.6`
The user-facing entry point and the largest component: 140 TypeScript files,
35,362 lines (excluding `node_modules`). Entry points: `scripts/cli.ts`,
`scripts/launcher.ts` (interactive flow, `runLoggedStep` spawn path), `console/cli.ts`.
Responsibilities: repository create/select, template bootstrap, idea and PRD capture,
authoring-stage handoff to a harness terminal, engine run/resume, update check, and
version consistency. Test coverage is the largest in the repository (272 tests).
`scripts/stage-resources.mjs` copies `templates/` and `docs/prompt-playbook.md` into
`resources/` at `prepack` so the published package bootstraps standalone;
`resources/` is gitignored and is a build artifact, not a second source of truth.

### `templates/skills/forge-workflow-engine` — `forge-workflow-engine@1.0.0`
The execution core. 45 TypeScript files, 10,794 lines. Key modules:
`engine.ts` (task execution, single-writer serialized queue, concurrency),
`state.ts` (durable run state), `cli.ts` (harness selection), `task-graph.ts`
(dependency resolution), `verify.ts` (output verification), `sandbox.ts`
(per-task git worktrees under `.forge-sandboxes/`), `artifacts.ts`, `control.ts`
(pause/stop/resume/replay), `commit.ts`, `task-execution.ts`, and `viz/` (live
visualization server with SSE).

Harness adapters live in `scripts/harness/`: `opencode-adapter.ts`, `copilot-adapter.ts`,
`claude-adapter.ts`, `openai-adapter.ts`, `stub-adapter.ts`, plus `run.ts` and
`invocation-log.ts`. `flowforge-kernel` is retired and rejected at runtime.

### `templates/skills/forge-execution-adapter` — `forge-execution-adapter@1.0.0`
The manifest compiler. 14 TypeScript files, 3,025 lines. Key modules: `compiler.ts`,
`adapter.ts`, `discovery.ts`, `prd-validation.ts`, `task-contract.ts` (compacts task
contracts into complete execution instructions), `requirement-sources.ts`,
`document-integrity.ts`, `progress.ts`. Emits `docs/EXECUTION-MANIFEST.json` with
phase/task structure and a `reconciliation` block for incremental builds.

### Forge Console
Local web UI over launcher and engine artifacts, served from
`scripts/forge-launcher/scripts/console`. `server.ts` `scripts/forge-launcher/scripts/console/server.ts` plus a vanilla-TS dashboard under
`dashboard/` (11 views: home, overview, board, tasks, timeline, artifacts,
documents, logs, help, new, projects). Reads state via `repo.ts`, exposes JSON APIs
consumed by `dashboard/api.ts`, and provides `control.ts` for pause/stop/resume and
task selection.

### `templates/skills` — 16 skill templates
Authoring and generation: `forge-build-prd`, `forge-build-feature-prd`,
`forge-decompose-prd`, `forge-build-agent-team`, `forge-build-project-skills`,
`forge-assign-models`, `forge-auto-build`, `forge-auto-build-prd`,
`forge-orchestrate-build`, `forge-grill-idea`, `forge-optimize-skills`,
`skill-creator`, `skill-review`, plus the two executable packages above. Each is a
small package with `SKILL.md`, `references/`, optional `scripts/`.

### `templates/agents` — 3 agent personas
`project-orchestrator.md`, `forge-team-builder.md`, `workflow-orchestrator.md`.

### `tools/console-screenshots` — dev-only
5 files, 1,061 lines. Regenerates Forge Console screenshots and the visual tour;
requires `google-chrome` and `ffmpeg`. Not part of the distributed package.

## Technologies Used

- **TypeScript 5.7** throughout; run via `tsx` (no bundler for the CLI packages).
- **Node.js**: README requires 18+; CI pins **Node 22**.
- **Test runner**: built-in `node:test` (`node --import tsx --test`). The launcher
  forces `--test-concurrency=1`; the engine uses a custom `scripts/test-runner.mjs`.
- **Build**: `tsc` plus a second `tsconfig.client.json` pass for dashboard assets.
- **Runtime deps**: `cross-spawn`, `gray-matter`, `@clack/prompts`, `semver`,
  `read-cmd-shim`, `which`, `globby`, `commander`, `azure-devops-node-api`.
- **Dashboard**: vanilla TypeScript + `style.css` + `index.html`; Markdown rendered
  in-process via `dashboard/render/md.ts`. No frontend framework.
- **Wrappers**: Bash (`scripts/*.sh`) and PowerShell (`scripts/*.ps1`) delegates for
  Windows compatibility, including PowerShell 5.1 constraints.
- **Docs**: 155 Markdown files, 62 ADRs (001–061; number 28 used twice from an
  earlier collision).

## Data Flow

1. User runs the launcher; it creates or selects a repository and bootstraps
   `templates/` into the target harness's agent directory.
2. Idea and PRD context are captured or generated, in three authoring stages —
   `prd`, `team`, `skills` — each independently modellable and separately reviewable.
3. The execution adapter reads the PRD, feature documents, agent team, and skill
   definitions, validates ownership and coverage, and compiles
   `docs/EXECUTION-MANIFEST.json`.
4. The workflow engine loads the manifest, resolves dependency-ready tasks, and for
   each task: creates a sandbox worktree (when concurrency > 1), invokes a harness
   adapter, verifies declared outputs, integrates the sandbox, persists task state,
   and optionally commits.
5. The engine writes state, `docs/PROGRESS.md`, artifacts, and `docs/engine-run.log`.
6. The console reads those same files and serves the UI; control actions POST back
   to the engine.

Failures are surfaced rather than hidden: `printEngineStatus` explicitly lists tasks
marked complete that produced no output files ("verify these actually delivered"),
plus failed tasks and blockers.

## Team and Ownership

Recorded history (non-merge commits, author dates, territory by path):

| Author identity | Commits | Tenure | Main territory |
|---|---:|---|---|
| `copilot-swe-agent[bot]` (agent account) | 117 | 2026-03-16 → 2026-10-02 | docs 62, templates 53, scripts 35 |
| `GitHub Copilot` (agent account) | 87 | 2026-03-13 → 2026-08-31 | docs 70, scripts 50, templates 43 |
| `McFuzzySquirrel` (maintainer) | 64 | 2026-03-13 → 2026-10-02 | docs 44, scripts 38, templates 35, tools 2 |
| `Sylvester Kuisis` | 44 | 2026-09-07 → 2026-09-08 | docs 27, scripts 17, templates 7 |
| `Nabeel Prior` | 11 | 2026-09-04 → 2026-09-28 | docs 10, templates 8, scripts 6 |
| `nabeelp` | 3 | 2026-08-30 (single day) | — |

Two identities are automation accounts and account for 204 of 326 non-merge
commits (62.6%). `Nabeel Prior` and `nabeelp` appear to be the same author under two
account spellings (11 commits across 2026-09-04→09-28 versus 3 on 2026-08-30); the
log does not prove this, so treat them as two identities. 95 of 421 commits are
merges (~48%), with pull requests referenced up to `#122`.

Ownership by area: the launcher and its documentation are touched most often
(`README.md` 124 touches, `docs/updates.md` 116, `docs/forge-launcher.md` 70,
`scripts/forge-launcher/scripts/launcher.ts` 54). The maintainer is the only author
active in both `tools/` and across the full span.

## Verification

**What is verified automatically.** `.github/workflows/validation.yml` runs on pull
requests and pushes to `main`, and on manual dispatch. It builds a matrix of
`ubuntu-latest` × `windows-latest` against four packages — `scripts/forge-launcher`,
`forge-execution-adapter`, `forge-workflow-engine`, `skill-review` — running
`npm ci`, `npm run typecheck`, and `npm test` for each, plus a launcher build and
`check:version`, and the agent-team gate tests
(`validate-team.test.mjs`, `validate-frontmatter.test.mjs`) under the `skill-review`
entry. Permissions are `contents: read`.

Verified locally during this analysis (all four packages, Node 22-class runtime):

| Package | Tests | Pass | Fail | Skipped |
|---|---:|---:|---:|---:|
| `forge-launcher` | 272 | 272 | 0 | 0 |
| `forge-workflow-engine` | 249 | 242 | 0 | 7 |
| `forge-execution-adapter` | 49 | 49 | 0 | 0 |
| `skill-review` | 7 | 7 | 0 | 0 |
| **Total** | **577** | **570** | **0** | **7** |

`npm run typecheck` on `forge-launcher` (both `tsc` passes) is clean.

**What is not verified.**
- Only 4 of the 16 skill templates are in the CI matrix. The remaining 12 —
  including `forge-build-prd`, `forge-orchestrate-build`, and
  `forge-auto-build-prd` — are prose and frontmatter with no automated gate beyond
  the two agent-team validators.
- `scripts/harness/openai-adapter.ts` and `scripts/harness/stub-adapter.ts` have no
  dedicated `.test.ts`; they are exercised only indirectly through `request.test.ts`
  and `engine.test.ts`. The three adapters with dedicated tests are `opencode`,
  `copilot`, and `claude`.
- 7 engine tests are skipped; the suite reports them without failing.
- Behavioral contracts are pinned in tests as documentation substitutes in places —
  for example `retired-harness.test.ts` asserts a retired harness fails *before*
  repository preparation and that a persisted retired harness is rejected rather than
  silently replaced.
- Documentation consistency is not machine-checked. `ARCHITECTURE.md` currently
  contains a duplicated `### Workflow engine` section (lines 27 and 50) with
  overlapping content.
- Release history exists only as Markdown: `docs/updates.md` holds 93 version
  sections from v2 (June 2026) to v3.91 (October 2026), but the repository has
  **0 Git tags**, so nothing ties a commit to a published release.
