# Define the Board accessibility contract

Type: grilling
Status: resolved
Assignee: @McFuzzySquirrel
Blocked by: 08-kanban-and-gantt-parity.md

## Question

What keyboard and screen-reader behavior must the shared Board controls, Kanban cards, Gantt bars, and task-detail panel support, including focus restoration when switching views or selecting a Task, beyond the already-decided semantic HTML baseline?

## Comments

- Resolution: Every Task in Kanban and Gantt has an equivalent semantic DOM control operable with standard keyboard focus and Enter/Space; visual cards, bars, and relationship lines are never the only interaction path.
- Selecting a Task opens the shared details and moves focus into them. Closing details restores focus to the originating Task control. Switching views retains logical focus on the same Task when available; filter and view rerenders retain focus on the activated toolbar control and preserve Task selection and Board position.
- Keep dependency and artifact relationship lines out of the focus order and expose those relationships as structured text in Task details.
- Announce significant state/action changes (for example, failure, Human review readiness, or a cleared blocker) and the selected Task without announcing every routine progress update or animation.
- Current behavior is an implementation gap, not a change to scope: production PixiJS cards and Gantt bars are not keyboard focusable, its table fallback is not interactive and has an ineffective focus target, and current rerenders do not restore focus. The semantic prototype has Task buttons and a labelled detail panel but also needs the agreed focus preservation and announcement behavior.
