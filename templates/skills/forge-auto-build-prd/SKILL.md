---
name: forge-auto-build-prd
description: "Meta-skill that takes a project idea and produces a reviewed, confirmed PRD - with automatic decomposition when the PRD qualifies - then stops before team generation. Chains: idea confirmation → forge-build-prd (interview, review, save) → automatic decomposition check → hand off to forge-auto-build. Use this skill when you are starting a new project from an idea and no docs/PRD.md (or decomposed product vision + features) exists yet."
---

# Skill: Build a PRD from an Idea (Meta-Skill)

You are running the **PRD-creation stage** of the Agent Forge pipeline on behalf
of the user. Your job is to take a project idea and produce a confirmed,
reviewed PRD in `docs/PRD.md` - automatically decomposing it into a Product
Vision + Feature documents when the objective criteria are met - and then stop.
Team generation and build execution are deliberately out of scope here; that is
`forge-auto-build`'s job, and it requires the PRD to exist first.

You do not re-implement what the underlying skills do. You **invoke**
`forge-build-prd` and let it own its full process. Your value is confirming the
idea up front, verifying the outputs, and making the hand-off explicit.

---

## Operating Principles

- **PRD creation is a deliberate stage.** Do not start team generation or any
  build work. This skill ends with a reviewed PRD and a clear pointer to
  `forge-auto-build`.
- **Invoke, do not re-implement.** The PRD interview, drafting, review, and
  automatic decomposition belong to `forge-build-prd`. You sequence and verify,
  never duplicate its logic.
- **Preserve all existing outputs.** `docs/PRD.md` (and, when qualifying,
  `docs/product-vision.md` + `docs/features/*.md`) must be exactly what
  `forge-build-prd` and `forge-decompose-prd` produce directly. This skill is
  glue, not a rewrite.
- **Resumability.** If the repo already has `docs/PRD.md` or the decomposed
  layout, detect it and offer to resume/hand off instead of re-running the
  interview.
- **Headless mode skips human gates deliberately.** When invoked from a
  non-interactive terminal (see Step 0 below), the confirmation and review
  gates are satisfied by the invocation itself. Every decision the interview
  would have asked about is instead recorded as an Open Question with a stated
  default assumption in the PRD - so the artifact stays honest about what was
  decided automatically. Interactive use keeps all gates.

---

## Process

### Step 0: Confirm the Idea

The user invokes this skill with (typically) an idea, for example:

> `/forge-auto-build-prd I want to build a CLI that summarizes my git history into a weekly changelog.`

First, detect whether this is a **headless invocation**. Treat it as headless when
any of the following is true:

- The environment variable `FORGE_HEADLESS` is set to `1`.
- The invocation text contains `headless`, `auto-proceed`, or `do not ask`
  (the launcher's headless mode embeds "Headless mode: auto-proceed with
  default assumptions and approve the PRD").
- There is no interactive user to answer follow-up questions (e.g. a
  one-shot `opencode run` / `copilot -p` session).

**Interactive mode** (default):

1. **Echo the idea back** in one or two sentences so the user can confirm you
   understood it.
2. **Check the repo state:**
   - Does `docs/PRD.md` already exist? If yes, tell the user the PRD is already
     there and offer to run `forge-auto-build` against it instead.
   - Does `docs/product-vision.md` with `docs/features/*.md` exist? If yes,
     tell the user a decomposed PRD is already present and offer to run
     `forge-auto-build` against it instead.
3. **State the flow** explicitly:
   - Step 1: `forge-build-prd` → interview, draft, review, save `docs/PRD.md`
   - Step 2 (automatic): decomposition check → `forge-decompose-prd` when the
     PRD qualifies (15+ functional requirements or 3+ implementation phases)
   - Step 3: verification and hand-off → `forge-auto-build` for the agent team
     and build execution
4. **Wait for confirmation.** Do not proceed until the user confirms the idea
   is right.

**Headless mode:**

1. **Echo the idea** (from `docs/IDEA.md` if the invocation references it, or
   from the invocation text).
2. **Check the repo state** as above; if a PRD already exists, stop and report
   that `forge-auto-build` is the correct next step instead.
3. **Skip the confirmation pause and the clarifying-question interview.** Do
   not stop for answers. Build the PRD from `docs/IDEA.md` plus anything in
   `docs/research/`, stating a default assumption for every unknown and listing
   it in the PRD's **Open Questions** section.
4. **Auto-approve the review.** Present the finished PRD summary, but do not
   block on approval - the headless invocation has already authorized it.

### Step 1: Run `forge-build-prd`

Invoke the `forge-build-prd` skill, passing the confirmed idea as the input. Let
that skill drive its own clarifying-questions process; do not answer on the
user's behalf and do not collapse its interview into a single batch.

In **headless mode**, tell `forge-build-prd` you are in headless mode (pass
`FORGE_HEADLESS=1` or instruct it explicitly): it should skip its clarifying
questions, draft from `docs/IDEA.md` + `docs/research/*` with default
assumptions recorded in **Open Questions**, and auto-approve the review
checklist after presenting it.

`forge-build-prd` handles the PRD review (with its checklist) and - once the
user confirms the document is ready - automatically evaluates the decomposition
criteria in its Step 5. If the PRD qualifies, `forge-decompose-prd` runs without
any opt-in question.

---

### Step 2: Verify the Outputs

When `forge-build-prd` finishes, verify the state:

- **Always:** `docs/PRD.md` exists and contains at minimum Overview, Goals,
  Functional Requirements, Implementation Phases, and Acceptance Criteria.
- **If the PRD qualified for decomposition:** `docs/product-vision.md` exists
  and `docs/features/*.md` contains at least one feature document.
- **If the PRD did not qualify:** confirm `docs/PRD.md` remains the sole
  requirements document and the decomposition-not-required outcome was reported.

Then run a **content gap check** on `docs/PRD.md`, matching the interactive
quality pass: verify every major component has clear acceptance criteria, a
defined tech stack, non-functional requirements (performance, security,
privacy), and implementation phases.

If any section, file, or content gap is found, re-invoke `forge-build-prd` in
**gap-fill mode** - prompt it to "Review docs/PRD.md for gaps: check that every
major component has clear acceptance criteria, a defined tech stack,
non-functional requirements (performance, security, privacy), and implementation
phases. Flag anything missing and fill in the gaps." - then re-run this
verification before continuing.

> In **headless mode** this gap check runs automatically and never blocks: no
> user is present to review, so you fix every gap yourself and re-verify the
> document meets all the checks above before proceeding to the decomposition
> check. Record any unresolved judgement calls in the PRD's Open Questions.

---

### Step 3: Hand Off to `forge-auto-build`

Report the outcome and stop. Present:

- The path(s) produced: `docs/PRD.md` (and `docs/product-vision.md` +
  `docs/features/*.md` when decomposed).
- The recommended next step: run `forge-auto-build` to generate the agent team
  and execute the build. Note that `forge-auto-build` requires this PRD and
  will not generate one itself.
- If the user did not fully review the PRD, point them back to
  `docs/PRD.md` (or the product vision + features) and let them review before
  running `forge-auto-build`.

Do **not** proceed to team generation, model assignment, or build execution.

---

## Gotchas

- **Do not start the build.** This skill ends at the PRD hand-off. Team
  generation and execution belong to `forge-auto-build`, which requires the PRD
  to exist first.
- **Do not present a decomposition opt-in question.** When the PRD qualifies
  (15+ functional requirements or 3+ implementation phases), decomposition runs
  automatically inside `forge-build-prd`. Only non-qualifying PRDs stay
  monolithic, and that is reported, not asked about.
- **Preserve the original PRD.** If decomposition runs, `docs/PRD.md` is kept
  as-is; the vision and feature documents are generated alongside it.
- **Headless mode must not stall.** In a headless invocation there is no user to
  answer clarifying questions or type an approval. Auto-proceed with default
  assumptions (recorded in **Open Questions**) and treat the invocation as the
  approval. If you genuinely cannot produce a coherent PRD from the available
  inputs (empty idea, no seed docs), stop and report what input is missing.

---

## Guidelines

- **Be a conductor, not a soloist.** The substantive work - interviewing,
  drafting, reviewing, decomposing - belongs to `forge-build-prd` /
  `forge-decompose-prd`. Your value is idea confirmation, verification, and a
  clean hand-off.
- **Idempotent re-entry.** If the user re-invokes this skill mid-flow, inspect
  the repo and resume from the earliest step whose artifact is missing, rather
  than starting over.
- **No new file formats.** Do not introduce a state file, manifest, or config.
  The artifacts on disk (`docs/PRD.md`, `docs/product-vision.md`,
  `docs/features/*.md`) are the state.
