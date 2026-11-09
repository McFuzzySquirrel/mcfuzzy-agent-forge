# Define the existing-Project transition

Type: grilling
Status: resolved
Assignee: @McFuzzySquirrel
Blocked by: 08-kanban-and-gantt-parity.md

## Question

How should existing Projects, bookmarked Console destinations, and previously saved Board preferences transition into the adaptive Console, including how to handle a saved destination or preference that no longer applies?

## Comments

- Resolution:
  - Existing Projects retain their lifecycle state and open at the next meaningful action. Project records and history are never silently removed; an unavailable Project remains visible in Projects with a recovery/reconnect action.
  - Keep aliases for existing destinations and preserve query parameters. Map routes by intent: `#/overview` to Build status, `#/board` to Board, `#/tasks` to Advanced full Tasks, `#/documents` to Advanced Plan & Team, and `#/artifacts` to Project files. Keep Logs, Timeline, Terminal, and Settings in their matching Advanced destinations; preserve the Projects bootstrap and New Project flows. New links may target the adaptive destinations directly.
  - Supported aliases stay in the address bar. If a destination is retired, canonicalize to the Project's next meaningful action with an explanation. If the Project is unavailable, canonicalize to Projects with its recovery action. Old bookmarks remain relative to the currently selected Project and never switch Projects implicitly.
  - If a Task or stage query target no longer exists, keep the mapped base destination open and show an unavailable-target notice.
  - Preserve valid Board mode and status filters when available during transition. The existing Console has no durable legacy mode/filter or viewport preference after reload, so otherwise start at Kanban with no filters and discard invalid values. Persist future per-Project preferences as already decided for the Board.
