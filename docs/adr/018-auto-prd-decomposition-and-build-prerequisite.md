# ADR-018: Automatic PRD Decomposition and PRD-Prerequisite Build Execution

**Date:** 2026-08-24
**Status:** Accepted

---

## Context

MyForge had several points where the user is asked to make decisions that are either mechanically derivable from project artifacts, or that let the build pipeline proceed without sufficient PRD review:

1. **PRD decomposition was unnecessarily opt-in.** ADR-002 introduced `forge-decompose-prd` as an opt-in, manually invoked skill. A user had to recognize that their PRD was large and separately run it after `forge-build-prd` completed. The qualifying criteria are objective (15+ functional requirements, or 3+ implementation phases) and calculable directly from the PRD, and decomposition is non-destructive -`docs/PRD.md` is preserved and `docs/product-vision.md` + `docs/features/*.md` are generated alongside it. Asking the user to confirm a mechanical threshold added friction without meaningful safety.

2. **`forge-auto-build` could bypass meaningful PRD review.** It chained PRD generation, team generation, optional model assignment, and build execution behind a single pre-flight confirmation. A user could type "GO" once and receive a fully built project from a thin, unreviewed PRD. Its flat stage structure also made the required starting state unclear -whether it needed an existing PRD or created one itself.

(Note: the change request for this ADR referenced an "ADR-018" pause inside `forge-auto-build` asking whether to decompose a qualifying PRD. That pause never landed in this repository's templates; this ADR instead records the automatic-decomposition design described below.)

---

## Decision

### 1. PRD decomposition becomes automatic

`forge-build-prd` gains a new closing step -**Step 5: Check Decomposition Criteria** - that runs immediately after the user confirms the PRD and it is saved to `docs/PRD.md`:

- Evaluate the existing criteria: **15+ functional requirements, or 3+ implementation phases.**
- If the PRD qualifies, automatically invoke `forge-decompose-prd`.
- If it does not qualify, retain the monolithic `docs/PRD.md` and report that decomposition was not required.
- Do **not** ask the user whether they want decomposition when the objective criteria are met.

`forge-decompose-prd` remains independently invokable for older PRDs, PRDs modified after generation, or documents the user explicitly wants to decompose below the automatic threshold.

### 2. `forge-bootstrap-project` is retired

`forge-bootstrap-project` is removed. Its useful behavior is not lost:

- Its **idea-confirmation pattern** is reused by the new `forge-auto-build-prd` skill.
- Its **PRD review checklist** is reused as part of the PRD-generation flow (`forge-build-prd` Step 4).

Team generation remains owned by `forge-build-agent-team`, whether invoked directly or as part of `forge-auto-build`.

### 3. New `forge-auto-build-prd` skill

A PRD-creation fast-path meta-skill: it confirms a project idea, invokes `forge-build-prd` (interview, review with checklist, save, automatic decomposition), verifies the outputs, and stops before team generation. It gives the launcher and users a deterministic entry point for "idea → reviewed PRD" without manufacturing a team or a build.

### 4. `forge-auto-build` requires an existing PRD

`forge-auto-build` no longer generates a PRD. Its pre-flight check must find one of:

- `docs/PRD.md`, or
- `docs/product-vision.md` together with `docs/features/*.md`.

If neither exists, it stops immediately and directs the user to run `forge-auto-build-prd` or `forge-build-prd`. It does **not** fall back to interviewing the user for a one-line idea. Its stages are reduced to:

1. `forge-build-agent-team`
2. `forge-assign-models` (optional)
3. Build execution -`forge-orchestrate-build` or `forge-workflow-engine`

### 5. Downstream references updated

README, prompt playbook, forge-launcher docs, and both launcher implementations reflect the new lifecycle. The launcher queues `forge-auto-build` when a PRD was captured in Step 6, or `forge-auto-build-prd` when it was not. `detect-harness.md` moved from `forge-bootstrap-project/references/` to `forge-build-agent-team/references/` and all referencing skills were updated.

### Resulting lifecycle

```
Idea → PRD creation/review (forge-auto-build-prd / forge-build-prd)
     → automatic decomposition check → agent team (forge-build-agent-team)
     → optional model assignment (forge-assign-models)
     → build execution (forge-orchestrate-build | forge-workflow-engine)
```

Artifact creation and validation are separated from execution: the PRD is an explicit quality gate, not an implicit side effect of the build pipeline.

---

## Rationale

Two complementary principles:

- **Automate deterministic decisions.** If a decision can be calculated objectively from an artifact and the operation is non-destructive, MyForge should perform it automatically rather than asking the user to confirm the calculation. PRD decomposition is the canonical example.
- **Require deliberate human ownership of high-leverage artifacts.** If an artifact defines what will be built, the user should explicitly enter the execution pipeline with that artifact available for review. The PRD is therefore a quality gate, not merely an intermediate file.

Together these reduce unnecessary interaction while increasing the quality and predictability of autonomous builds.

---

## Consequences

### Positive

- Qualifying PRDs are decomposed automatically; no redundant opt-in decision.
- `forge-auto-build` is conceptually cleaner -an execution fast-path, not a requirements-generation fast-path.
- The PRD review gate survives and is strengthened (checklist now part of `forge-build-prd`).
- Existing downstream consumers continue to support both monolithic and decomposed PRD layouts unchanged.

### Negative

- Users who want an interactive decomposition decision for qualifying PRDs lose that option (they can still edit the PRD or re-run `forge-decompose-prd` manually).
- Users must now create a PRD before running `forge-auto-build`; there is no implicit PRD generation inside the build pipeline.
- `forge-auto-build` no longer supports the one-line-idea invocation; `forge-auto-build-prd` / `forge-build-prd` are the entry points for that.

### Neutral

- `forge-decompose-prd` is unchanged and remains independently invokable.
- `detect-harness.md` moved to a surviving skill; its content is unchanged.
- Historical ADRs and narrative docs that reference `forge-bootstrap-project` are left as records of their time.

---

## References

- Change Request: [CR-001](../cr-001.md)
- ADR-002: PRD Decomposition into Features - establishes the qualifying criteria this ADR makes automatic.
- ADR-009: Full Auto Build Meta-Skill - the `forge-auto-build` behavior superseded by decision 4.
- ADR-013: Auto-detect input source in `forge-auto-build` - the no-source/idea-interview behavior superseded by decision 4.
- Skill: [forge-build-prd](../../templates/skills/forge-build-prd/SKILL.md)
- Skill: [forge-auto-build-prd](../../templates/skills/forge-auto-build-prd/SKILL.md)
- Skill: [forge-auto-build](../../templates/skills/forge-auto-build/SKILL.md)
- Skill: [forge-build-agent-team](../../templates/skills/forge-build-agent-team/SKILL.md)
- Scripts: [forge-launcher.sh](../../scripts/forge-launcher.sh), [forge-launcher.ps1](../../scripts/forge-launcher.ps1)
