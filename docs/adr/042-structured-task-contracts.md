# ADR-042: Structured Task Contracts

Status: Accepted

## Context

Task bullets were treated as executable specifications, while ownership,
outputs and commands were inferred from prose. Requirements and acceptance
criteria were lost, human activities became model tasks, and synthesized
handoffs described intentions rather than verified outcomes.

## Decision

Use versioned `forge-task` JSON blocks inside existing planning documents.
Preserve explicit specialist ownership, requirements, acceptance criteria,
constraints, input references, output paths, dependencies and validation commands
through the manifest. Structured tasks bypass text splitting and owner scoring.
The runtime includes bounded local reference contents, requires command success
and a structured `forge-result`, and projects dependency outcome artifacts.
Human-review tasks pause until task-bound operator evidence is attested, never
dispatching to a model. Attestations are local audit records, not authenticated
authorization. Legacy plans remain supported with migration warnings.

## Consequences

Planning authors must make task boundaries and test evidence explicit. Team
generation must create the planned specialist names and review suitability.
Structured contracts add mandatory validation cost and can stop unattended runs
at genuine human gates. The compiler enforces structure, not semantic test
quality. References and evidence are bounded local files; larger documents must
be scoped deliberately. Existing completed implementation state requires explicit
review/reset after migration. Runtime changes do not retrofit target projects.

See [Task Contracts](../task-contracts.md) for schema examples, migration,
verification limits, and operator commands.