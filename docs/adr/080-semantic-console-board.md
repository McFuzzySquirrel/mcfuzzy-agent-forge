# ADR-080: Semantic HTML baseline for the Console Board

**Date:** 2026-11-04
**Status:** Accepted
**Supersedes:** The Console Board presentation decisions in ADR-063
**Relates to:** ADR-026 (The Forge Board), ADR-063 (Forge Board chrome, states, and accessibility), ADR-064 (dependency Gantt mode)

## Context

The Console Board was an iframe around the standalone PixiJS dashboard. Its
separate renderer, table toggle, and parent-frame toolbar made basic Task
summaries and details depend on a canvas visualization being available. The
adaptive Console needs one reliable Board baseline that works with keyboard and
screen readers, while keeping the standalone visualization available and
leaving workflow-engine scheduling unchanged.

## Decision

- The Console Board is semantic HTML/CSS over the existing Task API and
  workflow-engine layout API. The Console Board does not load or require PixiJS;
  the standalone `workflow-engine run --viz` surface remains separate.
- Kanban and Gantt consume the same Task-summary projection, selection,
  attention cues, status filters, and compact details. Kanban foregrounds
  workflow status; Gantt adds measured and forecast durations and the engine's
  critical path.
- Selecting a Task card or Gantt bar opens the same details with its summary,
  blocker, prerequisites, and next action. Full diagnostics remain in All tasks.
- Project-keyed browser preferences preserve Board mode, selection, and status
  filters across refreshes. Kanban and Gantt keep independent scroll positions.
- Status filters dim nonmatching Tasks instead of removing them, preserving
  workflow context. Loading, empty, failed, and stale-data states remain
  explicit and offer a next action.
- The Board is a projection only. It does not change task contracts, dependency
  rules, scheduling, or execution behavior.

## Consequences

- The core Console Board remains usable without the standalone PixiJS assets and
  exposes Task actions through native controls and structured tables.
- The Gantt depends on the existing layout API for duration and critical-path
  projections. If timeline data is unavailable, the Board explains the state,
  offers refresh, and keeps Task summaries available.
- Preferences are browser-local and isolated by selected Project. They do not
  modify project or workflow files.
- The standalone visualization can continue evolving independently; its
  renderer is not the source of truth for Console Board details or preferences.

## Alternatives considered

- **Keep the iframe as the Console Board baseline.** Rejected because the
  baseline would still depend on a separate visual renderer and require a
  separate accessible representation.
- **Keep a table toggle beside the canvas.** Rejected because the semantic
  representation should be the default in both peer views, not a fallback mode.
- **Filter by removing nonmatching Tasks.** Rejected because it hides workflow
  shape and context needed to interpret the remaining Tasks.

## References

- Implementation: `scripts/forge-launcher/scripts/console/dashboard/views/board.ts`
- Task summary and preference behavior: `scripts/forge-launcher/scripts/console/dashboard/views/board-model.ts`, `board-preferences.ts`
- User guide: `docs/forge-console.md`, `docs/forge-console-user-guide.md`
- Earlier Board decisions: [ADR-063](063-forge-board-chrome-and-accessibility.md)
