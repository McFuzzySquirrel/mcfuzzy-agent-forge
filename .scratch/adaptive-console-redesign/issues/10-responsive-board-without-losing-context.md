# 10: Adapt the Board to narrow screens without losing context

**What to build:** Users can navigate Kanban and Gantt and inspect a selected
Task on narrow screens without losing the Board position or selection.

**Blocked by:**
- 06: Make the Board semantic and consistent across views.
- 07: Complete the Board keyboard and screen-reader contract.
- 09: Adapt the Console shell to wide, medium, and narrow layouts.

**Status:** resolved

- [x] Kanban retains phase bands and status columns; narrow screens scroll
  horizontally across status columns while keeping phase labels visible.
- [x] Gantt keeps Task labels visible while its timeline can be panned.
- [x] Task details use a side panel on wider screens and a full-screen overlay
  on narrow screens.
- [x] Closing Task details returns to the same selected Task and Board
  position.
- [x] Selected Task, filters, and per-view Board position remain usable across
  responsive changes and refresh.
- [x] Keyboard and screen-reader behavior remains usable at narrow sizes.
- [x] Affected Console documentation and visual captures reflect the delivered
  layouts.
