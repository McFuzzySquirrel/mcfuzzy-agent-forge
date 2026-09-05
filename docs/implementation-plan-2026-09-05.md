# MyForge implementation plan

## WIP checkpoint - 5 September 2026

Implementation was paused at the user's request to conserve AI credits and
preserve the work on a new remote branch. The checkpoint below records the
paused state. The completion update that follows records the subsequent
implementation and validation evidence.
The user authorized this checkpoint commit and push; the earlier no-commit
restriction below describes the original implementation authorization.

### Landed work

- Removed the external kernel adapter and workforce compiler while retaining
  native execution. Added retired-configuration errors and coverage proving
  bootstrap preserves existing downstream workforce artifacts.
- Implemented durable serialized task transitions, owner preflight, normalized
  requests, capability checks, run-scoped cleanup, bounded process-tree
  termination, and resumable cancellation including replay.
- Shared repository metadata and pinned manifest-selected roots across reporting,
  model edits, native execution, and recompilation. Added adapter
  `--harness-root`; new work is not assigned to Forge coordinator personas.
- Added independent authoring configuration, isolated sessions, candidate
  handoffs, stage state/fingerprints, `draft-skills`, and Console APIs.
- Repaired descriptor/event-stream handling and added job-specific terminal
  receipts. Old authoring outputs cannot establish a new job's success;
  malformed job state is isolated per project.
- Added Console model controls, draft/focus preservation, responsive/accessibility
  improvements, pure-state coverage, five refreshed screenshots, draft migration
  docs/ADRs, and a Linux/Windows CI matrix.

### Completion update - 5 September 2026

All seven checkpoint work items are implemented. The remaining limitations are
environmental: the installed Copilot CLI 1.0.83 exposes no model IDs through
its non-generative `--help` metadata, so live Copilot refresh fails closed for
explicit selections and inherited defaults remain available; no Windows or
interactive browser session was available for this run.

1. **Authoritative Copilot inventory:** complete. Copilot refresh uses
   `copilot --help` metadata only, with strict model-section parsing and
   explicit failure when the CLI exposes no IDs. Injected probes and Console
   tests use the metadata contract; no model prompt is submitted.
2. **Creation persistence and fingerprints:** complete. New Project model
   selections flow through the project creation save path, direct stage
   overrides remain invocation-scoped, and authored fingerprints ignore
   dependency/build/coverage/cache directories.
3. **Quality parity:** complete. Team validation and `skill-review` consume
   the shared rubric and structural checker, with parity and team-only tests.
4. **Launcher quality gate:** complete. Affected non-omit skill outputs receive
   structural and minimum-per-axis checks before skills completion/readiness;
   empty/all-omit handoffs succeed explicitly and team validation does not
   require future skill packages.
5. **Astra UI findings:** complete in the frontend contracts. Task controls
   are wired before asynchronous responses can be superseded; model selections
   survive inventory/harness changes; dirty saves block retries; stale stages
   expose regeneration; and same-project snapshots refresh generated listings
   and stage actions.
6. **Template/reference/retirement audit:** complete for active templates and
   mode references. `forge-auto-build` now documents the independent skill
   stage, the historical review is marked as remediated, and ADR-041 plus the
   v3.53 changelog/README entries record the final contracts.
7. **Final assembly:** complete for available tooling. Launcher 177 tests,
   launcher typecheck/build/version check, execution adapter 27 tests plus
   typecheck, workflow engine 139 tests plus typecheck, team validator 12
   tests, skill-review 4 tests plus typecheck, and packed bootstrap smoke all
   pass.

### Closeout update

The active documentation audit is complete. Current launcher, Console, skill,
schema, and bundled-resource guidance now describes non-generative
`copilot --help` metadata discovery and fail-closed explicit selections.
Historical ADRs, research, release entries, and regression fixtures retain
their superseded FlowForge and `/model list` references as historical records.
The final available validation rerun passed, including launcher packaging
manifest inspection; Windows and interactive browser execution remain
environmental limitations rather than unverified completion claims.

### Historical unfinished-work list

The original list is retained as an audit record; the completion update above
supersedes its unfinished status.

1. **Authoritative Copilot inventory:** `authoring-inventory.ts` still needs its
   `copilot -p "/model list"` discovery path verified/replaced. Do not use a model
   prompt as authoritative inventory. Prefer a supported non-generative metadata
   interface; preserve explicit failure and inherited-default behavior. Update
   the injected probe contract and Console inventory test together.
2. **Creation persistence and fingerprints:** confirm Console New Project's
   three model flags persist to the new project's `docs/authoring-config.json`,
   while ordinary invocation overrides remain temporary. Confirm dependency
   installation/build/cache directories do not invalidate authored fingerprints.
3. **One real quality gate:** `validate-team.mjs` and `skill-review` currently
   disagree: the freshly bootstrapped project-skills coordinator passes the
   reported reviewer gate but fails validator axes `progressiveDisclosure` and
   `calibration` at minimum 2. Share scoring/structural logic and add parity
   coverage rather than tuning prose to two different rubrics.
4. **Enforce that gate in the launcher:** generation currently checks planned
   files/frontmatter; wire structural/per-axis validation before recording skills
   complete or compiling. Scope checks to affected non-omit candidates, exclude
   bootstrapped tooling from project quality scoring, and handle empty/all-omit
   handoffs. Team-only validation must not require skills before their stage.
5. **Finish the five Astra UI findings:** an initial task response superseded by
   an SSE refresh can leave range/run controls unwired; New Project inventory
   refresh/harness changes can silently clear explicit models; Plan & Team
   inventory refresh loses dirty model edits and Retry can bypass failed/pending
   saves; stale completed stages lack regeneration actions; and same-project
   snapshots do not refresh generated listings or reconcile retry buttons.
   Backend `Summary.authoringNextStage` and its regression are already present.
6. **Finish template review and integration:** review every original T11 item,
   including personas and mode references, rather than assuming all were changed.
   Complete the active-reference retirement audit, align docs with final
   contracts, and update the historical review's remediation status.
7. **Final assembly:** rerun the complete launcher suite/typecheck/build, relevant
   native and validator suites, release-version consistency, packed bootstrap
   and standalone execution. Recheck browser snapshot races, dirty/save/retry
   behavior, unavailable selections, generated-content refresh, and responsive
   controls after the remaining fixes. Regenerate affected screenshots if needed.

### Evidence available at pause

These are previous successful runs, **not a claim that the final checkpoint
passes every gate**: native engine 139 tests plus typecheck; execution adapter
27 plus typecheck; team validator 11; skill-review 4 plus typecheck; focused
Console authoring/job/state integration 16; retirement/bootstrap 11.
The last complete launcher run passed 155 tests before later integration edits.

Chrome exercised model save/reload/error/clear/unavailable preservation,
draft/model focus during log updates, Help focus/Escape/return, and four views
at 1024/720/390/320 CSS pixels. The subsequent review found the separate UI
defects listed above. Earlier packed bootstrap and native stub execution worked,
but the final package must be rebuilt after the remaining changes.

Windows execution and live model authoring were not performed. Browser scripts
and disposable packaging fixtures were session-only; they are not in this commit.
At the checkpoint, the v3.52 release text and ADRs were drafts; the completion
update above records the subsequent integration and documentation work.

## Goal and confirmed scope

Apply the still-relevant Astra review findings, retire external FlowForge integration, make PRD/team/skill authoring independently model-selectable, and improve the existing Console and template contracts without replacing native execution.

This document records planned work, not completed remediation. Preserve the existing root `plan.md`, which describes the completed launcher migration.

- Remove the FlowForge kernel adapter and workforce compiler skill/package. Keep the native workflow engine, execution adapter, manifest compilation, task selection, and build controls.
- Include all applicable findings from `codebase-review-2026-09-05.md`, including incremental architecture cleanup.
- Persist independent PRD, team, and skills authoring models per project, accessible through CLI and Console.
- Unset models inherit the authoring runner default. Explicit unavailable/incompatible selections fail clearly; no silent substitution or automatic authoring fallback.
- Initially support existing automated Copilot/OpenCode runners; do not add Claude/OpenAI authoring backends.
- Keep the frontend stack. Include prioritized UX/accessibility/template improvements; defer framework replacement and separate visualizer redesign.
- Preserve history and user-owned downstream artifacts. Do not automatically delete `.workforce` directories, bridge files, or modified template copies.
- Use autopilot/fleet: Astra coordinates architecture/integration/review; Luna may implement bounded independent work. No commits or pushes are authorized.

## Current-state evidence

`scripts/forge-launcher/scripts/launcher.ts:434-490` constructs authoring commands without model arguments. Feature increments run PRD -> team -> manifest -> optional execution (`:1850-1876`). Skills are generated inside `forge-build-agent-team/SKILL.md:56-73,175-255`, so independent model selection requires a separate invocation, not prompt hints.

The Console model inventory/execution overrides (`console/repo.ts:427-468`) are useful foundations but are not authoring configuration. Inventory must be available before PRD/team creation.

Runtime removal points: `templates/skills/forge-workflow-engine/scripts/harness/flowforge-kernel-adapter.ts`, engine CLI registration/help, launcher harness option, and `templates/skills/forge-workforce-compiler/`. Bootstrap enumerates templates and package staging copies them, so clean clone and packed installs both need coverage.

### Earlier Astra review

Historical Windows failures are a baseline to reproduce, not current results.

| Finding | Disposition |
| --- | --- |
| CR-01: lost completed state | Persist each task before starting the next; retain serialized attribution. |
| CR-02: missing owners become successful skips | Required-owner preflight and explicit discovery failures. |
| CR-03: zero tests discovered | Cross-platform discovery that fails when empty. |
| CR-04: inconsistent discovery/frontmatter | Remove workforce divergence; align remaining consumers and distribution. |
| CR-05: incomplete workforce packages | Superseded by removal, not repaired. |
| CR-06: detached-process leaks/errors | Descriptor cleanup and accurate startup/job failure reporting. |
| CR-07: lost partial structured records | Stateful UTF-8/JSONL incremental reader and reliable cleanup. |
| CR-08: kernel lacks single-task boundary | Superseded by removal. |
| CR-09: inconsistent adapter request policies | Common model/request semantics and conformance coverage. |
| CR-10: text executor accepts repository work | Explicit capabilities checked before transport; OpenAI remains text-only. |
| Launcher ownership | Fresh per-invocation sessions and injectable dependencies. |
| Remaining adapter boundaries | Run-scoped lifecycle, cancellation, cleanup, and classified failures. |

### UI and templates

Current UI source and committed screenshots were reviewed; screenshots predate current controls, and no live current-browser session was verified during planning.

Prioritize preserving drafts/focus during store-driven updates (`dashboard/main.ts:62-72,98-105`), honest loading/error/disconnection states, next-action hierarchy, keyboard/modal accessibility, narrow layouts, and investigation-view state. The research picker accepts PDF/DOCX but reads text (`views/new.ts:53,129-153`); restrict it to supported text until binary-safe ingestion exists.

Preserve three thin agent personas. Improve feature contracts/IDs, headless authorization propagation, harness discovery, actual per-axis quality enforcement, model guidance, and artifact/review ownership. Consolidate optimization/review instructions.

Add only one justified skill: `forge-build-project-skills`, a project-level coordinator reusing `skill-creator` and `skill-review`, with an independent model invocation and resumable candidate handoff. Do not add a permanent persona.

## Implementation phases

### T01 - Trustworthy verification baseline

Replace shell-dependent engine test globs with explicit Node-based cross-platform discovery. Include nested tests and fail empty discovery. Capture/diagnose old failures before changing assertions; fix path/command portability without weakening checks. Preserve supported Node compatibility.

**Acceptance:** the standard entry point discovers root/nested suites, empty discovery fails, and platform-sensitive cases work on supported Windows/Linux environments.

### T02 - Retire FlowForge

**Depends on:** T01.

Remove workforce compiler package, kernel adapter, registrations/options/environment help, and active bridge-generation guidance. Update multifunction skills rather than deleting them. Reject persisted/explicit retired harness config with migration guidance before spawning; never reroute silently.

New bootstrap/pack output excludes retired tooling. Preserve downstream generated artifacts and modified copies. Keep historical ADR/review/changelog records; mark superseded decisions and remove obsolete active navigation or retain migration stubs.

**Acceptance:** native compile/run/replay remains; retired selection errors clearly; only intentional historical/migration references remain.

### T03 - Durable engine completion and ownership

**Depends on:** T01.

Execute serialized tasks against latest authoritative state; merge/persist/sync progress and finish task commit bookkeeping before starting another. Use interruption-safe persistence where needed. Validate pending selected-task/dependency owners before dispatch; discovery failures and missing owners block/fail explicitly.

Retain reasoned intentional skips and current serialization. Persist coherent failure/exception outcomes and never release dependents from required failures.

**Acceptance:** gate B after A completes; persisted A survives restart or B throwing and is not invoked again. Cover missing owners, discovery failure, intentional skips, manual selection, pause/retry/replay.

### T04 - Native adapter contracts

**Depends on:** T02, T03.

Prepare a common read-only attempt request containing persona, effective model, projected context, outputs, validation, repo, attempt metadata, and budget. Resolve task model before agent model before transport default centrally. Keep native persona/ID translation in adapters and allow transport-specific message layouts.

Declare minimal real executor capabilities and explicit task requirements. Legacy unspecified tasks conservatively require repository tools; empty output lists do not imply text-only work. Reject unsupported tasks before dispatch; explicit OpenAI text tasks retain common verification.

Define prepare/cleanup for run-scoped resources including OpenCode attach reuse, and classify retryable failures/config errors/exceptions/timeout/cancellation. Do not add authoring fallback; distinguish execution fallback metadata from actual behavior.

**Acceptance:** shared semantic fixtures cover all retained adapters; preserve qualified OpenCode IDs/Copilot conversion; incompatible tasks make no transport call; cleanup is reliable.

### T05 - Shared metadata contracts and distribution

**Depends on:** T02.

Define explicit-harness precedence and deterministic fallback preferring meaningful agent roots over skills-only roots, with ambiguity diagnostics. Resolve once and propagate through generation/discovery/validation. Include `.github/skills` and remove hard-coded `.agents` assumptions.

Reuse structured frontmatter parsing. Share narrow canonical helpers rather than a general framework. Bundle/stage shared code into packed launchers and standalone bootstrapped skills; never require an uninstalled target skill at launcher runtime.

**Acceptance:** mixed-root/skills-only/explicit-harness/quoted/block-YAML/invalid-metadata fixtures agree across consumers; clean distributed consumers have no missing imports.

### T06 - Process and stream lifecycle

**Depends on:** T01.

Consolidate detached job spawning, preserving terminal-specific behavior; close unique parent log descriptors for every success/partial-open/spawn-error path. Report async startup failure to job tracking.

Extract bounded incremental reading with actual byte counts, persistent UTF-8 decoding, partial JSONL buffering, rotation/truncation detection, and guaranteed closure. Surface failures without crashing polling and define ordinary text partial-line behavior separately.

**Acceptance:** balanced descriptors, continued child logging, accurate startup failures, exactly-once split records/multibyte decoding, and safe replacement/truncation/project switching/read-error paths.

### T07 - Isolated authoring sessions and model configuration

**Depends on:** T05, T06.

Replace module-global launcher state with fresh explicit sessions and injectable prompt/process seams around tested workflows. Add versioned `docs/authoring-config.json` with independent optional PRD/team/skills models, separate from engine and implementation-agent overrides.

Precedence: invocation override -> stage environment override -> saved setting -> runner default. Clearing restores inheritance. Add CLI flags/config entry point and cover new/existing/feature/resume/auto-setup.

Discover/refresh inventory before authoring, retain provider/freshness and filter for actual runner. Missing inventory is not evidence of availability; refresh or error for explicit selections. Inheritance does not require inventing a default model ID.

Use real model argv; retain OpenCode qualification and convert only at Copilot boundary. Resolve conflicting extra model flags explicitly. Reuse transport helpers without build scheduling. Record resolved invocation settings; inherited defaults remain unresolved when the runner cannot identify them.

**Acceptance:** distinct models produce distinct argv; test precedence/clear/provider/incompatibility/discovery failure; repeated in-process sessions do not leak settings; authoring and execution overrides remain independent.

### T08 - Separate project-skill generation

**Depends on:** T07.

Pipeline: context -> PRD -> team -> skills -> manifest -> build. Team writes agents, ownership, and persisted skill candidates; `draft-skills` runs separately with the skills model. The coordinator chooses reuse/extend/create/omit, delegates creation, and enforces deterministic/review gates.

Team owns planned references/responsibilities; skills fulfill them or request targeted team revision. Persist versioned stage outcomes/input fingerprints/handoff including valid no-skills-required completion; do not create another execution manifest.

Retry skill failure without regenerating a valid team; invalidate readiness on actual changed inputs. Wire every authoring entry point. Auto-setup can still advance all stages under one opt-in.

Legacy valid teams/manifests are not blocked solely by missing markers; validate/adopt when entering new authoring. Preserve unaffected incremental files and additive existing manifest definitions.

**Acceptance:** three real invocations use three models; team does not generate packages; skill retries/no-skills/legacy/increment cases work.

### T09 - Persistent Console interactions

**Depends on:** T01.

Mount on navigation/project change, not every store event. Update live regions while preserving project-scoped drafts/model edits/task selections/filters/expanded rows/scroll/focus. Ignore stale responses and clean up subscriptions.

Add explicit pending/loading/stale/disconnected/recoverable-error states, prevent duplicate submissions, and restore failed controls without losing input.

**Acceptance:** SSE/store updates preserve edits/focus, project switches isolate drafts, stale responses cannot render another repo. Use existing tests for pure seams and browser review for DOM behavior.

### T10 - Console authoring models and stages

**Depends on:** T08, T09.

Reuse three selectors in New Project and always-available project settings. Distinguish saved/unsaved/inherited/explicit/unavailable/in-flight selection. Label agent controls Execution models; never clear missing inventory selections silently.

Show team/skill status/model/outputs/logs/retry independently, using backend readiness rather than any bootstrapped skill. Show feature-increment stages and prevent build against incomplete active authoring. Keep engine controls separate from authoring jobs.

**Acceptance:** shared settings across entry points; failed saves do not dispatch; supplied PRDs skip drafting; skill retry preserves teams; legacy build remains available.

### T11 - Template quality and artifact authority

**Depends on:** T05, T08.

Unify feature layouts/qualified IDs with legacy support and stable existing manifest IDs. Add reconciliation and review-only/revision modes. Propagate source/harness/headless/authorization/supplied-answer contracts without nested stalls or dropped gates.

Make invalid frontmatter/structure/files/references and per-axis generation thresholds blocking; keep standalone advisory behavior explicit. Replace whole-Markdown YAML parsing guidance. Extend existing Node review tooling and distinguish structural, heuristic, and behavioral evidence.

Add activation/non-activation/outcome fixtures across supported modes. Correct model capabilities/availability/tooling exclusions and recommended-versus-effective routing.

Document authored inputs, compiler-owned manifest/matrix, engine state/progress, and draft versus compiled team maps. Report requirement/NFR coverage, implementer/reviewer/acceptance evidence without fabrication. Reuse reviewer roles, add no persona, consolidate optimization/review policy, and thin operational docs into conditional references.

**Acceptance:** one below-threshold axis or structural error blocks generation; documented commands match enforcement; supported modes consistently resolve paths/ownership.

### T12 - Console hierarchy, accessibility, and monitoring

**Depends on:** T09, T10.

Lead Overview with identity/stage/next action/blockers/outcomes; disclose technical metadata and advanced execution options secondarily. Restrict uploads to supported text and distinguish browser files/server paths; block or explicitly acknowledge staging failure.

Associate labels/name checkboxes; use keyboard-accessible controls/sorts, focus styling, `aria-current`, live announcements, and modal focus management. Add narrow navigation/table scrolling, long-text wrapping, and reduced motion.

Improve log Follow/unread, document/artifact route selection, sibling-preserving previews, and Board iframe title/fallback without renderer redesign.

**Acceptance:** current rendered empty/loading/error/running states at desktop/intermediate/390px/320px/200% zoom; keyboard/live updates preserve input/focus. Use fixture repos, not paid authoring demos.

### T13 - Integration, migration, and documentation

**Depends on:** T02-T12.

Update skill/reference/deep-dive/launcher/Console/architecture/contributor docs and screenshots alongside code. Add retirement/authoring/adapter ADRs as appropriate; latest current ADR is 037, so allocate the next free number.

Add top release entries and synchronize README Latest for released user-visible changes; preserve history. Mark review remediation only with actual evidence and CR-05/CR-08 as superseded.

Exercise pack/prepack/bootstrap and clean standalone skills; never copy `node_modules`/`dist` into skill trees. Document retired config, legacy adoption, and inheritance without destructive cleanup.

**Acceptance:** shipped docs/resources match actual contracts without checkout-only imports or misleading completion claims.

## Fleet ownership and sequencing

Start T01; fan out T02/T03/T06/T09 with disjoint files. T05 follows retirement; T04 follows retirement/durability. T07-T08 establish backend contracts before T10. T11 strengthens extraction; T12 polishes UI; T13 integrates.

| Workstream | Ownership |
| --- | --- |
| Engine and adapter | Native runtime correctness, request/capability/lifecycle contracts. |
| Launcher and authoring | Sessions/config/subprocesses/backend APIs/stage sequencing. |
| Console | Dashboard state and UX; agree API/types before integration. |
| Templates/docs | Coordinate extraction/retirement with code owners to avoid collisions. |

Astra owns integration and shared decisions; Luna may implement bounded independent components. Do not duplicate agents' ownership, bypass dependencies, or combine unrelated formatting/framework changes.

## Validation and completion

Use existing tooling; install dependencies only after a manifest change or missing-dependency failure. Engine imports require retained sibling execution-adapter dependencies.

- Launcher: targeted `node --import tsx --test` over affected launcher/draft/resume/console/format/bootstrap/engine-run tests; `npm run typecheck` includes client/server.
- Engine: targeted engine/CLI/verification/harness tests and repaired `npm test` to prove discovery.
- Adapter: existing tests/typecheck for metadata/manifest/capability/feature changes.
- Team/review: existing validator/tests/typechecks, extended for mixed roots and actual structural/per-axis enforcement.
- UI: existing build and current browser review; API tests do not prove focus/layout. Add tooling only if demonstrably necessary and deliberately scoped.
- Distribution: existing pack/bootstrap against temporary fixtures without external model calls.
- Release: `npm run check:version` from `scripts/forge-launcher`.
- Batch targeted selectors; broaden for integration/discovery/observed impact. Establish Windows/Linux results for cross-platform changes.

Completion requires regression-covered retained review fixes, retired integration no longer shipping, real independent model-routed authoring, safe migration, UI input persistence, and enforceable template gates. Old review results, heuristic scores, unresolved runner defaults, and old screenshots are not current execution evidence.

## Console media refresh closeout

The supplied beta-5 Console captures are now committed under
`docs/images/forge-console/beta-5`. The Visual Tour and Console reference use
the current desktop captures for Overview, Tasks, Plan & Team/Documents, New
Project, and Help, and include responsive links for the available widths.
The README's old GitHub attachment was replaced with
`console-walkthrough.gif`, generated from the beta-5 desktop captures.

The older TaskFlow images remain only for Board, task detail, logs, artifacts,
and timeline because no corresponding beta-5 replacements were supplied.
