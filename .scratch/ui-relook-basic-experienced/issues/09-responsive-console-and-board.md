# Define responsive Console and Board behavior

Type: grilling
Status: resolved
Assignee: @McFuzzySquirrel
Blocked by: 08-kanban-and-gantt-parity.md

## Question

How should the adaptive Console and its Kanban/Gantt Board adapt across narrow, medium, and wide viewports—including project navigation, lane or timeline navigation, and task-detail presentation—while keeping the selected Task and filters usable?

## Comments

- Resolution: Use content-driven initial responsive ranges: wide above 1050px, medium from 721–1050px, and narrow at 720px or below; adjust only if the content requires it. Use the full navigation on wide screens, a compact rail on medium screens, and a labeled drawer/menu on narrow screens. Keep Home, Projects, the Project switcher, primary Project destinations, and Advanced destinations discoverable.
- Keep the selected Board view. On narrow screens, Kanban retains phase bands and status columns, scrolls horizontally across status columns, and keeps phase labels visible. Gantt keeps task labels visible while its timeline pans.
- Use a side panel for Task details on wider screens and a full-screen overlay on narrow screens. Closing details returns to the same selected Task and Board position.
- Current behavior is an implementation gap, not a new scope item: the Console currently uses horizontally scrollable navigation at its narrow breakpoint, and the production Board is an iframe-hosted PixiJS view. The approved responsive direction applies to the semantic HTML/CSS Board baseline.
