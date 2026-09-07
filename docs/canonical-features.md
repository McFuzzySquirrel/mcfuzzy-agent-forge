# Canonical Features

Every Forge solution has `docs/PRD.md` plus one or more
`docs/features/*.md`. A small solution has one feature, not a different layout.
Existing command names such as `draft-prd` and `validate-prd` remain available,
but they author and validate this feature-based requirements set.

## Ownership and Reuse

The vision owns shared architecture, constraints and cross-feature stories.
Each feature owns its specific requirements and executable tasks. The vision's
feature table lists every feature and exact dependency names. Traceability lists
IDs, canonical links and ownership/participation, never duplicate descriptions.

Define each rule once in a fenced `forge-requirement` JSON block with `id`,
`kind` (`requirement`, `constraint`, or `story`) and `text`. IDs are globally
unique. Contract version 2 adds `requirementRefs` and `constraintRefs`, using
`docs/features/example.md#FR-1` selectors. Keep task-specific `requirements`,
`constraints`, `acceptanceCriteria`, references, outputs and checks explicit.
All arrays are required; empty local requirements/constraints are valid.

Compilation resolves IDs into complete version-1 execution contracts. Missing
IDs or wrong definition kinds fail closed. Existing version-1 contracts remain
supported in feature documents. Generated manifests are execution snapshots,
not another editable source of requirements.

## Validation and Context

`validate-prd` checks the full feature graph, including when selecting newly
added features. Canonical ownership, requirement coverage, duplicate active task
bodies, contracts, references and dependency wiring are deterministic gates.
Repeated substantive prose is a warning, not proof of semantic equivalence.
Reviewers still assess task quality, source coverage and meaningful tests.

References accept a canonical ID or exact heading after `#`; inferred URL slugs
are not supported. Selected content is deduplicated for inline text contexts.
Repository agents receive paths/selectors and read on demand. Sources remain
limited to 128 KiB each and resolved context to 256 KiB, with repository traversal
and escaping symlinks forbidden. Human review hashes selected content, so edits
to relevant rules invalidate approval without invalidating unrelated sections.

## Migration

1. Update Forge templates/tooling in the target repository deliberately.
2. Run `forge-decompose-prd` on supplied legacy requirements, preserving the
   originals as historical source material. New projects use `forge-build-prd`
   directly. Imported launcher documents use `docs/requirements-source.md`.
3. Preserve accepted meanings and completed task IDs. Move tasks into owning
   features and register every feature in the vision. Do not duplicate catalogues.
4. Run `validate-prd`, review ownership/coverage and resolve errors and warnings.
5. Regenerate the affected team/skills as needed and recompile the manifest.
   Review reconciliation and any changed completed work before resuming.

Old or untagged manifests cannot execute until recompiled with
`sourceLayout: "features"`. Do not manually relabel a stale manifest to bypass
conversion. No migration command deletes history or automatically edits other
repositories. Historical ADRs and changelog entries describe retired behavior.