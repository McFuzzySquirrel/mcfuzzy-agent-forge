---
name: forge-bootstrap-project
description: >
  Meta-skill that bootstraps a new project end-to-end from a one-liner idea by
  chaining the deterministic Forge skills: forge-build-prd → (pause for review) →
  forge-build-agent-team → (pause for review) → optionally forge-assign-models.
  Use this skill when a user wants to go from idea to a reviewable PRD and a
  generated agent team in a single guided flow, without losing the human review
  gates between steps.
---

# Skill: Bootstrap a Project from an Idea (Meta-Skill)

You are orchestrating the standard Agent Forge bootstrap flow on behalf of the
user. Your job is to remove copy-paste friction between the deterministic Forge
skills **without removing the human review gates between them**.

You do not re-implement what the underlying skills do. You **invoke** them in
order, pause at each handoff, present a verification checklist, and only
continue when the user explicitly approves.

This skill chains:

1. **`forge-build-prd`** - interview the user and produce `docs/PRD.md`.
2. **Pause 1 - PRD review gate** (mandatory).
3. **`forge-build-agent-team`** - generate the specialist agent team from the
   approved PRD.
4. **Pause 2 - Agent team review gate** (mandatory).
5. **`forge-assign-models`** - discover models and recommend a per-agent
   assignment (optional, opt-in at Pause 2).

---

## Operating Principles

- **Never skip a pause.** Even if the user says "just do everything," you still
  stop at each gate, present the checklist, and require an explicit "approved"
  / "continue" / "looks good" before moving on. The pauses exist because PRDs
  and agent teams are high-leverage artifacts that are expensive to fix later.
- **Do not duplicate the underlying skills' work.** When it is time to run a
  step, invoke the corresponding skill (`forge-build-prd`,
  `forge-build-agent-team`, `forge-assign-models`) and let it own its full
  process - including any clarifying questions it normally asks.
- **Preserve all existing outputs.** The artifacts produced (`docs/PRD.md`,
  `.agents/agents/*.md`, `.agents/skills/*/SKILL.md`, `docs/MODEL-PLAN.md`,
  etc.) must be identical to what you would get by running the underlying
  skills directly. This skill is glue, not a rewrite.
- **Stay inside the existing model.** You are one skill calling the procedures
  of other skills. Do not introduce new files, formats, or tools beyond what
  the underlying skills already produce.
- **Be explicit about which step you are in.** At every message, name the
  current step (e.g., "Step 1 of 3: forge-build-prd") so the user knows where
  they are in the flow.
- **Resumability.** If the user starts this skill in a repo that already has a
  `docs/PRD.md` or existing agents in `.agents/agents/`, detect it and offer to
  resume from the appropriate step instead of overwriting.

---

## Process

### Step 0: Confirm the Idea and the Flow

The user invokes this skill with (typically) a one-liner idea, e.g.:

> `/forge-bootstrap-project I want to build a CLI that summarizes my git history into a weekly changelog.`

Do the following before invoking any other skill:

1. **Echo the idea back** in one or two sentences so the user can confirm you
   understood it.
2. **State the flow** explicitly:
   - Step 1: `forge-build-prd` → produces `docs/PRD.md`
   - Pause 1: PRD review
   - Step 2: `forge-build-agent-team` → produces agent + skill files
   - Pause 2: Agent team review
   - Step 3 (optional): `forge-assign-models` → recommends per-agent models

   (These are Steps 1–3 of the bootstrap flow itself; this confirmation is
   Step 0 - the pre-flight before any underlying skill is invoked.)
3. **Check repo state** and flag anything that affects the flow:
   - Does `docs/PRD.md` already exist? If yes, ask whether to keep, replace,
     or extend it before running Step 1.
   - Do agent files already exist in `.agents/agents/` (beyond the forge
     templates `project-orchestrator` and `forge-team-builder`)? If yes,
     warn that Step 2 will run in **Feature Increment Mode** rather than
     Full Build, and confirm whether the user wants that.
   - Does `docs/product-vision.md` with `docs/features/*.md` exist? If yes,
     Step 2 will run in **Vision + Features Mode**; confirm with the user.
4. **Wait for confirmation.** Do not proceed to Step 1 until the user says to
   start.

---

### Step 1: Run `forge-build-prd`

Invoke the `forge-build-prd` skill, passing the user's idea as the input.
Let that skill drive its own clarifying-questions process; do not answer on
the user's behalf and do not collapse its interview into a single batch.

When `forge-build-prd` finishes and `docs/PRD.md` is saved, transition to
**Pause 1**. Do not silently continue into Step 2.

---

### Pause 1: PRD Review Gate (mandatory)

Post a message that clearly says you are paused. Include:

- The path to the artifact: `docs/PRD.md`
- A one-paragraph summary of what was produced (scope, key tech stack
  choices, number of phases, number of functional requirements).
- A list of **Open Questions** the PRD itself flagged (copy them out of the
  PRD's "Open Questions" section so the user does not have to hunt).
- The verification checklist below.
- An explicit prompt: *"Reply `approved` to continue to Step 2
  (forge-build-agent-team), `revise: <notes>` to iterate on the PRD, or
  `stop` to end here."*

**PRD review checklist (emit verbatim):**

```
PRD review checklist - verify before continuing:

Scope & intent
- [ ] The Overview matches the idea you actually want to build
- [ ] Goals and Non-Goals are correct (nothing important is missing, nothing
      out-of-scope has crept in)
- [ ] Target users / personas are right

Requirements
- [ ] Every must-have capability you care about appears as a functional
      requirement with a priority
- [ ] Non-functional requirements (performance, security, privacy,
      accessibility) reflect your real constraints
- [ ] Security & Privacy section is correct (data handling, auth, compliance)

Technical choices
- [ ] Technology stack is current, available to you, and acceptable
- [ ] Project Structure is something you are willing to live with
- [ ] No deprecated or end-of-life dependencies were selected

Plan
- [ ] Implementation Phases are ordered correctly and each phase is shippable
- [ ] Testing Strategy matches how you actually plan to validate the product
- [ ] Acceptance Criteria are concrete enough that "done" is unambiguous

Open items
- [ ] Every entry under "Open Questions" has either an answer or an explicit
      "accept the default assumption" decision
- [ ] Any flagged risks have a mitigation you can live with
```

Do not invoke `forge-build-agent-team` until the user responds with an
approval keyword (e.g., `approved`, `continue`, `looks good`, `proceed`).
If the user replies with revisions, hand control back to `forge-build-prd`
to iterate, then re-present Pause 1 with the updated checklist.

---

### Step 2: Run `forge-build-agent-team`

After Pause 1 is approved, invoke the `forge-build-agent-team` skill against
the approved PRD (or against `docs/product-vision.md` + `docs/features/*.md`
if that layout exists). Let that skill detect its own mode (Full Build,
Vision + Features, or Feature Increment) - do not override its mode
detection.

When it finishes and agent files have been written under `.agents/agents/`
(and any skills under `.agents/skills/`), transition to **Pause 2**.

---

### Pause 2: Agent Team Review Gate (mandatory)

Post a paused message. Include:

- The list of agent files written or modified, with a one-line role
  description for each.
- The list of skill files written or modified, if any.
- A pointer to the responsibility matrix if one was produced (e.g.,
  `docs/agent-responsibility-matrix.md`).
- The verification checklist below.
- An explicit prompt: *"Reply `approved and assign models` to continue to
  Step 3 (forge-assign-models), `approved` (without models) to stop here
  with the team in place, `revise: <notes>` to iterate on the team, or
  `stop` to end here."*

**Agent team review checklist (emit verbatim):**

```
Agent team review checklist - verify before continuing:

Coverage
- [ ] Every PRD requirement (or every feature in docs/features/) maps to
      exactly one primary owner agent
- [ ] No requirement is unowned
- [ ] No two agents claim primary ownership of the same area

Boundaries
- [ ] Each agent's responsibilities are scoped to a clear domain (no
      "do everything" agents)
- [ ] Cross-cutting concerns (testing, security, docs, ops) have explicit
      owners rather than being implied

Hygiene
- [ ] Each agent file has valid YAML frontmatter and the `name:` matches
      the filename
- [ ] The forge templates (`project-orchestrator`, `forge-team-builder`)
      are still present and untouched
- [ ] Any newly generated skills have a `SKILL.md` and follow the existing
      skill format

Fit
- [ ] The team size feels right for the project (not so large that
      coordination dominates, not so small that agents are overloaded)
- [ ] You are comfortable handing each agent its stated scope
```

Do not invoke `forge-assign-models` unless the user explicitly opts in at
this gate. If the user replies with only `approved` (no model-assignment
request), end the flow here and tell them they can run
`forge-assign-models` later at any time.

If the user replies with revisions, hand control back to
`forge-build-agent-team` to iterate, then re-present Pause 2 with the
updated checklist.

---

### Step 3 (Optional): Run `forge-assign-models`

Only run this step if the user explicitly opted in at Pause 2.

Invoke the `forge-assign-models` skill. Default to its **Recommend** mode —
which produces `docs/MODEL-PLAN.md` without modifying agent files - unless
the user explicitly asked for **Apply**. This preserves the underlying
skill's own opt-in safety: nothing gets written into agent YAML without a
second confirmation.

When the skill finishes:

- If it ran in **Recommend** mode: point the user at `docs/MODEL-PLAN.md`
  and tell them how to invoke `forge-assign-models` again in **Apply** mode
  when ready.
- If it ran in **Apply** mode: list the agent files that were modified
  and summarize which model each agent received.

End the flow with a short summary of what was produced and the recommended
next step (typically: commit the changes, then invoke
`@project-orchestrator` to start executing Phase 1).

---

## Guidelines

- **Be a conductor, not a soloist.** The substantive work - interviewing the
  user, drafting the PRD, designing the team, classifying workloads - belongs
  to the underlying skills. Your value is sequencing, pausing, and surfacing
  the right checklist at the right moment.
- **Never collapse a pause into a "looks fine, moving on" message.** The
  whole point of this meta-skill is that the review gates remain real.
- **Repeat checklists verbatim.** Do not paraphrase the checklists; users
  rely on them being stable across runs.
- **Quote, do not invent.** When summarizing Open Questions or agent roles
  at a pause, pull the text from the artifact rather than restating from
  memory.
- **Idempotent re-entry.** If the user re-invokes this skill mid-flow
  (e.g., after closing their session), inspect the repo state and resume
  from the earliest step whose artifact is missing or unapproved, rather
  than starting over.
- **No new file formats.** Do not introduce a new state file, manifest, or
  config to track progress between pauses. The artifacts on disk
  (`docs/PRD.md`, `.agents/agents/*.md`, `docs/MODEL-PLAN.md`) are the
  state.

---

## Gotchas

- **Idempotent re-entry edge case.** If `docs/PRD.md` exists but `.agents/agents/` has no specialist agents, resume from Step 2 (team building). If both exist, assume the flow completed and summarize what was produced - don't re-run.
- **Feature Increment mode on re-entry.** If `.agents/agents/` already has specialist agents and the user says "bootstrap my project," Step 0's repo check must warn that Step 2 will run in Feature Increment Mode, not Full Build. Confirm with the user or they'll get unexpected behavior.
- **Model assignment is opt-in only.** Never auto-run `forge-assign-models`. It requires the user's model inventory to exist and writing to agent YAML without explicit Apply confirmation is a violation of that skill's safety constraint.
- **Don't re-implement the underlying skills.** This is the most common failure mode - duplicating the PRD interview or team design logic instead of invoking the skills. If you find yourself asking clarifying questions that `forge-build-prd` would ask, stop and invoke it instead.
