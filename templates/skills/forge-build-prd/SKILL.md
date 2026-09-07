---
name: forge-build-prd
description: "Author a product vision and canonical feature requirements from an idea, research, or existing repository. Use when asked to create, draft, or formalize a PRD, spec, or requirements; every solution uses features."
---

# Skill: Build a PRD or Spec from an Idea or Research

You are a product requirements analyst. Produce `docs/PRD.md` and one or more `docs/features/*.md` directly. This is the only active requirements layout, even for a one-task solution. Do not create a monolithic PRD or duplicate task catalogue. Existing documents are source material; preserve historical originals but never use them as execution sources.

---

## Process

### Step 1: Receive the Input

The user will provide one or more of: a brief idea, a research document, or an existing rough draft.

Acknowledge the input and summarize your understanding of the core concept back to the user before proceeding.

### Step 2: Ask Clarifying Questions

Ask targeted questions to fill in gaps. Group by category and ask only what the input doesn't already answer:

**Scope & Goals**
- What problem does this solve, and who is the target user?
- What does success look like? What are the key outcomes?
- What is explicitly out of scope?

**Functional Requirements**
- What are the core features or capabilities?
- What are the inputs and outputs of the system?

**Technical Constraints**
- Is there a required technology stack, platform, or runtime environment?
- Are there performance, security, or compliance requirements?

**Technology Currency**
- For each major technology in the stack, verify it is a current, actively maintained version.
- Search for the latest stable release before finalizing. Flag anything deprecated or end-of-life.

**Security and Privacy**
- Does the system collect, store, or transmit user data?
- Are there authentication, authorization, encryption, or regulatory compliance needs?

**Accessibility**
- Who are the target users? Are there accessibility requirements (e.g., WCAG 2.1 AA)?

**Design & Experience**
- Are there visual, UX, or interaction style preferences?
- Are there reference products or examples?

**Testing and Quality**
- How will the product be tested? What level of test coverage is expected?

**Delivery & Prioritization**
- Is there a target timeline? Should the work be broken into phases?

**Risks and Dependencies**
- Are there known risks, blockers, or external dependencies?

Wait for the user to respond. Ask follow-up questions if answers reveal new unknowns.

> **Headless mode.** When invoked non-interactively (`FORGE_HEADLESS=1`, or the
> invocation says "headless" / "auto-proceed"), skip this interview entirely.
> Draft the PRD from the supplied input (`docs/IDEA.md`, `docs/research/*`, or
> the inline idea). For every answer the interview would have gathered, record a
> reasonable default assumption in the PRD's **Open Questions** section so the
> document remains honest about what was decided automatically.

### Step 3: Draft the Document

Load `references/task-contract.md` before writing implementation phases. Author
one bounded `forge-task` JSON block per task, carrying requirement meaning,
acceptance criteria, constraints, source references, explicit planned specialist
names, dependencies, deliverable paths, and executable validation commands.
Separate human sign-off from agent preparation. Apply its per-task review in
both interactive and headless gap checks; document-level completeness alone is
not sufficient. The compiler does not repair vague instructions.

Load `references/prd-template.md` for the canonical layout, and the sibling `forge-decompose-prd/references/product-vision-template.md` and `feature-document-template.md` for document structure. Identify feature boundaries before writing tasks. The vision owns shared architecture, constraints and cross-feature stories; each feature owns its specific definitions and tasks. Use globally stable IDs, ID-only traceability links and version-2 task contracts. Write each requirement once as a `forge-requirement` definition and resolve references at compilation. Record reasonable default assumptions in Open Questions.

> Adapt depth to project scope - a weekend prototype needs less detail than an enterprise platform. Keep all section headings for consistency.

### Step 4: Review and Iterate

Present the draft and the review checklist below. Ask the user to verify before confirming the document is ready:

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

Ask:
- Does this accurately capture your intent?
- Are any sections missing, incorrect, or over-specified?
- Should any priorities be adjusted?

Incorporate feedback until the user confirms the vision and features are ready. Save directly to the canonical files and proceed to Step 5.

> **Headless mode.** When invoked non-interactively, present the checklist once
> (it is part of the audit trail) but do **not** block for approval - the
> headless invocation has already authorized the document. Before saving, run a
> **gap check** against the draft: verify every major component has clear
> acceptance criteria, a defined tech stack, non-functional requirements
> (performance, security, privacy), and implementation phases; **fill any gaps**
> the same way the interactive gap-fill pass would. Only then save
> `docs/PRD.md` and `docs/features/*.md` and run Step 5.

---

### Step 5: Validate Canonical Features

Every solution must have a nonempty vision feature table listing every feature,
exact dependency names, and a valid task/feature DAG. A small solution has one
feature, not a different representation. Run the read-only `validate-prd` command
in `references/task-contract.md`. Fix unresolved IDs, duplicate definitions or
task bodies, uncovered requirements and invalid contracts. Review prose warnings
and replace copied text with canonical links where appropriate.

`forge-decompose-prd` is a conversion tool for supplied legacy source documents,
not a second generation pass for new solutions. Preserve completed task IDs and
historical source files; only canonical feature tasks are executable.

---

## Validation

After writing the PRD, run this self-check before presenting it to the user:

- [ ] Every technology choice includes a verified current version (searched, not guessed)
- [ ] Every functional requirement has a priority (Must/Should/Could)
- [ ] Security & Privacy section addresses data handling even if no sensitive data is involved
- [ ] Non-functional requirements include performance, security, and accessibility
- [ ] Implementation phases are ordered and each phase is independently shippable
- [ ] Each phase contains execution-sized tasks, with acceptance-to-check mappings and concrete output/test files; it is not one task per roadmap increment
- [ ] UI, domain, infrastructure and documentation checks cover their respective deliverables; human judgments are separate review tasks
- [ ] The deterministic `validate-prd` gate passes without `--allow-legacy`
- [ ] Open Questions are populated with every unresolved decision, each with a default assumption
- [ ] The document references any existing project docs rather than duplicating them
- [ ] The vision and at least one feature exist, every definition has one owner, and every task appears in exactly one feature

If any checkbox is unchecked, fix the gap before presenting to the user.

---

## Gotchas

- **Never fabricate version numbers.** Search for the latest stable release of every technology. If you cannot verify, note "version unverified" and flag it in Open Questions.
- **MoSCoW is the default priority scheme.** Don't invent a new one unless the user asks.
- **Existing project docs are authoritative.** If the repo has a prior PRD, architecture docs, or research notes, review them first. Build on them rather than contradicting or duplicating existing decisions.
- **Features are mandatory.** There is no size threshold, monolithic fallback, or authoring-only exemption.
- **Do not duplicate shared rules.** Keep canonical definitions in the vision or owning feature and use ID references elsewhere.
- **Preserve history.** Do not rewrite supplied historical documents or renumber completed work during conversion.

---

## Guidelines

- **State assumptions explicitly.** If information was not provided, document the assumption and flag it in Open Questions.
- **Keep the document self-contained.** A reader should understand the full scope without external conversations.
- **Scale to the project.** A weekend prototype needs a lighter document than an enterprise platform. Adjust depth accordingly.
