# Forge Board + Re-derivation Plan

Status: Proposed — not started. Working plan for three related changes to the
Forge Console: a one-click re-derivation chain for the agent team and project
skills, a live dependency Gantt mode on the Forge Board, and general Forge Board
polish (toolbar, distinct states, accessibility, cross-view navigation).

Decisions land as ADR-062 (re-derivation chain), ADR-063 (board chrome, modes
and accessibility, amending ADR-026) and ADR-064 (Gantt mode). ADR-061 is
currently the highest number.

## Problem

### 1. Re-deriving a team after a requirements change is a five-hop scavenger hunt

After a PRD or feature document changes, the agent team and project skills are
both stale and must be regenerated. Today that requires:

1. Overview → Controls → **Reset changed tasks for review** (`reset-changed` →
   `resetChangedCompletedTasks`, `console/repo.ts:148`).
2. Overview → Manifest panel prints `reconciliation.changedTaskIds` as one
   unreadable mono string (`views/overview.ts:336`).
3. Plan & Team → Team card → **Regenerate TEAM**. The button is `hidden` unless
   the stage failed *or* `summary.authoringNextStage === "team"`
   (`views/documents.ts:133-139`, `305-312`).
4. Wait for the team job to finish; the Skills card's button then appears under
   the same conditional. Nothing tells the user this is now possible.
5. Compile the manifest again, then reset changed tasks again.

Three views, five ordered steps, and the affordances are invisible at exactly
the moment they are needed.

The cause is that the Console projects a boolean. `authoring-state.ts` already
records `inputFingerprint`, `outputFingerprint` and `completedAt` per stage
(`authoring-state.ts:61-71`) and `authoringStageIsCurrent()` compares them
(`:164-169`), but `authoringReadiness()` collapses the result into
`{ ready, reason, nextStage }` (`:171-190`). The Console then shows
`authoringReady: false` plus one free-text `authoringBlocker` — never *which*
input changed, *when*, or a single action that runs the chain.

The launcher CLI already chains team → skills → manifest
(`launcher.ts:1249-1253`); the Console has no route into that path.

### 2. The Forge Board has no modes, no toolbar, one error message, and no way out

`templates/skills/forge-workflow-engine/scripts/viz/dashboard/app.js` (1195
lines, PixiJS v8, vendored) is served by the Console at `/board` and embedded as
a bare iframe by `views/board.ts` (19 lines). Gaps:

- **No modes, no toolbar.** Only drag-pan and wheel-zoom exist. `fitCamera()`
  runs on load and resize only (`app.js:844`), so re-fitting and zooming are
  undiscoverable and there is nowhere to put a mode switch.
- **One message for every empty and error state.** A failed `fetchSnapshot()`
  sets `"waiting for the engine server…"` (`app.js:1142-1153`), which is
  indistinguishable from "the server is down" when the real cause is "this
  project has no execution manifest yet".
- **The iframe is a dead end.** Clicking a card expands it in place
  (`app.js:474-477`). There is no "Open in Tasks"; the only escape is fallback
  text telling the user to leave for the Tasks view.
- **Canvas-only.** No keyboard navigation, no DOM text, no accessible
  representation of the board.
- **Failures only flash.** A failed task triggers a red tint animation
  (`app.js:960-967`); there is no persistent failed list and Replay lives in
  another view.
- **Density.** A 60-task board is taller than any viewport, with no phase
  collapse, filter, or minimap.

### 3. There is no time-on-dependencies view

The Board answers *what is running and what is next*. It cannot answer *how far
along is this phase*, *when will the build finish*, or *which tasks are on the
critical path*. Timeline shows audit events, not schedule.

## Goals

- One click re-derives team → project skills → manifest, with a live per-step
  progress machine and an explicit reason for every stale stage.
- A live, dependency-based Gantt mode on the Forge Board, sharing the Board's
  SSE stream, camera, HUD and legend.
- A Board that is navigable, discoverable, honest about its state, and usable
  without a mouse.

## Non-goals

- **No automatic re-derivation.** Regenerating a team is destructive to
  hand-edits; it stays a deliberate click.
- **No automatic reset of completed tasks.** `resetChangedCompletedTasks`
  discards finished work and must remain an explicit, confirmed action.
- **No requirements authoring in the chain.** ADR-060 makes requirement stages
  interactive; the chain starts at `team` and refuses to run without a committed
  PRD.
- **No manifest schema change for the Gantt.** All required data already exists.
- Timeline (audit events) stays a separate view; it answers a different question.

## Decisions

### D1 - The chain is one background job with an explicit step machine

New job type `rederive`, launched exactly like the existing authoring jobs
(`console/control.ts:207-212`). Progress is persisted to
`docs/rederive-state.json`, so a client that reconnects mid-run resumes the step
machine instead of showing an undifferentiated spinner.

Rejected: a client-side sequential loop over three `api.control()` calls. It
loses all progress on reload, cannot express per-step failure, and races with the
"a job is already running" guard the moment the user clicks twice.

### D2 - The chain stops at `manifest` and never resets tasks

`resetChangedCompletedTasks` flips complete/skipped tasks back to pending and
clears their outputs and artifacts. Automating that as the tail of a background
job would destroy finished work without a deliberate confirmation. The chain
therefore ends at manifest compilation and then *offers* the reset.

Rejected: including the reset with a `--force` flag. A flag doesn't create
consent at the moment of the click.

### D3 - Staleness is explained by deriving it, not by storing it

`explainStaleness(repo, stage, harnessRoot)` compares the stored fingerprints
against fresh ones, then names the offending files by comparing each stage
input's `mtimeMs` against the stage's `completedAt`. The fingerprint scheme is
unchanged, so nothing existing has to migrate, and the reason text cannot drift
from the fingerprints that drive the actual staleness decision.

Rejected: recording a human-readable reason at authoring time. It would be
absent for every stage authored before this change, and would go stale itself.

### D4 - The Gantt layout is computed server-side by one shared TS module

The Console's `/api/layout` currently returns `null`
(`console/server.ts:454-455`), so the console-served board always re-derives
geometry in JavaScript (`app.js:304-355`) while the tested `layout.ts` is used
only by the standalone `--viz` server. That is a duplicated implementation of
exactly the kind ADR-026 was written to avoid.

`/api/layout` will return `{ kanban, gantt }` computed from the manifest, state,
audit-derived estimates and engine config by a lazily-memoized import of the
engine's viz modules — the same `tsImport` seam already used for human-review
approval (`server.ts:70-79`). The client re-fetches it on a debounce (~250 ms)
after an SSE status change and **lerps bar positions between layouts** for smooth
motion; the "now" line and elapsed clock advance locally per frame without a
refetch.

Rejected: a client-side `gantt.js` mirroring the algorithm. Two implementations
of a scheduling algorithm that must agree with the engine's dispatcher will
drift, and only one of them would be unit-tested.

### D5 - The Gantt schedules with the engine's own prerequisite rule

Deps are direct task dependencies plus every task of directly-dependent phases —
`task-graph.ts:27-42`. A new `prerequisites(manifest, taskId)` export becomes the
single definition; `unmetPrerequisites` filters it. Using anything else would let
the Gantt schedule tasks the engine cannot dispatch.

### D6 - Estimates come from observed durations, and say so

Per task: median `durationMs` of that task's `task.complete` audit events →
median for the same `ownerAgent` → a constant default. The tooltip names which
source was used. `attemptHistory` is already persisted by the engine
(`types.ts:35`) but missing from the Console's `TaskRecord`
(`console/types.ts:20-33`); adding it is additive and improves the estimate.

Rejected: storing estimates in the manifest. That is a schema change, and any
estimate baked at compile time goes stale as the run diverges.

### D7 - Forecasts are concurrency-aware

With `engine-config.concurrency = N`, a forecast task starts when a slot frees,
not merely when its last dependency ends. Scheduling on dependencies alone is
systematically optimistic and diverges from what the engine will actually do.

### D8 - Kanban remains the default; Gantt is opt-in and remembered

Mode and filters persist per project through `store.getDraft`/`setDraft`, which
already backs the feature-prompt draft (`state.ts:49-57`).

### D9 - The Board stops being canvas-only

A `Table` toggle renders a real `<table>` — task, owner, status, phase, start,
end, duration, dependencies — with keyboard navigation and `aria-live` status
updates. The mode control is a `role="tablist"`. `prefers-reduced-motion`
disables pulse, flash and glow.

### D10 - Reset lives with reconciliation

**Reset changed tasks for review** moves into the Manifest panel next to the
reconciliation data it acts on, behind a confirmation that lists exactly which
tasks will be reset. Controls keeps a pointer rather than a duplicate button.

## Workstream A - Re-derivation chain

### A1. `scripts/forge-launcher/scripts/rederive-state.ts` (new)

`docs/rederive-state.json`, shaped and validated like `authoring-state.ts`
(version 1, throw on malformed, atomic `writeAuthoringJson`):

```ts
interface RederiveStep {
  id: "team" | "skills" | "manifest";
  label: string;
  status: "pending" | "running" | "complete" | "failed";
  message?: string;
  startedAt?: string;
  finishedAt?: string;
}
interface RederiveState { version: 1; runId: string; steps: RederiveStep[]; }
```

Exposes `readRederiveState`, `startRederiveStep`, `completeRederiveStep`,
`failRederiveStep`, `clearRederiveState`.

### A2. `authoring-state.ts`

Add `explainStaleness(repo, stage, harnessRoot)` returning
`{ stale, reason, staleInputs: Array<{ path, modifiedAt }> }`, and extend
`authoringReadiness()` to carry per-stage detail rather than only `nextStage`.

### A3. `launcher.ts` + `cli.ts`

`runRederiveInternal(repoDir)`:

1. Guard `docs/PRD.md` and a non-empty `docs/features/`. If absent, return the
   ADR-060 interactive-session guidance and write no state.
2. `runDraftTeamInternal(repoDir)` — feature-increment mode when a feature
   handoff exists, mirroring `autoDraftTeam` (`launcher.ts:1249-1253`).
3. `runDraftSkillsInternal(repoDir)`.
4. `runCompileManifestInternal(repoDir)`.

Step state is written between each step; the chain aborts on first failure and
leaves that step `failed` with its message so the UI can offer **Retry from
here**. Export `runRederive(repoDir, options)` and add a `rederive` subcommand.

### A4. Console plumbing

- `console/types.ts`: `ControlAction += "rederive"`,
  `BackgroundJobType += "rederive"`, `TaskRecord.attemptHistory?`,
  `Summary.authoringStages: AuthoringStageDetail[]`,
  `Summary.rederive: RederiveProgress | null`.
- `console/repo.ts`: `"rederive"` added to `AUTHORING_JOB_TYPES` (`:298`) so
  `authoringBlocker` (`:300-310`) blocks building while it runs, matching the
  other authoring jobs; new `rederive(p)` projection; `summary()` (`:345`) gains
  the two new fields.
- `console/control.ts`: `RunController.rederive()` beside `draft()` (`:207`);
  `dispatch` case (`:396-421`).
- `console/server.ts`: `GET /api/rederive`; `POST /api/control` already carries
  the new action generically.
- `console/dashboard/{api,types}.ts`: `api.rederive()` and mirrored types.

### A5. UI - `views/overview.ts`

New `overview-rederive` region above Manifest. When anything is stale: one
primary **Re-derive team & skills** button, then the step machine inline, each
step showing status and message, with **Retry from here** on failure. When the
chain completes with changed tasks, it closes by pointing at the confirmed reset.

### A6. UI - `views/overview.ts` Manifest panel

Replace the mono `changedTaskIds` string (`:336`) with a per-task list showing
status and what changed, and move **Reset changed tasks for review** here behind
a confirmation naming every affected task. Remove the duplicate from Controls
(`:601-604`), leaving a pointer.

### A7. UI - `views/documents.ts`

Turn the three stage cards (`:299-341`) into a stepper:

- The action button is **always rendered**, disabled with a visible reason when
  not applicable ("already current", "save model changes first", "generation
  already running") instead of being hidden.
- The staleness cause appears under the badge, e.g. *"docs/PRD.md modified 3h
  ago, after this stage completed"*.
- Outputs count and timestamps.
- Deep link `#/documents?stage=team` scrolls to and highlights the card, so
  Overview can link straight at the offending stage.
- A **Re-derive all** footer showing live step progress.

## Workstream B - Gantt mode

### B1. `templates/skills/forge-workflow-engine/scripts/task-graph.ts`

Add `prerequisites(manifest, taskId): string[]` as the single definition;
reimplement `unmetPrerequisites` as a filter over it. Update the module comment
to name `viz/gantt.ts` as a second consumer.

### B2. `templates/skills/forge-workflow-engine/scripts/viz/gantt.ts` (new)

Pure `layoutGantt(manifest, state, options)`, the sibling of `layout.ts`:

```ts
interface GanttBar {
  taskId: string; row: number; kind: "actual" | "planned";
  startMs: number; endMs: number; status: string;
  ownerAgent?: string; critical: boolean; milestone: boolean;
  estimateSource: "audit" | "owner" | "default" | "actual";
}
interface GanttRow { kind: "phase" | "task"; id: string; label: string; y: number; height: number; }
interface GanttLayout {
  width: number; height: number; rows: GanttRow[]; bars: GanttBar[];
  edges: Array<{ from: string; to: string }>;
  axis: { min: number; max: number; ticks: Array<{ at: number; label: string }> };
  forecastEndMs: number; criticalPath: string[];
}
```

- **Estimates**: D6 ladder.
- **Actual bars**: `startedAt` → `completedAt ?? now`. The engine persists
  `running` at `task.started` (ADR-026), so in-flight tasks have a real start.
- **Forecast**: forward pass in topological order over `prerequisites()`,
  concurrency-aware packing (D7).
- **Critical path**: longest weighted chain, backtracked from the maximum
  earliest-finish, highlighted by default.
- **Phase rollups**: span bars plus header rows.
- **Milestones**: `contract.kind === "human-review"` and `approvalRequired`
  tasks become zero-length diamonds at their finish.
- **Axis**: minute ticks under 2 h, hour ticks under 2 days, day ticks beyond,
  with day-boundary rules. Span is `min(firstActualStart, runStart)` to
  `max(now, forecastEnd)`.

### B3. `templates/skills/forge-workflow-engine/scripts/viz/dashboard/app.js`

- `mode` read from `?mode=`; HUD segmented control.
- Gantt renderer reusing the existing background, label rail, edge layer, HUD,
  legend, camera and tooltip. Bars are Graphics in a new layer plus a time-ruler
  layer.
- `task.started` flips a bar planned → actual and animates it from its forecast
  position; `task.complete` solidifies it; `task.failed` reddens it; a finishing
  dependency re-flows downstream forecasts with a lerp.
- Layout fetched from `/api/layout` on a debounce after structural SSE changes;
  bar positions lerp between old and new layouts.
- `postMessage` bridge to the Console for navigation and state reporting.
- Reduced-motion honoured.

### B4. `console/server.ts`

Implement `/api/layout` → `{ kanban, gantt }` via a lazily-memoized `tsImport` of
the engine viz modules. Fixes the existing `null`, so the tested layout finally
serves the Console.

### B5. `console/dashboard/views/board.ts`

Console chrome above the iframe: `Kanban | Gantt` segmented control, Fit,
status + phase filters, Table toggle. Mode and filters persist per project and
are passed as iframe query params. A `postMessage` listener maps
`{ type: "forge:navigate", href }` to `location.hash`.

### B6. `console/types.ts`

Add `attemptHistory?: TaskAttemptSummary[]` to `TaskRecord`. Additive; the data
is already on disk.

## Workstream C - Board polish

- **Distinct states** (`app.js`, `index.html`): no manifest → "No execution
  manifest yet" plus a link to Overview's **Create manifest**; never run →
  "Ready to build"; SSE closed → "Disconnected — retrying" with a Reconnect
  button and a last-update age.
- **Accessible table view**: a real `<table>` behind the Table toggle with
  keyboard navigation and `aria-live` status updates; `role="tablist"` on the
  mode control. Replaces the "use Tasks" dead end.
- **Cross-view navigation**: expanded card and Gantt bar gain **Open in Tasks**,
  **Show artifact**, **Show logs**, routed through the `postMessage` bridge.
- **Persistent failed list** in the HUD with Replay links, instead of only a
  flash.
- **Density**: collapse completed phases, a minimap when content exceeds the
  viewport, clickable status-filter chips, legend toggling.
- **Performance**: redraw edges only when something actually moved; cap
  concurrent artifact-traveller sprites.

## Acceptance criteria

- [ ] With a PRD edited after authoring, the Console names the changed input
      file, the stage that went stale, and when it happened — on both Overview
      and Plan & Team, without navigating.
- [ ] One click runs team → skills → manifest with a live step machine; a
      failure stops the chain, names the step, and offers retry from it.
- [ ] The chain refuses to run without a committed PRD and points at the
      interactive session (ADR-060 intact).
- [ ] The chain never resets completed tasks; the reset is offered separately,
      behind a confirmation listing every affected task.
- [ ] Every stage action button is always visible, disabled with a stated
      reason when inapplicable.
- [ ] `#/documents?stage=team` scrolls to and highlights the Team card.
- [ ] The Board has a Kanban/Gantt toggle that survives navigation and project
      switches.
- [ ] The Gantt renders actual and forecast bars, phase rollups, milestones, a
      time axis and a moving "now" line, and updates live on task events.
- [ ] The Gantt's forecast agrees with the engine's dispatch rule (D5) and its
      concurrency setting (D7); verified by test.
- [ ] The critical path is highlighted and its length equals the forecast end.
- [ ] `/api/layout` serves both layouts instead of `null`, and the board's
      client-side duplicate geometry is reduced to a fallback path only.
- [ ] No manifest has a distinct banner; a dead SSE connection reports its age
      and offers reconnect.
- [ ] The Table view exposes every task with owner, status, timings and
      dependencies to keyboard and screen-reader users.
- [ ] Reduced motion disables pulse, flash and glow in both modes.
- [ ] `npm run typecheck` and `npm test` pass in `scripts/forge-launcher` and
      `templates/skills/forge-workflow-engine`.

## Tests

- `templates/skills/forge-workflow-engine/scripts/viz/gantt.test.ts` — new, mirrors
  `layout.test.ts`. Covers the estimate ladder, concurrency-aware packing,
  critical-path length, milestone rendering, axis tick selection, and agreement
  with `prerequisites()`.
- `engine.test.ts` — extend the existing block at `:139-161`, which already
  asserts `unmetPrerequisites` agrees with `nextReadyTasks` about what is
  reviewable, to cover `prerequisites()` directly.
- `scripts/forge-launcher/scripts/rederive.test.ts` — new. Step-state
  transitions, abort-on-failure, retry-from-failed-step, and the no-PRD guard.
- `console-authoring.test.ts` — extend: `explainStaleness` names the changed
  input; `authoringBlocker` blocks while a `rederive` job runs; the chain is
  reflected in `summary`.
- `launcher.test.ts` — extend: `rederive` subcommand wiring.
- `dashboard-projects.test.ts` style DOM test — stage stepper always renders its
  action with a reason when disabled.

## Docs

- `docs/adr/062-console-rederivation-chain.md`
- `docs/adr/063-forge-board-chrome-and-accessibility.md` (amends ADR-026)
- `docs/adr/064-forge-board-gantt-mode.md`
- `docs/forge-console.md` — views table, run-controls table, a new
  re-derivation section, Board mode documentation.
- `docs/forge-console-user-guide.md` — §3 (pipeline) and §6 (incremental
  changes). This file is the source of the bundled `guide.md`
  (`scripts/forge-launcher/scripts/copy-client-assets.mjs`), so there is one
  source of truth.
- `docs/updates.md` — new version section; `README.md` `**Latest:**` bump.
- `docs/forge-console-screenshots.md` — new captures.
- `tools/console-screenshots/src/fixture.ts` — add re-derive step state, stale
  stages, and tasks with timing; `capture.ts:22` — add the Gantt capture.

## Build notes

`scripts/forge-launcher/resources/**` is gitignored build output, so the edit
surface is `scripts/forge-launcher/scripts/**` and
`templates/skills/forge-workflow-engine/scripts/**`. Two build steps:

- The client bundle is compiled by `npm --prefix scripts/forge-launcher run build`
  (tsc + `copy-client-assets.mjs`). Always run it — the browser loads
  `resources/console/client`, not the TypeScript sources.
- `stage-resources.mjs` refreshes `resources/templates` from `templates/`. It
  only runs at `npm pack` time, so it is a **packaging** concern rather than a
  development one: `resolveResources()` prefers the live `templates/` directory
  whenever `docs/prompt-playbook.md` sits beside it, which is always true in this
  repo. Board edits are therefore picked up live; they would go stale only in a
  packed install whose bundled copy was staged before the change.

## Risks

- **Layout payload size.** `/api/layout` now returns two layouts plus estimates.
  Mitigated by debounced refetch and by recomputing only on structural change.
- **Forecast divergence.** Estimates are inferred, not declared, so the forecast
  end is an approximation. Mitigated by labelling the estimate source per task
  and never presenting the forecast as a commitment.
- **Importing engine viz modules into the Console.** `tsImport` of `.ts` from
  `node_modules` already failed once (v3.92) and was fixed by routing through the
  launcher's `tsx`. The layout import must use the same seam and must memoize,
  or every request re-transpiles.
- **`prerequisites()` refactor.** `unmetPrerequisites` gates human-review
  approval. The refactor must be behaviour-preserving and covered by a test that
  asserts the two agree.
- **Scope.** Three workstreams, three ADRs and a documentation pass in one
  change set. Each workstream is independently verifiable; if the diff needs to
  shrink, drop C before A, never A before C.

## Task checklist

### Workstream A - re-derivation

- [x] A1 `rederive-state.ts` + `rederive.test.ts`
- [x] A2 `explainStaleness` and per-stage readiness detail
- [x] A3 `runRederiveInternal` + `rederive` subcommand
- [x] A4 Console types, repo projection, controller, `/api/rederive`
- [x] A5 Overview re-derive region and step machine
- [x] A6 Manifest reconciliation list + confirmed reset
- [x] A7 Plan & Team stage stepper with reasons and deep links

### Workstream B - Gantt

- [x] B1 `prerequisites()` in `task-graph.ts` + `engine.test.ts` coverage
- [x] B2 `viz/gantt.ts` + `gantt.test.ts`
- [x] B3 Board mode toggle, Gantt renderer, live transitions
- [x] B4 `/api/layout` serves both layouts
- [x] B5 Console board chrome, filters, `postMessage` bridge
- [x] B6 `attemptHistory` on the Console `TaskRecord`

### Workstream C - board polish

- [x] C1 Distinct empty / never-run / disconnected states
- [x] C2 Accessible table view and `role="tablist"` mode control
- [x] C3 Cross-view navigation from cards and bars
- [x] C4 Persistent failed list with Replay
- [ ] C5 Phase collapse and minimap — **not done.** Status filters landed
      instead; a large board is still pannable rather than collapsible.
- [x] C6 Performance guards (reduced motion, debounced layout fetch)

### Cross-cutting

- [x] ADRs 062, 063, 064
- [x] `forge-console.md`, `forge-console-user-guide.md`, screenshots doc
- [x] `docs/updates.md` section (v3.94) and `README.md` `**Latest:**`
- [x] Screenshot fixture and captures regenerated
- [x] `typecheck` + `test` green in both packages

## Deviations from the plan

Recorded because the plan is the record of intent, and these changed what was
actually built:

- **The layout ships the time scale as numbers, not a closure.** `xFor` began as
  a method on `GanttLayout`, and `JSON.stringify` silently dropped it — it
  arrived at the renderer as `undefined`. The engine now sends `axis` and `plot`;
  the renderer projects them to pixels.
- **The forecast is anchored to observed activity, not to `now`.** Unit tests
  could not catch this, but the regenerated screenshot did: the fixture's run
  ended 2026-09-22 and "now" was October, so a stale in-flight record stretched
  the axis across twelve days and crushed every real bar into a sliver. An
  unfinished `running` record is now bounded by the task's own forecast for both
  its bar and its dependents' scheduling, and the now-line — drawn only when it
  falls inside the axis — is what reveals staleness.
- **`jobs.ts` no longer declares its own `BackgroundJobType`.** The union was
  duplicated and had already drifted: adding `rederive` type-checked fine in one
  copy and failed in the caller. It is re-exported from the JSON contract now.
- **Two pre-existing server bugs were fixed in passing**, both surfaced while
  wiring `/api/layout`: a double `sendJson` could kill the process, and one bad
  repository read could take the whole SSE stream down.
- **The in-frame mode switch is kept only for standalone `--viz`.** Embedded in
  the Console, the chrome owns it; two controls for one setting reads as a bug
  the moment they disagree.