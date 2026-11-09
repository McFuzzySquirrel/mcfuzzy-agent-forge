# Design the requirements review checkpoint

Type: prototype
Status: resolved
Assignee: @McFuzzySquirrel
Blocked by: 01-guided-lifecycle.md

## Question

What should the staged requirements-authoring and review interaction look like so a basic user can understand, edit, approve, or revise the plan before automation continues?

## Prototype

[Compare three Project brief review layouts](../../../scripts/forge-launcher/scripts/console/dashboard/views/requirements-review-prototype.ts) in the running Console at `#/new?prototype=1&variant=guided`. Use the bottom switcher or `?variant=workspace` / `?variant=review` to compare; all actions are mock-only. The variants are captured on local branch `prototype/requirements-review-checkpoint` at `bffb8ca` (not pushed).

## Comments

- Resolution: use the Guided steps layout with an editable Project brief and persistent at-a-glance summary. Place Human review in its own panel below the brief in normal page flow, with Request changes and Approve actions. Approval remains separate from starting the build.
- The user selected Guided steps, requested that Human review sit outside and below the brief, and confirmed normal page flow rather than a pinned panel.
