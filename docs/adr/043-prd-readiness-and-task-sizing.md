# ADR-043: PRD Readiness and Execution-Sized Tasks

Status: Accepted

## Context

An existing-project authoring run produced a large monolithic PRD despite the
mandatory decomposition threshold. Its prompt omitted the rule, the author
treated existing domain documents as an exemption, and the launcher accepted a
non-empty file as completion. Structured blocks still bundled roadmap increments
and contained invalid validation/output contracts. Schema preservation alone
did not ensure authoring readiness.

## Decision

Apply the same decomposition semantics to new and existing repositories.
Decomposition is part of authoring and proceeds automatically when authorized
headlessly. Require canonical vision/features output at the threshold.

Add a read-only validator alongside the execution adapter, reusing its contract
parser and feature dependency parser. Validate planned owners before team
generation; actual owner existence remains a compilation check. Validate active
feature task contracts rather than counting the preserved original PRD twice.
Incremental checks resolve external IDs from existing structured source tasks.

Run the bundled validator at launcher authoring completion and before reuse,
resume or team generation. Include decomposition documents in output fingerprints
and retain failed-state repair guidance. Ship the TypeScript loader with the
launcher so this gate needs neither generated agents nor target dependencies.

Require an authoring task/check table, concrete deliverables, tests for each
changed surface, actual dependency relationships and separate human gates.
Provide decomposition examples, but do not invent a universal task-count target
or split atomic safety guarantees mechanically.

## Consequences

Previously accepted but incomplete PRDs can now block advancement and require
explicit repair. Legacy checkbox inspection remains available; installation does
not migrate existing projects or reset completed work. Strict output filenames
and canonical feature tables make ambiguity visible before compilation.

Structural validation cannot prove task size, requirement coverage, meaningful
tests, nonzero test discovery or independent human judgment. Authors and reviewers
remain responsible for those checks. The validator never executes authored
commands, compiles a manifest or starts implementation.

See [Task Contracts](../task-contracts.md) for commands and verification limits.