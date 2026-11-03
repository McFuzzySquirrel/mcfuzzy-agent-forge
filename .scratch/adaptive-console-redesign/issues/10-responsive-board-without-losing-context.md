# 10: Adapt the Board to narrow screens without losing context

**What to build:** Users can navigate Kanban and Gantt and inspect a selected
Task on narrow screens without losing the Board position or selection.

**Blocked by:**
- 06: Make the Board semantic and consistent across views.
- 07: Complete the Board keyboard and screen-reader contract.
- 09: Adapt the Console shell to wide, medium, and narrow layouts.

**Status:** ready-for-agent

- [ ] Kanban retains phase bands and status columns; narrow screens scroll
  horizontally across status columns while keeping phase labels visible.
- [ ] Gantt keeps Task labels visible while its timeline can be panned.
- [ ] Task details use a side panel on wider screens and a full-screen overlay
  on narrow screens.
- [ ] Closing Task details returns to the same selected Task and Board
  position.
- [ ] Selected Task, filters, and per-view Board position remain usable across
  responsive changes and refresh.
- [ ] Keyboard and screen-reader behavior remains usable at narrow sizes.
- [ ] Affected Console documentation and visual captures reflect the delivered
  layouts.
