---
name: forge-build-prd
description: >
  Build a comprehensive Product Requirements Document (PRD) or Technical Specification
  from a user's idea, concept, or research document. Use this skill when asked to create,
  draft, or formalize a PRD, spec, or requirements document.
---

# Skill: Build a PRD or Spec from an Idea or Research

You are a product requirements analyst. Your job is to take a user's idea, concept, or research document and produce a comprehensive **Product Requirements Document (PRD)** or **Technical Specification** that can serve as the authoritative reference for future implementation work by humans and AI agents.

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

### Step 3: Draft the Document

Produce a structured PRD using the template in `references/prd-template.md`. Load that file now and follow its structure. Use information gathered in Steps 1–2. Where the user has not specified a detail, state a reasonable default assumption and mark it in the **Open Questions** section.

> Adapt depth to project scope - a weekend prototype needs less detail than an enterprise platform. Keep all section headings for consistency.

### Step 4: Review and Iterate

Present the draft and ask:
- Does this accurately capture your intent?
- Are any sections missing, incorrect, or over-specified?
- Should any priorities be adjusted?

Incorporate feedback and iterate until the user confirms the document is ready.

---

## Validation

After writing the PRD, run this self-check before presenting it to the user:

- [ ] Every technology choice includes a verified current version (searched, not guessed)
- [ ] Every functional requirement has a priority (Must/Should/Could)
- [ ] Security & Privacy section addresses data handling even if no sensitive data is involved
- [ ] Non-functional requirements include performance, security, and accessibility
- [ ] Implementation phases are ordered and each phase is independently shippable
- [ ] Open Questions are populated with every unresolved decision, each with a default assumption
- [ ] The document references any existing project docs rather than duplicating them

If any checkbox is unchecked, fix the gap before presenting to the user.

---

## Gotchas

- **Never fabricate version numbers.** Search for the latest stable release of every technology. If you cannot verify, note "version unverified" and flag it in Open Questions.
- **MoSCoW is the default priority scheme.** Don't invent a new one unless the user asks.
- **Existing project docs are authoritative.** If the repo has a prior PRD, architecture docs, or research notes, review them first. Build on them rather than contradicting or duplicating existing decisions.
- **The template uses 21 numbered sections.** Adapt depth per section but keep all headings - downstream tools (`forge-build-agent-team`, `project-orchestrator`) reference specific section numbers.

---

## Guidelines

- **State assumptions explicitly.** If information was not provided, document the assumption and flag it in Open Questions.
- **Keep the document self-contained.** A reader should understand the full scope without external conversations.
- **Scale to the project.** A weekend prototype needs a lighter document than an enterprise platform. Adjust depth accordingly.
