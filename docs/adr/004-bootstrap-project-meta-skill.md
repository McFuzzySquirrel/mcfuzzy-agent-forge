# ADR-004: Bootstrap Meta-Skill via `forge-bootstrap-project`

**Date:** 2026-05-18
**Status:** Accepted

---

## Context

The standard Agent Forge "new project" flow is a fixed sequence of deterministic
skills:

1. `forge-build-prd` — interview the user, produce `docs/PRD.md`.
2. *(Human reviews the PRD.)*
3. `forge-build-agent-team` — generate the specialist agent team from the PRD.
4. *(Human reviews the team.)*
5. *(Optional)* `forge-assign-models` — recommend a per-agent model assignment.

Each step is well-defined and well-tested in isolation, but stitching them
together is currently a manual copy-paste exercise. The user has to:

- Remember the right invocation for each skill (`/forge-build-prd …`,
  `/forge-build-agent-team …`, `/forge-assign-models …`).
- Remember the right ordering and the right inputs at each handoff.
- Decide on their own when to pause and what to verify before continuing.

This creates two problems:

1. **Friction.** A user with a fresh one-liner idea has to know the whole
   pipeline to get started, which raises the activation energy of the
   framework. New users in particular drop the optional steps simply because
   they did not know they existed.

2. **Inconsistent review quality.** The pauses between steps are the highest-
   leverage moments in the flow — fixing a wrong PRD before the team is
   generated is orders of magnitude cheaper than fixing it afterwards — but
   users often skip or rush them because no checklist is presented at the
   handoff.

At the same time, removing the pauses is not acceptable. The PRD and the
agent team are high-leverage artifacts that materially shape the rest of the
project, and they deserve explicit human approval before the next step
consumes them.

---

## Decision

We introduce a new **`forge-bootstrap-project` meta-skill** that chains the
existing skills end-to-end from a one-liner idea, while **preserving the
human review gates between them**.

### 1. Scope and Boundaries

The meta-skill is **pure orchestration**:

- It invokes the existing skills (`forge-build-prd`,
  `forge-build-agent-team`, `forge-assign-models`) and lets each one own its
  full process, including its clarifying questions and its mode detection.
- It does **not** re-implement any of their logic and does **not** produce
  artifacts of its own beyond what the underlying skills already produce.
- It does **not** introduce a new state file, manifest, or progress tracker;
  the on-disk artifacts (`docs/PRD.md`, `.github/agents/*.md`,
  `docs/MODEL-PLAN.md`) are the state.

### 2. Mandatory Review Pauses

The meta-skill enforces two non-skippable pauses:

| Pause | After | What the skill emits |
|-------|-------|----------------------|
| **Pause 1** | `forge-build-prd` | A summary of `docs/PRD.md`, the PRD's own Open Questions, and a verbatim PRD review checklist (scope, requirements, technical choices, plan, open items). |
| **Pause 2** | `forge-build-agent-team` | A list of agent/skill files written, a pointer to the responsibility matrix if present, and a verbatim team review checklist (coverage, boundaries, hygiene, fit). |

At each pause the user must reply with an approval keyword (e.g. `approved`,
`continue`, `proceed`) before the next step runs. Replies of
`revise: <notes>` hand control back to the underlying skill to iterate;
`stop` ends the flow.

Even if the user asks the meta-skill to "just do everything," the pauses
remain in place. This is intentional.

### 3. Opt-In Model Assignment

`forge-assign-models` is only invoked if the user explicitly opts in at
Pause 2 (e.g. `approved and assign models`). When invoked, the meta-skill
defaults it to **Recommend** mode so `docs/MODEL-PLAN.md` is produced but no
agent YAML is modified without a second confirmation. This preserves the
opt-in safety of `forge-assign-models` itself (see ADR-003).

### 4. Resumability and Mode Detection

Before invoking any underlying skill, the meta-skill inspects repo state:

- An existing `docs/PRD.md` triggers a "keep / replace / extend" prompt
  rather than a silent overwrite.
- Existing agents in `.github/agents/` (beyond the forge templates) cause
  the meta-skill to warn that `forge-build-agent-team` will run in
  **Feature Increment Mode** rather than Full Build.
- An existing `docs/product-vision.md` + `docs/features/*.md` layout causes
  it to warn that `forge-build-agent-team` will run in
  **Vision + Features Mode**.

Mode detection itself is **not** overridden — `forge-build-agent-team` owns
that decision. The meta-skill only surfaces the consequence so the user is
not surprised.

---

## Consequences

### Positive

- **Single-prompt onboarding.** A user with a one-liner idea can invoke
  `/forge-bootstrap-project …` and reach a reviewed PRD plus a generated
  agent team without remembering the rest of the pipeline.
- **Review quality is structural, not aspirational.** The verbatim
  checklists at each pause guarantee that users see the same verification
  prompts every run, regardless of who is driving.
- **No regression for power users.** The underlying skills are unchanged
  and remain individually invokable. Anyone who prefers the manual
  step-by-step flow in the prompt playbook can continue to use it.
- **Backward compatible with `forge-assign-models`.** Defaulting to
  Recommend mode means no agent file mutation happens without explicit
  approval, matching the safety contract established in ADR-003.

### Negative

- **One more thing to maintain.** If the underlying skills change their
  interfaces (e.g. the agent-team skill adds a new mode), the meta-skill's
  pause messaging and resumability checks may need to be updated to stay
  accurate.
- **No machine-enforced gating.** The pauses are enforced by skill
  instructions, not by tooling. A sufficiently insistent user could
  instruct the model to skip them. The mitigation is the explicit "never
  skip a pause" operating principle and the verbatim checklist requirement.

### Neutral

- **No bootstrap script changes** — `scripts/bootstrap.sh` and
  `scripts/bootstrap.ps1` already iterate `templates/skills/*/`, so the
  new skill is auto-deployed.
- **No new file formats** — the meta-skill writes nothing of its own; all
  artifacts continue to come from the underlying skills.

---

## References

- Skill: [forge-bootstrap-project](../../templates/skills/forge-bootstrap-project/SKILL.md)
- Skill: [forge-build-prd](../../templates/skills/forge-build-prd/SKILL.md)
- Skill: [forge-build-agent-team](../../templates/skills/forge-build-agent-team/SKILL.md)
- Skill: [forge-assign-models](../../templates/skills/forge-assign-models/SKILL.md)
- Docs: [Prompt Playbook — Fast Path](../prompt-playbook.md)
- ADR: [ADR-001 Agent/Skill Separation](001-agent-skill-separation-and-progress-reporting.md)
- ADR: [ADR-002 PRD Decomposition into Features](002-prd-decomposition-into-features.md)
- ADR: [ADR-003 Per-Agent Model Assignment](003-per-agent-model-assignment.md)
