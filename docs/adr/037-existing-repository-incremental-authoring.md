# ADR-037: Existing-repository incremental authoring

## Status

Accepted

## Decision

MyForge authoring treats an existing repository as its context even when it has
no `IDEA.md`. Feature increments are additive: a Feature PRD is authored under
`docs/features/`, Feature Increment Mode updates only affected team members,
and the canonical manifest is recompiled before an optional engine run.

Manifest reconciliation preserves stable task records, reports new, removed,
and changed task IDs, and keeps authoring lifecycle output in the repository
engine log. Workflow audit events remain owned by the workflow engine.

## Consequences

Existing applications can enter the PRD pipeline without creating a synthetic
idea document. Monolithic PRDs can accept additive feature documents before a
formal decomposition. Recompilation is safe for completed work, but changed
task contracts are explicitly surfaced for review.
