# 06: Make the Board semantic and consistent across views

**What to build:** Users can monitor a Project and decide what needs attention
next in either Kanban or Gantt, with the same Task information and reliable
access to Task details.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Kanban foregrounds workflow state; Gantt adds timeline information such
  as actual and forecast duration and the critical path.
- [ ] Both views share Task summaries, responsibility, failure and attention
  cues, and the next action.
- [ ] Selecting a card or bar opens the same compact Board details with the
  Task summary, blocker, and next action; full diagnostics remain available in
  Tasks.
- [ ] Task selection and filters survive view switching and refresh, and each
  view retains its own Board position.
- [ ] The core Board experience uses semantic HTML/CSS and does not require
  PixiJS; visual enhancement remains optional.
- [ ] The Board exposes meaningful empty, loading, failure, and stale-data
  states with an appropriate next action.
- [ ] Affected Console documentation and visual captures reflect the delivered
  Board.
