# ADR-075: Top category navigation and fluid layout

**Date:** 2026-10-27
**Status:** Accepted
**Relates to:** ADR-034 (Forge Console web UI), ADR-072 (console navigation and Settings view)

## Context

ADR-072 replaced the flat top navigation with a grouped **left sidebar** and
introduced the consolidated Settings view. Two problems surfaced in use:

1. The menu belongs at the top. A persistent 224px sidebar consumes horizontal
   space on every view, and the categories were not reachable as a single unit —
   the user had to scan a vertical rail.
2. The view was capped at `max-width: 1200px`. On a large monitor the Console
   left most of the window empty, which is especially wasteful for the task
   table and the embedded board.

The Settings view consolidation from ADR-072 remains correct and is unaffected.

## Decision

1. **Top category bar.** Start / Pipeline / Monitor / Review / Settings are
   top-level categories. Hovering a category opens its views; selecting it pins
   the list open for touch. Single-item categories (Settings) are direct links.
   The active category keeps the amber accent edge, and the Terminal running
   indicator is preserved.
2. **Fluid content.** `#view` no longer has a max-width. Panels, tables, the
   board, and the authoring/model grids use the available width; only long-form
   prose (`.md` paragraphs/lists) is capped at ~90ch so text stays readable.
3. **Responsive behaviour.** At ≤720px the top bar wraps and the category row
   scrolls horizontally; an open menu becomes a fixed, full-width panel beneath
   the top bar so the scroll container cannot clip it.
4. **Layout metrics.** A `--topbar-h` variable joins `--contextbar-h`, so the
   board's height calculation accounts for both bars.

## Consequences

- Chrome is now one horizontal bar plus the project context row, returning the
  full width below it to the content.
- Tables and the board benefit most; the Overview remains a vertical stack (a
  two-column dashboard is a possible later refinement, deliberately not taken
  now to avoid reordering panels).
- Deep links (`#/tasks?task=…`, `#/documents?stage=…`, `#/terminal?authoring=…`,
  `#/projects?bootstrap=1`) are unchanged.
- Every committed screenshot was regenerated for the new shell; the tour adds a
  navigation-dropdown capture.

## References

- Shell: `scripts/forge-launcher/scripts/console/dashboard/index.html`.
- Navigation: `scripts/forge-launcher/scripts/console/dashboard/main.ts`
  (`renderNav`, `wireNav`).
- Styles: `scripts/forge-launcher/scripts/console/dashboard/style.css`.
- Supersedes the sidebar-navigation decision in
  [ADR-072](072-console-navigation-and-settings-view.md); the Settings view
  itself is unchanged.
- Changelog: [updates.md](../updates.md), v3.112.
