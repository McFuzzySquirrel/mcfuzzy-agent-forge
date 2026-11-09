# Define the shared Board information model

Type: grilling
Status: resolved
Assignee: @McFuzzySquirrel
Blocked by: 01-guided-lifecycle.md

## Question

What must the Board show and prioritize so it supports both live status monitoring and decisions about blockers, dependencies, ownership, and the next action, consistently across Kanban and Gantt?

## Comments

- Resolution: Use an attention-first Board. Put Human reviews waiting and user-actionable blockers first, failed work with its recovery action next, and ready work in a separate group; keep routine running/completed work and overall Build progress visible as the monitoring layer. Use a shared task-summary contract across Kanban and Gantt: title, human-readable status, phase, next responsible participant, and one next-action or blocker cue. Distinguish the person or agent expected to act next from the task's assigned agent. For blocked work, identify the immediate unmet prerequisite and explain the blocker in plain language; keep the full dependency/artifact graph and detailed errors, timing, timeout, model, attempts, token usage, inputs/outputs, and validations in task detail.
