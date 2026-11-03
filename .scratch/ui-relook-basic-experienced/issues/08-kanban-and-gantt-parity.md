# Define Kanban and Gantt parity

Type: grilling
Status: resolved
Assignee: @McFuzzySquirrel
Blocked by: 06-board-information-model.md

## Question

Which information and interactions must be shared between Kanban and Gantt, which are view-specific, and how should users switch, filter, select, and open task details without losing context?

## Comments

- Resolution: Both views share the same task summary and attention/action cues. Kanban emphasizes workflow state; Gantt adds timeline-specific information such as actual and forecast duration and the critical path.
- Selecting a card or bar opens the same compact in-Board detail panel with the task summary, blocker, and next action. **Open in Tasks** leads to full diagnostics.
- Preserve the selected Task and filters across both views and refresh, remember each view's pan/zoom position, and clear the selection only if the Task is no longer available.
