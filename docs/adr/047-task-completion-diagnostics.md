# ADR-047: Attempt Diagnostics and Retry Feedback

Status: Accepted

## Context

A banking scaffold task reported passing local checks but failed completion
because its `unresolved` list included optional hosted validation and changes
awaiting engine auto-commit. Retries received no rejection reason and earlier
attempt reports and gate outcomes were not retained. Contradictory model and
engine reports were therefore difficult to diagnose.

[ADR-044](044-structured-task-contracts.md) defines the result schema and
blocking-versus-nonblocking semantics. This decision makes the engine's actual
gate outcomes durable and useful to operators and subsequent attempts.

## Decision

Persist each settled invocation in an exclusively created, uniquely named
result archive using [ADR-046](046-task-execution-files.md)'s file lifecycle.
Retain the harness result, parsed report when valid, task/run/attempt identity,
timestamp, outcome and passed/failed/skipped gates for harness, outputs, handoff,
blocking requirements and validation. Preserve nonblocking caveats without
automatically reclassifying them or weakening completion gates.

Store lightweight archive links in task `attemptHistory`, emit
`task.attempt.finished`, and save before retrying. Cancellation and terminal
harness failures use the same recording path. Auto-commit remains after task
completion, not a prerequisite for passing the task's checks.

Pass the previous failure reason, bounded to 4000 characters, and its archive
path to the next request. Preserve completed work and task scope; prior model
output is evidence, not new authority. Retry audit events also link the prior
failure. Field/type/JSON/fence/size errors must identify the actual rejection
rather than reducing every invalid report to a generic missing-report error.

## Alternatives Considered

- Retrying with unchanged instructions hides the actionable rejection reason
  and can reproduce the same failure. Supply bounded diagnostic feedback.
- Keeping only the latest outcome loses evidence needed to explain retries.
  Retain immutable archives and keep lightweight links in workflow state.
- Copying full reports into every retry prompt bloats context and risks treating
  prior model output as instructions. Pass a bounded reason and evidence path.

## Consequences

Operators can distinguish harness success from task completion and inspect the
gate that rejected an attempt. Legacy reports and saved state remain readable.
The engine still depends on honest blocker classification and meaningful
authored validation commands; diagnostics cannot prove semantic acceptance.

Retained reports can be large and sensitive. ADR-046 defines their path
protections, attribution and auto-commit exclusions, retention and backup
policy. They are local diagnostics, not authenticated evidence. A hard crash
before recording completes may leave only the current input snapshot.

Updating source does not patch an installed target engine, rewrite contracts or
state, recover earlier reports, rerun checks or mark failed tasks complete.
Install updated templates through the normal workflow before retrying.

See [Task Contracts](../task-contracts.md#completion-and-retry-diagnostics).