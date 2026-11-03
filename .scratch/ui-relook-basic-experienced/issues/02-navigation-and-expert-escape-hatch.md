# Shape goal-oriented navigation and the expert escape hatch

Type: grilling
Status: resolved
Blocked by: 01-guided-lifecycle.md

## Question

How should the Console organize beginner-oriented navigation while keeping Overview, Plan & Team, Tasks, Logs, Timeline, Artifacts, Terminal, and Settings discoverable for experienced developers?

## Answer

- Keep global **Home** and **Projects** separate from current-project navigation; keep the project switcher available while a project is open.
- Make **Build status**, **Board**, **Project brief**, **Project files**, and **Tasks** direct current-project destinations. Board remains first-class for beginners and experienced users.
- Basic **Tasks** opens on a focused **Needs your review** queue of human-review items, including blocked reviews and why they are waiting. Human-review criteria, reviewer/evidence requirements, and explicit attestation apply equally to everyone. The full agent-task table and technical controls remain under **Advanced**.
- **Project files** presents useful deliverables; detailed per-task artifact provenance stays under **Advanced**.
- **Advanced** is a visible shared navigation group, not a separate mode. It contains the full Tasks view, Logs, Timeline, Terminal, Plan & Team, and Settings.
