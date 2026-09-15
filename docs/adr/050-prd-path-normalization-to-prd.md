# ADR-050: Normalize requirements ownership to docs/PRD.md

Status: Accepted

## Context

The canonical contract already requires `docs/PRD.md` with
`docs/features/*.md`, but active skills, templates, diagnostics, and docs still
mixed in `docs/PRD.md`. That mismatch caused conflicting guidance,
stale generated links, and ambiguous source selection when both files existed.

## Decision

Retire `docs/PRD.md` as an active requirements artifact.

`docs/PRD.md` is the only canonical product-level document. It owns product
vision, shared architecture, global constraints, and the feature index/dependency
table. Feature-specific requirements and executable tasks remain in
`docs/features/*.md`.

`docs/PRD.md` is now a legacy filename only:

- it may be preserved as historical source material,
- it is never an executable source for team generation, validation, or manifest
  compilation,
- when both files exist, tooling reads `docs/PRD.md` and emits a warning that the
  legacy file is ignored.

## Migration and precedence rules

- **`docs/PRD.md` + features exist:** canonical and executable.
- **Only `docs/PRD.md` (+/- features):** fail closed with migration
  guidance to move/copy the canonical PRD to `docs/PRD.md`; preserve
  the original file as historical material.
- **Both files exist:** `docs/PRD.md` is authoritative; no silent merge.
- **Neither file exists:** fail closed and direct users to author canonical
  requirements first.

Migration preserves accepted requirement meaning and completed task IDs; no Forge
command silently rewrites or deletes historical source files.

## Consequences

All active authoring/build flows, generated links, and diagnostics now align on
one source contract. Legacy repositories receive actionable migration guidance
instead of ambiguous behavior, and repositories already on the canonical layout
continue to work without requiring retired artifacts.
