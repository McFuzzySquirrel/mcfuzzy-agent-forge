# ADR-063: Forge Board chrome, states, and accessibility

Status: Accepted

Amends: ADR-026 (The Forge Board). Relates to ADR-064 (dependency Gantt mode),
`docs/forge-board-and-rederive-plan.md`.

## Context

ADR-026 replaced the squirrel tree with a kanban board because "tasks are the
hero" and status must be scannable. That decision holds, but the board shipped
with no way to reach any of it:

- **No modes and no toolbar.** Only drag-pan and wheel-zoom existed. `fitCamera()`
  ran on load and resize only, so re-fitting and zooming were undiscoverable —
  and there was nowhere to put a mode switch.
- **One message for every empty and error state.** A failed `fetchSnapshot()`
  set "waiting for the engine server…", indistinguishable from "the server is
  down" when the real cause was "this project has no execution manifest yet".
- **The iframe was a dead end.** Clicking a card expanded it in place with no
  route out; the only escape was fallback text telling the reader to leave for
  the Tasks view.
- **Canvas-only.** No keyboard navigation and no DOM text, so the board was
  unavailable to a screen-reader user and to anyone not using a pointer.
- **Failures only flashed.** A failed task triggered a one-off red tint; once it
  faded there was nothing left to act on, and `Replay` lived in another view.

## Decision

Give the board chrome, honest states, an escape route, and a non-canvas
representation — leaving the kanban geometry itself (ADR-026) alone.

- **The Console owns the chrome.** `views/board.ts` renders a `Kanban | Gantt`
  segmented control and status filter chips above the iframe and passes the mode
  and filters as query parameters, remembered per project through
  `store.setDraft`. The board's in-frame mode switch is kept only for the
  standalone `--viz` server, where it is the sole control: two switches for one
  setting reads as a bug the moment they disagree, and when embedded the two are
  kept in step by `postMessage`.
- **Distinguish the states.** "Cannot reach the Console server" (with a retry),
  "No execution manifest yet" (linking to the Overview compile action), "Ready to
  build", and a dropped stream that reports how stale the picture is rather than
  only saying "disconnected".
- **The board can navigate out.** An iframe has no routes, so a card's or bar's
  actions post `forge:navigate` to the parent, which applies the hash. Tooltips
  carry **Open in Tasks**, **Logs** and **Artifacts**. The tooltip is
  `pointer-events: none` so it never blocks the board, so its action strip opts
  back in — otherwise its buttons would be unclickable.
- **The board stops being canvas-only.** A **Table** toggle renders the same data
  as a real `<table>` — task, owner, status, phase, start, end, duration,
  dependencies — and the mode control is a `role="tablist"`. It is a view of the
  engine's data, not an independent copy of the numbers.
- **Filters dim rather than remove.** A filtered-out task is dimmed, not hidden:
  removing cards reflows the board and hides the shape of the build, and the
  filtered-out columns are the context needed to judge the ones kept.
- **Failures persist.** A failed-task list stays in the HUD with a link into
  Tasks, instead of a tint that fades.
- **Reduced motion is honoured.** The running-card pulse is suppressed in the
  ticker (it is per-frame JS, not CSS) and the banner and failure animations
  collapse to a static appearance in CSS, keeping the information they convey.
- **`/api/layout` stops answering `null`.** It now serves both layouts from the
  engine's viz modules through the existing `tsx` import seam, so the tested
  layout finally reaches the Console.

## Consequences

Positive:

- Every board state is distinguishable, and each one names the action that
  resolves it.
- The board is reachable by keyboard and legible to a screen reader.
- A card can be followed into the task that produced it.
- Failures remain actionable after the animation ends.

Negative:

- The mode and filters live in the query string of an iframe the Console reloads
  on change; a mode switch re-renders the canvas rather than toggling a layer.
- The table duplicates the board's presentation. That is the point — it is a
  second projection of the same engine data, not a second source — but it is a
  second thing to keep in step.

## Alternatives considered

- **Keeping the canvas as the only representation.** Cheapest, and leaves the
  board unusable for a meaningful set of readers.
- **Two mode switches (in-frame and in the chrome).** Rejected as above: they can
  disagree, and when they do the board silently shows the wrong view.
- **Filtering by removal.** Rejected: it destroys the context the filter exists
  to reveal.
- **Suppressing the tick in reduced-motion instead of replacing it.** The pulse
  is decorative, so removing it entirely was also considered; a static
  high-contrast "running" bar conveys the same state without motion.