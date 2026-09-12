# ADR-049: Human Review Evidence and Console Completion

Status: Accepted

## Context

Structured task contracts distinguish implementation from work that requires
human judgment. The workflow engine already paused `human-review` tasks and
accepted task-bound CLI attestations, but the user guide did not explain what
causes the pause or how an operator could demonstrate that review occurred.
The Console also needed a first-class completion path so operators did not have
to leave the browser for every review.

## Decision

Keep human review as an explicit `contract.kind: "human-review"` task. Such a
task has requirements, acceptance criteria, constraints, references, explicit
dependencies, and a configured `contract.reviewFile`; it has no model owner or
autonomous implementation outputs. The engine must not dispatch it to a model,
and `--yes` must not approve it.

Support two equivalent operator paths:

- The Console collects reviewer identity, findings, and an explicit approval
  attestation. It writes a repository-local Markdown review record, hashes that
  record as evidence, writes the configured JSON approval record, and resumes
  the build through the normal controller.
- The workflow-engine CLI requires `approve-task`, a repository-relative
  non-empty evidence file, reviewer identity, and the explicit
  `--confirm-human-review` flag. The operator then resumes the engine normally.

Approval remains task-bound. Verification requires the task ID, current task
and selected-reference digest, approval decision, reviewer and timestamp, and
matching SHA-256 hashes for all evidence files. Any change to the reviewed task,
selected references, or evidence invalidates the approval and requires a new
review. Attestations are local evidence, not authenticated identity or
authorization.

## Alternatives Considered

- Letting `--yes` or an agent approve the task would turn human judgment into
  autonomous output and weaken the safety boundary.
- Requiring only a free-form note would not bind approval to the exact task and
  reviewed references. Keep the content-bound local attestation.
- Making the Console action separate from the canonical engine verifier would
  create two approval semantics. Have both paths write evidence consumed by the
  same verification logic.

## Consequences

Operators can complete a review without leaving the Console or can use the CLI
in headless environments, and both paths leave inspectable repository-local
proof. Stale approvals fail closed when reviewed inputs change. The records are
not a remote trust system: local users can edit files, and generated review
records should be handled according to the repository's retention and privacy
policy.

See [Structured Task Execution and Completion Contracts](044-structured-task-contracts.md)
and [Task Contracts](../task-contracts.md).
