# ADR-072: Console navigation and Settings view

**Date:** 2026-10-26
**Status:** Accepted
**Relates to:** ADR-034 (Forge Console web UI), ADR-071 (system-level console defaults)

## Context

The Forge Console grew a flat top navigation of ~11 items and scattered
configuration across three surfaces: authoring runner + stage models under
*Plan & Team → Authoring settings*, per-agent model overrides under *Plan &
Team → Agents*, and execution preferences (concurrency, auto-commit,
harness-activity logging, build mode) under *Overview → Controls*. Project
context was only visible on the Overview header, so switching repos or reading
the Live/Idle state required leaving whatever view the user was on.

## Decision

1. **Replace the flat nav with a grouped left sidebar.** Views are organised
   into **Start** (Home, Projects), **Pipeline** (Overview), **Monitor** (Board,
   Tasks, Logs, Timeline), **Review** (Plan & Team, Artifacts, Terminal), and
   **Settings**. The New Project wizard stays reachable from Home and is not a
   sidebar item. Routing remains `location.hash` (`#/view`); deep links
   (`#/tasks?task=…`, `#/documents?stage=…`, `#/terminal?authoring=…`,
   `#/projects?bootstrap=1`) are unchanged.
2. **Add a persistent project context bar** above the main view, visible on
   every route. It shows the current project name + repo root, a harness badge,
   a Live/Idle indicator, the Help button, the connection status, and a project
   switcher dropdown populated from `/api/projects` (switching calls
   `/api/projects/select` and navigates to Overview). When no project is
   selected the sidebar still renders and the context bar reads "No project
   selected".
3. **Introduce a single Settings view** (`#/settings`) with three sections:
   - **Authoring** — the runner + three stage-model selects and Save/Refresh
     (moved from `buildAuthoringSettings` in `documents.ts`).
   - **Execution** — build mode, concurrency, auto-commit, harness-activity
     logging, and per-task / all-task timeouts (moved from `overview.ts`).
   - **Models** — per-agent primary/fallback overrides, the model planning
     terminal, and inventory refresh (moved from `documents.ts` `agentCard` /
     `modelTerminalPanel`).
4. **Slim Overview's Controls panel** to run controls only (Run/Resume/Pause/
   Stop, Replay, build mode, and the manual-task pointer), linking to Settings
   for execution preferences. Plan & Team keeps the documents, agent/skill
   cards, and authoring stage cards + re-derivation footer, since the
   `#/documents?stage=` deep link and stage retry actions remain there.

## Consequences

- Settings are discoverable in one place instead of three; each section maps to
  a single on-disk file (`docs/authoring-config.json`,
  `docs/engine-config.json`, `docs/model-overrides.json`).
- The "why disabled" messaging is preserved: authoring stage cards keep
  "Another authoring job is running" (driven by the running job), while
  "Save authoring model changes first" now lives with the model selects in
  Settings, where unsaved changes originate.
- Project context (name, harness, live state, switching) is available on every
  view without a route change.
- These controls are project-scoped; system-level defaults (ADR-071) are
  inherited server-side and this view edits the project overrides.

## References

- Shell + router: `scripts/forge-launcher/scripts/console/dashboard/main.ts`.
- Layout: `scripts/forge-launcher/scripts/console/dashboard/index.html`,
  `style.css`.
- Settings view: `scripts/forge-launcher/scripts/console/dashboard/views/settings.ts`.
- Slimmed Overview: `scripts/forge-launcher/scripts/console/dashboard/views/overview.ts`.
- Plan & Team: `scripts/forge-launcher/scripts/console/dashboard/views/documents.ts`.
- Changelog: [updates.md](../updates.md), v3.108.
- Plan: [forge-console-ui-overhaul-plan.md](../forge-console-ui-overhaul-plan.md).
