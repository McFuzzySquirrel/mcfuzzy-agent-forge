# Define state-aware project entry

Type: grilling
Status: resolved
Assignee: @McFuzzySquirrel
Blocked by: 01-guided-lifecycle.md

## Question

Which project states must the Console recognize, and what single next action should it present when a user opens a new, partially authored, running, blocked, failed, or completed project?

## Comments

- Resolution: use these Project states and primary actions:
  - **New**: Start with your idea.
  - **Partially authored**: Continue from the last saved authoring step.
  - **Needs your review**: Review the Project brief.
  - **Preparing**: View preparation progress; do not start the Build yet.
  - **Ready to start build**: Show the prepared-plan summary and offer **Start build**.
  - **Running**: View Build progress in Overview.
  - **Blocked**: Open the specific user action stopping the next meaningful step. If work can continue, retain its Preparing or Running state and surface the blocker.
  - **Failed**: Keep one top-level state, explain what failed, then offer recovery for that stage: retry authoring/preparation or resume/replay Build work.
  - **Completed**: Review Project files.
- Existing repositories map to their current Project state and open at its next meaningful action; they are not a separate lifecycle state.
- Current Console status mapping does not yet expose all of these distinctions. Treat that as an implementation gap, not a change to this planning map's scope.
