# Forge Console UI Overhaul — Multi-Phase Implementation Plan

**Status:** Proposed · **Date:** 2026-10-26 · **Repo:** mcfuzzy-agent-forge

> Authoritative tracked copy for the console UI overhaul workstream. Covers the
> four agreed workstreams: information-architecture overhaul + Settings view,
> system-level defaults, background-job notifications, and engine-side token/cost
> capture.

---

## 1. Context & problem statement

The Forge Console (`forge-launcher console`) is a tsc-compiled, vanilla-DOM SPA
served on loopback. It grew organically and now shows four symptoms:

1. **Overview is a vertical catch-all.** Ten stacked regions, including a
   *Controls* panel that doubles as a settings dump (build mode, run/pause/stop,
   replay, per-task + all-task timeouts, auto-commit, log-harness-activity,
   concurrency) — all in `views/overview.ts` (~1036 lines).
2. **Model/execution settings live in three disconnected places:**
   - Authoring runner + stage models → *Plan & Team → Authoring settings*
     (`docs/authoring-config.json`)
   - Per-agent primary/fallback → *Plan & Team → Agents cards*
     (`docs/model-overrides.json`)
   - Execution prefs (concurrency, auto-commit, log activity, mode) →
     *Overview → Controls* (`docs/engine-config.json`)
3. **Flat top nav with ~11 items**, no grouping or progressive disclosure.
4. **No project context outside Overview**, and **no token/cost visibility**
   anywhere (verified: the only "token" hits in the repo are the CSRF
   `forge-token`).

## 2. Goals

- G1. Intuitive, grouped navigation with a persistent project context bar.
- G2. A single **Settings** view consolidating authoring, execution, and model
  configuration — each item tagged **project** vs **global**.
- G3. **System-level defaults** (`settings.json` in `FORGE_HOME`) that projects
  inherit and can override.
- G4. **Per-run / per-task token & cost** capture and display (engine-side).
- G5. **Background-job notifications** (top-bar badge) so detached jobs
  (rederive, create-project, feature-increment) are visible without visiting
  Logs/Overview.

## 3. Non-goals (explicit)

- No framework migration (stay vanilla tsc + DOM; see ADR-034).
- No desktop/Electron wrapper (deferred per `forge-console-desktop-frontend-plan`).
- No proxy/gateway-level aggregate billing (Tier 3) — out of scope here.
- No changes to the engine's scheduling/dispatch semantics beyond usage capture.

---

## 4. Target information architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│ [project name ▾]  [harness badge]  [live/idle]      [⚙ settings] [help] │  ← context bar (persistent)
├──────────────┬──────────────────────────────────────────────────────┤
│ START        │  (active view renders here)                          │
│  Home        │                                                      │
│  Projects    │                                                      │
│ PIPELINE     │                                                      │
│  Overview    │                                                      │
│ MONITOR      │                                                      │
│  Board       │                                                      │
│  Tasks       │                                                      │
│  Logs        │                                                      │
│  Timeline    │                                                      │
│ REVIEW       │                                                      │
│  Plan & Team │                                                      │
│  Artifacts   │                                                      │
│  Documents   │                                                      │
│  Terminal    │                                                      │
└──────────────┴──────────────────────────────────────────────────────┘
```

- **Start / Pipeline / Monitor / Review** nav groups replace the flat list.
- Overview keeps only: header, pipeline guidance, authoring status, re-derivation,
  run stats, manifest/reconciliation, and **run controls** (Run/Pause/Stop/Resume
  + build mode + manual-task pointer). Timeouts/concurrency/auto-commit/log-activity
  move to **Settings**.
- A new **Settings** view hosts the three config surfaces with project/global tags.

---

## 5. Phases

### Phase 1 — System-level settings foundation

**Objective:** Introduce `settings.json` in the `FORGE_HOME` registry dir and the
project-overrides ladder, so later phases (Settings view, project-context bar)
have a single source of truth.

**Scope:**
- New module `scripts/forge-launcher/scripts/settings.ts`:
  - `settingsPath()` → `path.join(registryDir(), "settings.json")`
    (reuse `registryDir()` from `console/paths.ts`).
  - `loadSettings()` / `saveSettings()` with strict-shape validation, mirroring
    `loadRegistry`'s corrupt-file protection (never overwrite unreadable data).
  - Typed `GlobalSettings` schema:
    ```ts
    interface GlobalSettings {
      version: 1;
      authoring?: { runner?: AuthoringRunner; models?: Partial<Record<AuthoringStage, string>> };
      execution?: { concurrency?: number; autoCommit?: boolean; logHarnessActivity?: boolean };
      harness?: string;              // default harness for new projects
      ui?: { theme?: "light" | "dark" | "auto"; boardMode?: "kanban" | "gantt" | "table" };
    }
    ```
- Extend the effective-resolution ladder (documented in the user guide) to:
  `explicit agent override → saved project recommendation → project default →
  system default → runner default`.
  - `authoring-config.ts` (`selectAuthoringRunner`) reads global default when no
    project value and no env override.
  - `engine-config.ts` seeds `docs/engine-config.json` from global defaults at
    first run (current behavior already centralizes defaults here).
- New-project wizard (`views/new.ts`) + `projects/bootstrap` prefill from global
  defaults instead of hardcoded assumptions.
- Server endpoints under `/api/settings` (GET/PUT), token-gated like the existing
  `/api/engine-config`.

**Files:** `console/paths.ts`, new `settings.ts`, `authoring-config.ts`,
`engine-config.ts`, `console/server.ts`, `console/dashboard/api.ts`,
`console/dashboard/types.ts`, `views/new.ts`.

**Sub-agents:**
- *Lead:* `infrastructure-engineer` (server + config plumbing).
- *Review:* `qa-engineer` (settings persistence + ladder semantics tests).
- *Note:* the named `ui-engineer`/`core-logic-engineer` sub-agents are described
  for a different (Knowledge Dungeon) domain; for this repo use
  `infrastructure-engineer` + `general` + `qa-engineer`, or generate a
  console-specific team with `forge-team-builder`.

**Acceptance:**
- `settings.json` round-trips; corrupt file is surfaced, never clobbered.
- Setting a global default changes behavior only for projects that inherit
  (no explicit value); an explicit project value still wins.
- New-project wizard reflects global defaults.

**Changelog/docs:** `docs/updates.md` (v3.107), new ADR-071
`system-level-console-defaults`, update `docs/forge-console-user-guide.md` §3/§5.

---

### Phase 2 — Information-architecture overhaul (shell)

**Objective:** Grouped nav, persistent project-context bar, and a slimmed
Overview. Pure frontend; no backend changes beyond those in Phase 1.

**Scope:**
- `index.html`: replace flat `#nav` with grouped nav container; add a context-bar
  region (`#contextbar`) between topbar and `#view`.
- `main.ts`: restructure `views` into groups (`Start`, `Pipeline`, `Monitor`,
  `Review`); render grouped nav; add project-switcher dropdown in the context bar
  (project name, harness badge, live/idle, settings link, help).
- `views/overview.ts`: move `renderTimeoutControls`, `renderConcurrencyControl`,
  `renderAutoCommitToggle`, `renderLogHarnessActivityToggle` out (consumed by the
  Settings view in Phase 3). Keep run controls + build-mode + manual-task pointer.
- Keep Terminal/New routing behavior; the running-session dot moves to the
  context bar's Terminal entry.
- `style.css`: add group headers, sidebar/two-column layout, context-bar styles;
  respect `prefers-reduced-motion` (already a project convention).

**Files:** `dashboard/index.html`, `dashboard/main.ts`, `dashboard/style.css`,
`dashboard/views/overview.ts`.

**Sub-agents:**
- *Lead:* `general` (vanilla-TS DOM work; `ui-engineer` is React-scoped and not a fit).
- *Review:* `qa-engineer` (nav/routing + a11y regression tests).

**Acceptance:**
- All existing routes reachable; deep links (`#/tasks?task=…`, `#/documents?stage=…`,
  `#/terminal?authoring=…`) preserved.
- Project switch works from the context bar on every view.
- Overview no longer renders timeout/concurrency/commit/activity controls; no
  functional loss (Settings view takes over in Phase 3).

---

### Phase 3 — Settings view

**Objective:** One page consolidating authoring, execution, and model config,
tagged project vs global.

**Scope:**
- New `views/settings.ts` (registered in `main.ts` under a Settings group) with
  three sections:
  1. **Authoring** — runner + 3 stage models (moved from `documents.ts`
     `buildAuthoringSettings`, or refactored into a shared component); links to
     the model-inventory cache + model terminal.
  2. **Execution** — build mode, concurrency, auto-commit, log-harness-activity,
     task timeouts (moved from `overview.ts`).
  3. **Models** — per-agent primary/fallback overrides (moved from
     `documents.ts` `agentCard`) + inventory refresh.
- Each control shows a **project/global** tag; global edits write
  `settings.json` (Phase 1), project edits write the existing per-repo files.
- Preserve current "why disabled" messaging (unsaved models, busy job) from
  `documents.ts`/`overview.ts`.

**Files:** new `views/settings.ts`, `main.ts`, `documents.ts`,
`overview.ts`, `style.css`, `api.ts`, `types.ts`.

**Sub-agents:**
- *Lead:* `general`.
- *Review:* `qa-engineer` (settings save/override tests, a11y).

**Acceptance:**
- Every knob currently reachable from Overview/Documents is reachable from
  Settings; no setting silently dropped.
- Global vs project override semantics are visibly correct.

---

### Phase 4 — Background-job notifications

**Objective:** A top-bar badge for running/failed background jobs.

**Scope:**
- Server: expose a lightweight `/api/jobs` summary (active/failed) derived from
  existing job state (`console/jobs.ts`), or fold into the existing SSE
  `snapshot`/`authoring` events.
- Client: context bar subscribes to store/SSE and renders a badge
  ("1 job running" / "1 job failed") linking to Logs or Overview.
- Ensure it reflects: rederive, create-project, feature-increment,
  feature-increment-continue (the `AUTHORING_JOB_TYPES` set in `documents.ts`
  is a ready reference).

**Files:** `console/server.ts`, `console/jobs.ts`, `dashboard/state.ts`,
`dashboard/main.ts`, `style.css`.

**Sub-agents:**
- *Lead:* `infrastructure-engineer` (SSE/jobs) + `general` (badge UI).
- *Review:* `qa-engineer`.

**Acceptance:**
- Badge appears/disappears without a manual refresh; links land on the relevant
  view; a11y (aria-live) preserved.

---

### Phase 5 — Token & cost usage (engine-side, "Tier 2")

**Objective:** Capture per-task/per-run token + cost and display on Board/Overview.

> This is the largest change and warrants its own ADR. No capture exists today.

**Scope:**
- **Engine capture** (`templates/skills/forge-workflow-engine/scripts/`):
  - After each task's harness invocation, parse the harness's per-invocation
    usage summary into `{ inputTokens, outputTokens, cacheReadTokens,
    cacheWriteTokens, costUsd }` and write it to `EXECUTION-AUDIT.jsonl` +
    per-task timings in `WORKFLOW-STATE.json`.
  - Exact mechanism is backend-specific and must be verified during
    implementation: OpenCode (v2 session storage / `--print-metrics`), Claude
    Code (`--output-format json` `costUSD`), Copilot (metadata/session summary).
    Fall back to "unavailable" per backend rather than fabricating numbers.
- **Console aggregation** (`console/server.ts` + `dashboard`):
  - Extend `Summary`/`TaskRow` with usage fields; aggregate per-task totals and
    a run-level total.
  - Render in `views/board.ts` (card/tooltip), `views/tasks.ts` (column), and
    `overview.ts` (run stats).
- **Authoring sessions** (cheap "Tier 1" win, optional sub-task): the Console
  already owns authoring-session lifecycle, so it can read harness session files
  for PRD/team/skills token/cost and show them in `renderAuthoringStatus`.

**Files:** `templates/skills/forge-workflow-engine/scripts/*` (audit/state),
`console/server.ts`, `dashboard/types.ts`, `dashboard/api.ts`,
`dashboard/views/{overview,board,tasks}.ts`, new ADR.

**Sub-agents:**
- *Lead:* `infrastructure-engineer` (engine capture) + `general` (UI).
- *Review:* `qa-engineer` (usage math, per-backend fixture tests).
- *Discovery:* `explore` to confirm each harness CLI's usage surface before
  coding (opencode / copilot / claude).

**Acceptance:**
- A run on each supported harness records per-task usage (or an explicit
  "unavailable" marker — never silent zeros).
- Board/Overview/Tasks show totals that reconcile with per-task values.
- No regression to the harness "log activity" toggle or plain log tails.

---

## 6. Sub-agent mapping summary

| Phase | Lead | Support / review | Notes |
|-------|------|------------------|-------|
| 1 System settings | `infrastructure-engineer` | `qa-engineer` | backend + config |
| 2 IA overhaul | `general` | `qa-engineer` | vanilla-TS DOM |
| 3 Settings view | `general` | `qa-engineer` | consumes Phases 1–2 |
| 4 Job notifications | `infrastructure-engineer` + `general` | `qa-engineer` | SSE + badge |
| 5 Token usage | `infrastructure-engineer` + `general` | `qa-engineer`, `explore` | own ADR |

> The repo's `ui-engineer` / `core-logic-engineer` / `game-engineer` sub-agents
> are scoped to the Knowledge Dungeon project (React/Phaser), not this
> vanilla-TS console. Either use `general` for frontend work or generate a
> dedicated console team with `forge-team-builder` (itself a forge skill) before
> starting.

## 7. Sequencing & dependencies

```
Phase 1 (system settings) ──┬──▶ Phase 3 (Settings view)
                            │
Phase 2 (IA shell) ─────────┘
Phase 4 (job notifications) ── independent
Phase 5 (token usage) ──────── independent, largest, last
```

- Phase 1 and Phase 2 can start in parallel (backend vs frontend).
- Phase 3 requires both 1 and 2.
- Phase 4 is independent and small — good early "warm-up" or parallel track.
- Phase 5 is independent but largest; start after Phase 2 lands so the display
  surfaces (Board/Overview) are stable.

## 8. Cross-cutting obligations (per repo conventions)

- Every phase: bump `docs/updates.md` (`## <Month> <Year> - v<ver>`), sync
  README `**Latest:**`; add an ADR for behavior changes (next number: **071**).
- Update `docs/forge-console-user-guide.md`, `docs/forge-console.md`, and
  `docs/documentation-map.md` triggers in the same change as each behavior.
- Preserve historical ADRs/changelog entries when behavior is retired.
- Run each package's `npm run typecheck` + `npm test`; the console tests live in
  `scripts/forge-launcher/scripts/console*.test.ts`.

## 9. Decisions (resolved 2026-10-26)

1. **Settings precedence:** global defaults cover **both** authoring and
   execution prefs; each project can override.
2. **Nav style:** **left sidebar** with Start/Pipeline/Monitor/Review groups.
3. **Token display:** **tokens always; estimated cost when the harness reports it.**
4. **Phase 5 scope:** **bundle** authoring-session ("Tier 1") capture into Phase 5.
