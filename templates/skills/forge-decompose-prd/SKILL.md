---
name: forge-decompose-prd
description: "Convert supplied legacy requirements or specifications into the mandatory product vision and canonical feature layout. Use when importing an older PRD or reorganizing source documents into executable features."
---

# Convert Source Requirements to Canonical Features

Every solution uses `docs/PRD.md` and one or more
`docs/features/*.md`. This skill converts existing source material; new solutions
are authored directly by `forge-build-prd`. There is no size threshold or
monolithic execution mode. A small solution has one feature.

## Step 1: Inspect the Source

Read the supplied document or `docs/requirements-source.md`. A historical
`docs/PRD.md` or specification may be input to conversion, never an active build
source. Preserve original documents unchanged. Inspect existing canonical files,
task IDs, completion state and human-review evidence before proposing changes.

## Step 2: Assign Ownership

Identify shared concerns for the vision and bounded implementable features.
Load `references/product-vision-template.md`, `references/feature-document-template.md`
and the sibling `forge-build-prd/references/task-contract.md`.

Give every definition a globally unique canonical ID and one owner. Preserve
existing IDs instead of re-IDing requirements merely to match a feature prefix.
Shared stories belong in the vision with participating feature references.
Traceability tables contain IDs, links and relationships, not copied prose.

Present feature names, source-ID coverage and the dependency DAG. Interactive
conversion requires approval; authorized headless conversion records assumptions
and proceeds without another opt-in. Never renumber completed work. If existing
completed work needs changed IDs or boundaries, report the required migration.

## Step 3: Write Canonical Documents

Write shared definitions, architecture and constraints in the vision; write
feature-specific definitions and tasks only in their owning feature. Use
`forge-requirement` definitions and version-2 task contracts with canonical
references. Keep task-specific acceptance criteria, scope limits, planned owners,
outputs, tests and human gates intact. Split independently testable outcomes,
preserving parent-to-child traceability, not a duplicate full task catalogue.

The vision feature table lists every emitted file and exact dependency names.
Feature dependencies must form a DAG. Do not copy shared text into each feature
or whole task contracts into traceability/review tables. Historical originals
remain unchanged and are excluded from compilation and authoring outputs.

## Step 4: Validate and Hand Off

Run the adapter's read-only `validate-prd` gate without `--allow-legacy`.
Require complete source requirement coverage, resolved IDs, one canonical owner,
valid contracts, unique task bodies, meaningful checks, and valid dependency
wiring. Review prose-duplication warnings. Missing files or valid JSON alone do
not complete conversion. Repair errors and rerun the gate.

Report canonical files, source-to-canonical ID mapping, validation results and
any required completed-work migration. Next is team generation, not automatic
implementation. Do not delete history, generate agents, or start execution.
