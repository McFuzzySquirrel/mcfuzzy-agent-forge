# Canonical Requirements Layout

Every solution uses `docs/PRD.md` and at least one
`docs/features/*.md`. Author these directly, including for a one-task solution.
There is no intermediate or executable monolithic requirements document.

Load the sibling `forge-decompose-prd/references/product-vision-template.md`
for the vision structure and `feature-document-template.md` for feature structure.
Load `task-contract.md` for canonical definitions and compact executable tasks.

## Ownership

- Vision: overview, goals/non-goals, personas, shared architecture and stack,
  security/accessibility/performance constraints, cross-feature stories,
  success metrics, dependencies, risks, glossary and open questions.
- Feature: feature-specific stories and requirements, UI behavior, implementation
  phases, bounded tasks, tests and feature acceptance criteria.
- Vision feature table: every feature file, exact dependency names and priority.
- Traceability: canonical IDs and links only, with one owner and participating
  features. Never repeat requirement prose in a traceability or summary table.
- Each task: one canonical feature location, stable ID, explicit dependencies,
  acceptance checks, owner, outputs and validation commands.

Write each requirement or shared constraint once in a `forge-requirement` block.
Use version-2 contracts with `requirementRefs` and `constraintRefs` to reuse it.
Task-specific acceptance criteria and limits remain explicit in the task.

## Review

Review scope, current technology versions, security/privacy, accessibility,
performance, feature coverage, task sizing, meaningful tests and human gates.
Record assumptions rather than inventing approvals or passing test results.
Run `validate-prd` before reporting completion. Resolve all errors and review
duplication warnings. A vision without executable features is not complete.

## Existing Sources

Read supplied requirements, research and code before authoring. Preserve their
accepted meaning and stable completed task IDs. Historical source documents stay
unchanged and are not execution inputs. Use `forge-decompose-prd` for conversion;
do not maintain a second editable task catalogue after conversion.
