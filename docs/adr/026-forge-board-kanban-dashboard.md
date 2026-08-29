# ADR-026: The Forge Board - Kanban Dashboard for the Workflow Engine

**Date:** 2026-08-27
**Status:** Accepted
**Relates to:** ADR-025 (Squirrel Forge visualization - superseded), ADR-014 (workflow engine), ADR-017 (artifact store), ADR-021 (parallel dispatch), ADR-023 (forge launcher)

---

## Context

ADR-025 introduced *The Squirrel Forge*, a live PixiJS dashboard that rendered
the workflow-engine build as a growing oak tree: phases as whorls up the trunk,
tasks hanging off branch lines, and each agent as a **named squirrel** whose
pose encoded status (dozing = pending, scurrying = running, bounce = complete,
tumble = failed), with artifacts as acorns rolling between squirrels.

The metaphor was charming but hard to follow in practice:

- **Agents were the hero, not tasks.** The question users actually ask is "what
  task is running / what's next / what failed" - but the tree foregrounded the
  agent (squirrel) and required decoding a pose to know a task's status.
- **Status wasn't glanceable.** Pose encoding demands familiarity; there was no
  columnar or tabular order to scan.
- **Ambient motion competed with signal.** Fireflies, falling leaves, and a
  drifting moon drew attention away from state changes.
- **Overlap when dense.** Fixed branch-line spacing meant cards collided once a
  phase had many tasks, and long titles spilled over their boxes.
- **Stale "running" state.** The engine only persisted a task's status after it
  finished, so a mid-run refresh showed in-flight work as still "pending" - the
  live view lied.

The engine still exposes everything a board needs: the manifest (phases →
tasks, dependencies, owners, artifact contracts), workflow state (per-task
status), and the audit stream (`task.started`, `context.projected`,
`artifact.created`, `task.complete`, …).

## Decision

Replace the oak-tree theme with **The Forge Board** - a kanban dashboard where
**tasks are the hero**, rendered as name-tag cards on a board that reads at a
glance.

- **Board geometry.** One horizontal **band per phase**, stacked top-to-bottom
  (phase order = reading order). Four global status **columns** shared across
  all bands: **To Do · In Progress · Done · Failed** (skipped cards sit in Done,
  dimmed). Tasks flow left-to-right through the columns as their status changes.
- **Cards are name tags.** Each card carries a **procedurally-drawn agent face**
  - deterministic skin/hair tinted per agent (same hue as its legend swatch and
  card ring) with a mouth that reacts to status (neutral / working "o" / smile /
  frown) - the agent's readable name, the task title, and the task id. A
  status-colored header **ribbon** and a status dot keep state glanceable; a
  `ctx −N%` badge and an artifact badge sit in the corner.
- **Edges.** Dependency and artifact edges connect cards as faint curves
  (arrowheaded) that brighten on hover; artifact hand-offs animate as small
  glowing dots from producer to consumer card.
- **Auto-sized bands.** A band's height derives from its busiest column
  (`headerSpace + N·(cardH + gap) + pad`), so stacked cards never overlap the
  next band. Long titles are trimmed against the measured rendered width.
- **Interactions.** Pan from the board/background (no full-screen pan overlay,
  which previously swallowed pointer events), wheel to zoom, hover for a
  tooltip, click for the task detail panel. `fitCamera` shows the whole board.
- **Accurate "running".** The engine now persists a task's `running` status at
  `task.started`, so snapshots and reconnects reflect in-flight work. Because a
  crash can therefore leave a task marked `running`, `runEngine` resets any
  such tasks to `pending` on load - recovering them instead of deadlocking.
- **Naming.** The dashboard and all user-facing references are renamed from
  *The Squirrel Forge* to **The Forge Board** (browser title, HUD, launcher
  prompts, docs). ADR-025 remains as the record of the original design.
- **No engine dependencies added.** Still PixiJS v8 vendored into the dashboard
  and a `node:http` SSE server; the engine's zero-runtime-dependency footprint
  is preserved. The dashboard is a pure function of the layout/manifest/state
  so it remains unit-testable (`layout.ts`).

## Consequences

Positive:

- Status is scannable in one sweep (columns + ribbons + card color), and the
  "what's next" question is answered by the To Do column.
- Task identity (id/title) is always visible on the card, with agent identity as
  a stable color/face/legend - the two never compete.
- No ambiguous metaphor to decode; a kanban is universally understood.
- Cards and bands scale to arbitrary phase sizes without overlap, and the
  running status is truthful even after a reconnect.
- The `.cmd`/`.bat` Windows spawn fix (see the launcher's cross-spawn work)
  also covers the dashboard server and engine harness spawns.

Negative:

- A very large board (many phases × many tasks) is taller than the viewport;
  `fitCamera` shows an overview and users zoom/pan into detail.
- The whimsy is gone - the board is deliberately calm and functional, which
  some may find less memorable than the squirrel theme.
- Dropped the deterministic squirrel-name module (`names.ts`); agent identity is
  now color/face/hash-derived instead of a curated name pool.

Trade-offs considered:

- **Factory assembly line / skyscraper metaphors** - evaluated but rejected:
  both still require decoding, while a kanban is literal.
- **A light/paper theme** - considered but rejected to keep the existing dark
  HUD/panel styling and night-friendly reading.

## References

- ADR-025: The Squirrel Forge - the superseded oak-tree visualization.
- ADR-014: workflow engine; ADR-017: artifact store; ADR-021: parallel task
  dispatch; ADR-023: forge-launcher npm package.
- PixiJS v8 (vendored): `scripts/viz/dashboard/vendor/pixi.min.js`.
