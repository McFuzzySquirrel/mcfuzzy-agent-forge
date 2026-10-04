# ADR-064: Dependency Gantt mode on the Forge Board

Status: Accepted

Relates to: ADR-026 (the Forge Board), ADR-063 (board chrome and
accessibility), ADR-014 (workflow engine), ADR-021 (parallel task dispatch),
`docs/forge-board-and-rederive-plan.md`.

## Context

The Board answers *what is running, what is next, what failed*. It cannot answer
*how far along is this phase*, *when will the build finish*, or *which tasks are
on the critical path*. Timeline shows audit events, not schedule — a different
question.

The engine already has everything a schedule needs: the manifest (phases, tasks,
dependencies, owners), the run state (per-task `startedAt`/`completedAt`), the
audit stream (every attempt's `durationMs`), and the engine's own dispatch rule.
The manifest carries **no dates and no estimates**, so any forecast has to be
inferred from observed behaviour.

Two things make that forecast easy to get wrong:

- **A second dependency rule.** `task-graph.ts` defines readiness as a task's
  direct dependencies plus *every task of each phase it depends on*. Any other
  rule would happily schedule tasks the engine cannot dispatch.
- **Ignoring concurrency.** With `engine-config.concurrency = N`, only N tasks
  run at once. Scheduling purely on dependencies assumes unlimited parallelism
  and is systematically optimistic.

## Decision

Add a **Gantt mode** to the board — a second projection of the same run, sharing
the SSE stream, camera, HUD and legend — whose geometry is a pure function of the
manifest and run state.

- **One implementation, server-side.** `viz/gantt.ts` is a pure `layoutGantt()`
  beside the existing `layout.ts`, unit-tested the same way, and served on
  `/api/layout`. The board draws what the engine decided and re-implements
  nothing. A client-side copy was rejected: two scheduling algorithms that must
  agree with the dispatcher will drift, and only one would be tested.
- **Dependencies come from `task-graph.ts`.** `prerequisites(manifest, taskId)`
  is extracted as the single definition and `unmetPrerequisites` filters it, so
  the dispatcher, the Console row label, the human-review guard and the Gantt
  cannot disagree about what is ready.
- **Forecasts are concurrency-aware.** A task starts when its prerequisites have
  finished *and* a worker slot frees, not merely when its last dependency ends.
- **Estimates come from observed durations, in descending order of evidence**:
  the task's own attempts across the run (harvested from `task.complete` audit
  events, so retried tasks contribute every attempt), then the same
  `ownerAgent`'s attempts, then a constant. Each bar carries which source was
  used and the tooltip names it. Nothing is presented as more precise than it is.
- **Measured and forecast are drawn differently.** Actual bars are filled;
  planned bars are outlined and hatched. That distinction is the point of showing
  both.
- **A running task is projected forward, not treated as finished.** It has not
  completed, so its dependents are scheduled from `start + estimate` rather than
  from "now" — otherwise a dependency looks complete the instant you looked.
- **Forecasts start at `now`, never in the past**, and a started task holds its
  worker until its projected finish rather than being re-planned from scratch.
- **Human reviews are milestones.** A `human-review` task is a zero-length gate
  that costs a human decision, not an agent run, so it occupies no time and no
  worker slot.
- **The critical path is the longest dependency chain**, computed over forecast
  durations with finished work contributing zero. Highlighted by default.
- **The time axis is local.** Ticks and day boundaries follow the reader's clock:
  a build runs on wall-clock time, so anchoring ticks to UTC multiples while
  labelling them with local hours puts every label on the wrong minute and never
  marks a day boundary at all.
- **The layout is plain JSON.** The engine ships the *domain* — axis extents and
  plot geometry — and the renderer owns the projection to pixels. A closure on
  the payload would be dropped by `JSON.stringify` and arrive as `undefined`.

## Consequences

Positive:

- "When will this finish" and "what is on the critical path" become answerable
  at a glance, and update live.
- The forecast is derived from the engine's own dispatch rule and concurrency
  setting, so it cannot promise a sequence the engine will not run.
- The scheduling logic is unit-tested independently of PixiJS and of the Console.

Negative:

- Durations for never-run tasks are inferred, so the forecast end is an
  approximation. It is labelled as a forecast and never presented as a commitment.
- The layout is recomputed per request on the server and refetched (debounced)
  after structural events.
- Concurrency packing is a model of slot availability, not a simulation of the
  engine's scheduler.

## Alternatives considered

- **A separate DOM Gantt view in the Console.** Cheaper and accessible by
  default, but a second visual identity from the board, duplicating its
  affordances, and answering "when" somewhere other than where you watch the
  build.
- **Storing estimates in the manifest.** A schema change, and any estimate baked
  at compile time goes stale as the run diverges.
- **Scheduling on dependencies only.** Simpler, and wrong whenever concurrency is
  greater than one.