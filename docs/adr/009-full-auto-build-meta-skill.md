# ADR-009: Full Auto Build Meta-Skill via `forge-auto-build`

**Date:** 2026-08-03
**Status:** Accepted

---

## Context

Agent Forge's pipeline is a fixed sequence of well-defined stages:

1. `forge-build-prd` — produce `docs/PRD.md`
2. `forge-build-agent-team` — generate the specialist agent team
3. *(optional)* `forge-assign-models` — assign per-agent models
4. *(optional)* `forge-build-agent-framework-solution` — scaffold the solution (removed in ADR-008; noted here for completeness of the pipeline description)
5. `forge-orchestrate-build` — execute all build phases, phase by phase

ADR-004 addressed the gap between steps 1–3 by introducing `forge-bootstrap-project`, which chains PRD generation and team building with mandatory human review gates between them. The build execution (step 5) was deliberately left outside that skill because phase-by-phase review was the recommended default.

Two gaps remain:

### Gap 1: The bootstrap-to-build hand-off is still manual

After `forge-bootstrap-project` completes, the user must separately invoke `@project-orchestrator` to start the build, and must type an approval at each phase boundary. For projects with a clear, well-understood scope this overhead adds no value — it only slows down users who already know what they want to build.

### Gap 2: No per-phase validation and commit contract

`forge-orchestrate-build` specifies that a commit should happen after each phase, but there is no skill that *enforces* this. The orchestrator prompts the user to commit, but it is easy to skip. Similarly, there is no single place where build/lint/test validation is required to pass before the commit is made. The result is that the post-build commit history varies widely across projects.

### Why `forge-bootstrap-project` alone cannot close these gaps

`forge-bootstrap-project`'s design principle is that mandatory pauses are **never** skipped. Adding build execution to it would require either:

- Removing the PRD and team-review pauses (unacceptable — see ADR-004), or
- Adding a third, fourth, and Nth pause for each build phase, which defeats the purpose of a "fast path."

Extending it is therefore the wrong approach. A separate skill with a different contract is needed.

---

## Decision

We introduce a new **`forge-auto-build` meta-skill** that chains the entire pipeline from a one-liner idea (or an existing PRD) to a fully built, validated, and committed project, with **a single pre-flight confirmation gate** followed by **fully autonomous execution**.

### 1. Single Gate, Then Autonomous

Unlike `forge-bootstrap-project`, which pauses after every major artifact, `forge-auto-build` presents exactly **one** mandatory gate — the pre-flight confirmation — and runs autonomously after the user types `GO`. This makes the skill appropriate for users with a clear scope who want to delegate the entire pipeline.

The pre-flight gate shows:
- A restatement of the input and any repo-state warnings (existing PRD, existing agents, detected mode).
- The planned stages and the commit strategy that will be used.
- A verbatim pre-flight checklist covering input correctness, scope, and expectations.

The user may not proceed to any stage without explicitly typing `GO` (or a clear equivalent). This single gate is the only mandatory pause in the entire flow.

### 2. Stage Sequence

| Stage | Skill / Agent invoked | Skipped when |
|---|---|---|
| 1 | `forge-build-prd` | `docs/PRD.md` already exists |
| 2 | `forge-build-agent-team` | — (always runs, mode auto-detected) |
| 3 *(opt-in)* | `forge-assign-models` (Recommend → Apply) | `--assign-models` flag not provided |
| 4 *(auto-detected)* | `forge-build-agent-framework-solution` | PRD does not select Microsoft Agent Framework |
| 5 | `forge-orchestrate-build` (all phases) | — (always runs) |

Stage invocation follows the same delegation principle as `forge-bootstrap-project`: the meta-skill calls underlying skills and lets them own their own work. It never re-implements their logic.

### 3. Per-Phase Validation and Commit Contract

After each build phase completes in Stage 5, the skill enforces the following before proceeding:

1. **Validation gate** — all files the phase was supposed to produce exist, build/lint/test commands pass, and all phase acceptance criteria from the PRD are met.
2. **Commit** — `git add . && git commit -m "feat: complete Phase N — <phase name>"`.

If the validation gate fails, the skill **stops immediately** — it does not commit, does not move to the next phase, and does not retry silently. It reports the failing check, the exact error output, and the responsible agent, then asks the user how to proceed.

After all phases complete, a final commit captures any remaining uncommitted work: `chore: auto-build complete — all phases delivered`.

This gives every project built with `forge-auto-build` a consistent, auditable commit history that maps exactly to PRD phases.

### 4. Opt-In Model Assignment

`forge-assign-models` is only invoked if the user includes `--assign-models` in their `GO` command. When invoked, the skill runs it in Recommend mode first, then Apply mode immediately after — fully autonomous because the user's opt-in at the pre-flight gate is the equivalent of the Apply confirmation. This preserves the safety contract of ADR-003 (no agent YAML mutation without explicit intent) while still enabling hands-free execution.

### 5. Resumability

If a `forge-auto-build` run is interrupted, re-invoking the skill in the same repo causes it to read `docs/PROGRESS.md`, determine the last completed stage and task, and resume from there. Stages whose outputs are already committed are not re-run.

---

## Consequences

### Positive

- **Idea to committed code in one command.** Users with a clear scope can go from a one-liner to a fully built project without any manual hand-offs, approvals between stages, or phase-by-phase interruptions.
- **Consistent commit history.** The per-phase validation and commit contract means every project built with `forge-auto-build` has the same auditable, phase-aligned commit structure, regardless of which user ran it.
- **Hard stop on broken phases.** Validation failures block the commit and block the next phase. There is no way to silently accumulate broken phases into the commit history.
- **No regression for existing users.** `forge-bootstrap-project`, `@project-orchestrator`, and all underlying skills are unchanged. Users who prefer manual step-by-step control or intermediate review gates are unaffected.
- **Auto-deployed by bootstrap scripts.** `scripts/bootstrap.sh` and `scripts/bootstrap.ps1` iterate `templates/skills/*/`, so the new skill is included in all bootstrapped projects automatically.

### Negative

- **Reduced human oversight during the build.** By design, `forge-auto-build` does not pause between stages or between phases. If the PRD is subtly wrong, or if an agent produces an output that is technically valid but not what the user intended, the run will proceed without surfacing the issue until a validation failure occurs. Users who want per-artifact review should use `forge-bootstrap-project` + `@project-orchestrator` instead.
- **One more skill to maintain.** If the pipeline contracts of the underlying skills change (e.g., `forge-build-agent-team` adds a new required pre-step), the stage sequence and resumability logic in `forge-auto-build` must be updated to stay accurate.
- **Instruction-level enforcement only.** As with `forge-bootstrap-project`, the pre-flight gate and the per-phase validation contract are enforced by skill instructions, not by tooling. A sufficiently insistent prompt could bypass them.

### Neutral

- **`forge-bootstrap-project` remains the right choice for unknown-scope projects.** The two skills serve different use cases and are complementary. The prompt playbook documents both with a clear comparison so users can select the appropriate one.
- **No new file formats.** `forge-auto-build` uses `docs/PROGRESS.md` (already maintained by `forge-orchestrate-build`) as its resumption state. No new state files or manifests are introduced.

---

## References

- Skill: [forge-auto-build](../../templates/skills/forge-auto-build/SKILL.md)
- Skill: [forge-bootstrap-project](../../templates/skills/forge-bootstrap-project/SKILL.md)
- Skill: [forge-orchestrate-build](../../templates/skills/forge-orchestrate-build/SKILL.md)
- Skill: [forge-assign-models](../../templates/skills/forge-assign-models/SKILL.md)
- Docs: [Prompt Playbook — Full Auto Build](../prompt-playbook.md#full-auto-build---one-command-entire-pipeline-optional)
- ADR: [ADR-001 Agent/Skill Separation and Progress Reporting](001-agent-skill-separation-and-progress-reporting.md)
- ADR: [ADR-003 Per-Agent Model Assignment](003-per-agent-model-assignment.md)
- ADR: [ADR-004 Bootstrap Meta-Skill via forge-bootstrap-project](004-bootstrap-project-meta-skill.md)
