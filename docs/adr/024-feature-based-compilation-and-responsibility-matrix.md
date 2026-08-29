# ADR-024: Feature-Based Compilation, Team Validation, and the Responsibility Matrix

**Date:** 2026-08-26
**Status:** Accepted
**Relates to:** ADR-011 (execution adapter), ADR-014 (workflow engine)

---

## Context

The workflow-engine build path (`forge-auto-build` Path B) is:

```
forge-execution-adapter compile → docs/EXECUTION-MANIFEST.json → forge-workflow-engine run
```

When the engine path was introduced it compiled the manifest **only** from the
monolithic `docs/PRD.md` - `forge-execution-adapter` read a single `prdPath`,
parsed `## Phase N` headings, and assigned owners by token overlap. Repos that
had been decomposed into `docs/product-vision.md` + `docs/features/*.md` (the
recommended flow since CR-001 / ADR-018) therefore lost their features: the
adapter emitted an explicit *"Feature/decomposition mode is not compiled by
this MVP"* warning and compiled the monolithic PRD instead.

The prompt-driven path (`forge-auto-build` Path A → `forge-orchestrate-build`)
had no such gap. It builds from the decomposed layout (`forge-orchestrate-build`
Step 1c reads the vision + all feature docs, orders by the feature dependency
graph), validates the team (`forge-build-agent-team` Step 7: no duplicate
file/responsibility ownership, every requirement mapped to exactly one agent),
and produces `docs/agent-responsibility-matrix.md`. None of those steps existed
on the workflow-engine path: no feature input, no team-validation gate, no
responsibility-matrix artifact.

The result was that the two build paths diverged in what they built and how they
checked it, with the autonomous path being the weaker one.

---

## Decision

1. **`forge-execution-adapter compile` auto-detects the PRD representation.**
   - Monolithic `docs/PRD.md` → compile `## Phase N` headings exactly as before
     (byte-for-byte backward compatible).
   - Decomposed `docs/product-vision.md` + `docs/features/*.md` → parse the
     vision's `## 14. Features` dependency table, topologically order features
     (dependencies first), and compile each feature's
     `## 5. Implementation Tasks` / `### Phase N:` blocks into manifest phases.
     A missing table or a dependency cycle falls back to document order with a
     warning. A feature with no phase headings gets a single phase synthesized
     from its `## 3. Functional Requirements` bullets (warned).
2. **Phase ids are feature-tagged** (e.g. `BUDGETS-2`). Task labels in feature
   docs repeat across features ("Task 1.1"), so a label is only honored when it
   belongs to the phase (monolithic behavior unchanged); feature-mode tasks are
   auto-numbered under the feature-tagged phase id - keeping task ids globally
   unique for the engine's `state.tasks` map.
3. **A deterministic team-validation gate always runs at `compile`.**
   Unassigned tasks, output files owned by more than one agent, and orphan
   agents (generated agents owning no task) are detected and surfaced as
   manifest warnings. This mirrors the *guarantees* of `forge-build-agent-team`
   Step 7 without requiring an LLM call.
4. **`docs/agent-responsibility-matrix.md` is always generated at `compile`** -
   validation results, an agent × phase × task × outputs ownership table, and
   the phase execution order. Its path is recorded on the manifest
   (`responsibilityMatrixPath`) and printed in the engine's pre-run summary.

The prompt-driven path is unchanged; it remains the richer interactive flow.

---

## Consequences

- **The workflow-engine path now builds from the features** in dependency order,
  restoring parity with `forge-orchestrate-build` Step 1c.
- The **responsibility matrix artifact and team-validation gate exist on both
  build paths**; on the engine path they are deterministic and reproducible.
- Monolithic repos are unaffected: same input, same manifest (modulo the new
  informational `sourceLayout`/`responsibilityMatrixPath` fields).
- The deterministic validation cannot match the semantic depth of an LLM team
  review (it cannot, e.g., judge whether a requirement is *covered*). It is a
  gate for mechanical defects, not a replacement for reviewing the matrix.

---

## Alternatives considered

- **Compile both the monolithic PRD and the features.** Rejected: double-builds
  the same work (the vision/features are derived from the PRD) and confuses the
  execution plan.
- **A separate `--validate-team` subcommand.** Rejected in favour of always-on
  checks (per user choice) so the gate can never be forgotten.
- **Keep ownership purely token-based.** Rejected: without the validation gate
  the manifest can silently ship duplicate/overlapping file ownership.
