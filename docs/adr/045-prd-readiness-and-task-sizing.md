# ADR-045: Canonical Feature Authoring, Readiness and Task Sizing

Status: Accepted

## Context

An existing-project authoring run produced a large monolithic PRD despite the
mandatory decomposition threshold. Its prompt omitted the rule, the author
treated existing domain documents as an exemption, and the launcher accepted a
non-empty file as completion. Structured blocks still bundled roadmap increments
and contained invalid validation/output contracts. Schema preservation alone
did not ensure authoring readiness.

Generating a complete PRD and then copying it into vision/features also produced
duplicate task catalogues, repeated traceability prose and broad references.
Size-based layout selection left two authoring and execution paths to maintain.

## Decision

Every solution, new or existing, uses a product vision and at least one canonical
feature. New authoring writes that layout directly, including for one-feature
projects. Legacy documents remain historical source material and require
conversion; they do not supply executable tasks or validation commands.

Canonical definitions have globally unique IDs and one owning location.
Version-2 authoring contracts reference requirements and constraints and resolve
into complete version-1 execution contracts under
[ADR-044](044-structured-task-contracts.md). Traceability uses IDs and links,
not copied definitions. Validation must reject duplicate definitions, uncovered
canonical requirements and duplicate active task bodies, and warn on repeated
substantive prose.

References support exact headings and canonical IDs. Inline content is
deduplicated; repository agents retain on-demand reading under
[ADR-046](046-task-execution-files.md). Path and byte limits remain in force.
Human-review digests bind selected content rather than unrelated sections.

Add a read-only validator alongside the execution adapter, reusing its contract
parser and feature dependency parser. Validate planned owners before team
generation; actual owner existence remains a compilation check. Validate active
feature task contracts rather than counting the preserved original PRD twice.
Check concrete deliverables, reference existence and limits, unique IDs,
dependencies, cycles and empty phases. Incremental checks resolve prerequisite
IDs and check canonical ownership and coverage across existing feature documents
as well as new ones.

Run the bundled validator at launcher authoring completion and before reuse,
resume or team generation. Include canonical output documents in fingerprints
and retain failed-state repair guidance. Ship the TypeScript loader with the
launcher so this gate needs neither generated agents nor target dependencies.

Require bounded, independently testable work, an ID-based task/check review
table, tests for each touched surface, actual dependency relationships and
separate human gates. Preserve atomic safety invariants together. Do not invent
a universal task-count target or split tasks mechanically to meet one.

## Alternatives Considered

- Threshold-based decomposition (15+ requirements or 3+ phases) retains an
	ambiguous small-project exemption and duplicate compiler paths. Require the
	same canonical layout for every solution instead.
- Drafting a complete monolithic PRD before decomposition duplicates definitions
	and tasks. Author features directly; reserve conversion for legacy inputs.
- Accepting non-empty outputs or relying only on prompts cannot establish
	structural readiness. Use deterministic checks without claiming semantic proof.

## Consequences

The monolithic compiler and threshold-based authoring policy are retired.
This supersedes the layout choices in
[ADR-018](018-auto-prd-decomposition-and-build-prerequisite.md) and
[ADR-024](024-feature-based-compilation-and-responsibility-matrix.md), preserving
their prerequisite-review, feature-compilation and responsibility-matrix goals.
[ADR-022](022-task-granularity-and-configurable-timeout.md)'s heuristic splitting
remains legacy-only; structured task boundaries are authored explicitly.

Old manifest layout metadata requires recompilation. Stable command names,
version-1 feature contracts and legacy checkbox inspection remain supported.
Historical originals are preserved, not rewritten. Migration preserves accepted
meanings and completed task IDs and requires review of reconciliation before
changed completed work runs again. Installation does not migrate target projects
or reset completed work.

Previously accepted but incomplete PRDs can now block advancement and require
explicit repair. Strict output filenames and canonical feature tables make
ambiguity visible before compilation.

Structural validation cannot prove task size, semantic source-to-feature
coverage, meaningful tests, nonzero test discovery or independent human judgment.
Authors and reviewers remain responsible. The validator never executes authored
commands, compiles a manifest or starts implementation.

See [Canonical Features](../canonical-features.md) and
[Task Contracts](../task-contracts.md) for migration and verification limits.