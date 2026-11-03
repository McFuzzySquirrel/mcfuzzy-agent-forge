# Define Console redesign validation criteria

Type: grilling
Status: resolved
Assignee: @McFuzzySquirrel
Blocked by: 08-kanban-and-gantt-parity.md

## Question

Which representative user tasks and observable success criteria should validate that the guided default path works for basic users while experienced developers can still reach and use the detailed execution surfaces?

## Comments

- Resolution: Validate with a compact, scenario-based suite using separate Basic and Experienced participant cohorts.
  - **Basic cohort:** Users unfamiliar with Forge's detailed execution surfaces; they may still be technically experienced.
  - **Experienced cohort:** Developers comfortable with AI coding tools and technical execution controls.
  - **Basic scenarios:** Create a Project from an Idea, author/edit the Project brief, request changes and revise, approve it, observe preparation, explicitly start the Build, and confirm Running. Resume a partially authored Project at its saved step. Open a returning Project and follow the correct next action, including a blocked or failed stage. Use **Add a feature** and review the generated Tasks before they run.
  - **Experienced scenarios:** Reach full Tasks and inspect Task details/diagnostics; navigate to Logs, Timeline, Terminal, Plan & Team, and Settings; change a detailed control and understand its effective behavior before Build start. Keep the selected Project context and do not force a detour through the Basic path.
  - **Cross-cutting checks:** Verify narrow-screen navigation and Task details; keyboard Task selection and focus restoration; accessible relationship text and significant state announcements.
  - **Pass bar:** Any critical lifecycle, Project-context, or accessibility failure blocks acceptance. In each cohort, at least 4 of 5 representative users must complete each applicable scenario without facilitator help; no arbitrary time limit applies.
