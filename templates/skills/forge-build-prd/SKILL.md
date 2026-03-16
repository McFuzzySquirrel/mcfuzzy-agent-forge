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

The user will provide one or more of the following:

- A **brief idea** or concept description
- A **research document**, paper, or set of reference materials
- An **existing rough draft** or outline they want formalized

Acknowledge the input and summarize your understanding of the core concept back to the user before proceeding.

### Step 2: Ask Clarifying Questions

Before drafting, ask targeted clarifying questions to fill in gaps. Group your questions into the following categories and ask only what is not already answered by the input:

**Scope & Goals**
- What problem does this solve, and who is the target user?
- What does success look like? What are the key outcomes?
- Are there boundaries or explicit non-goals (things deliberately excluded)?

**Functional Requirements**
- What are the core features or capabilities?
- Are there specific user workflows or interaction patterns?
- What are the inputs and outputs of the system?

**Technical Constraints**
- Is there a required technology stack, platform, or runtime environment?
- Are there performance, security, or compliance requirements?
- Are there dependencies on existing systems or third-party services?

**Technology Currency**
- For each major technology in the stack, verify it is a current, actively maintained version.
- Search for the latest stable release of key frameworks and libraries before finalizing the tech stack section.
- Flag any specified technology that has a newer major version available, has been deprecated, or has reached end-of-life.
- Note any recent breaking changes or migration requirements in the Research Findings section.

**Security and Privacy**
- Does the system collect, store, or transmit user data?
- Are there authentication, authorization, or encryption requirements?
- Are there regulatory compliance needs (GDPR, CCPA, HIPAA, etc.)?

**Accessibility**
- Who are the target users, and are there accessibility requirements (e.g., WCAG 2.1 AA)?
- Must the product be usable via keyboard only, screen readers, or assistive technologies?
- Are there color contrast, motion sensitivity, or text size considerations?

**Design & Experience**
- Are there visual, UX, or interaction style preferences?
- Are there reference products or examples to draw from?

**Testing and Quality**
- How will the product be tested (automated tests, manual QA, playtesting)?
- Are there specific browsers, devices, or platforms to test against?
- What level of test coverage is expected?

**Delivery & Prioritization**
- Is there a target timeline or release plan?
- How should requirements be prioritized (e.g., MoSCoW: Must/Should/Could/Won't)?
- Should the work be broken into phases?

**Risks and Dependencies**
- Are there known risks or blockers?
- Are there external dependencies (APIs, services, libraries) that could affect delivery?
- What happens if a dependency becomes unavailable?

Wait for the user to respond. You may ask follow-up questions if the answers reveal new unknowns. Continue until you have enough information to write a useful, actionable document.

### Step 3: Draft the Document

Produce a structured PRD or spec using the format defined below. Use the information gathered in Steps 1 and 2. Where the user has not specified a detail, state a reasonable default assumption and mark it in an **Open Questions** section so it can be revisited.

### Step 4: Review and Iterate

Present the draft to the user and ask:

- Does this accurately capture your intent?
- Are any sections missing, incorrect, or over-specified?
- Should any priorities be adjusted?

Incorporate feedback and present the updated version. Repeat until the user confirms the document is ready.

---

## Output Format

Use the following structure for the PRD or spec. Adapt section depth and detail to the scope of the project — a small utility needs less than a full platform. Every section heading should be included even if the content is brief.

```markdown
# [Product / Feature Name]

## 1. Overview

**Product Name:** ...
**Summary:** A concise description of what this is, what it does, and why it matters.
**Target Platform:** Where this runs or is deployed.
**Key Constraints:** Any overarching constraints (offline support, performance budgets, regulatory, etc.)

---

## 2. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | YYYY-MM-DD | — | Initial PRD |

Track document revisions so readers know what changed and when.

---

## 3. Goals and Non-Goals

### 3.1 Goals
- What the project aims to achieve (bulleted list of outcomes)

### 3.2 Non-Goals
- What is explicitly excluded from scope and why (prevents scope creep and sets expectations)

---

## 4. User Stories / Personas

### 4.1 Personas
Define 2–4 representative users with their key needs.

| Persona | Description | Key Needs |
|---------|-------------|-----------|
| Name | Who they are | What they need from this product |

### 4.2 User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| US-01 | [persona] | [action] | [outcome] | Must / Should / Could |

---

## 5. Research Findings

Summarize relevant research, competitive analysis, or technical investigation that informs the requirements. Include:
- Technology choices and why they were selected
- Comparisons or trade-off analyses (use tables where helpful)
- Best practices or design principles drawn from research

---

## 6. Concept

### 6.1 Core Loop / Workflow
Describe the primary user journey or system flow. Use a text diagram, numbered steps, or flowchart.

### 6.2 Success / Completion Criteria
Define what "done" looks like from the user's perspective.

---

## 7. Technical Architecture

### 7.1 Technology Stack
Table of components, technologies, and version notes.

### 7.2 Project Structure
Proposed file/folder layout.

### 7.3 Key APIs / Interfaces
Table or list of important APIs, libraries, or integration points.

---

## 8. Functional Requirements

Organize requirements into logical groups (e.g., by feature area or component). Use tables with columns:

| ID | Requirement | Priority |
|----|-------------|----------|
| XX-01 | Description of the requirement | Must / Should / Could |

---

## 9. Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NF-01 | Performance, security, accessibility, maintainability, etc. | Must / Should / Could |

---

## 10. Security and Privacy

| ID | Requirement | Priority |
|----|-------------|----------|
| SP-01 | Data handling, authentication, authorization, encryption, compliance, etc. | Must / Should / Could |

Document what data is collected, stored, or transmitted. State privacy commitments, compliance needs (GDPR, CCPA, etc.), and threat mitigations. Even if the project handles no sensitive data, state that explicitly.

---

## 11. Accessibility

| ID | Requirement | Priority |
|----|-------------|----------|
| ACC-01 | WCAG compliance level, keyboard navigation, screen reader support, color contrast, etc. | Must / Should / Could |

Ensure the product is usable by people with disabilities. Reference WCAG 2.1 AA as a baseline where applicable.

---

## 12. User Interface / Interaction Design

Describe screens, layouts, controls, or interaction patterns. Reference wireframes or mockups if available.

---

## 13. System States / Lifecycle

Describe states and transitions the system goes through (e.g., loading, active, error, complete). A state machine diagram is helpful for complex systems.

---

## 14. Implementation Phases

Break the work into ordered phases with checkboxes:

### Phase 1: [Name]
- [ ] Task 1
- [ ] Task 2

### Phase 2: [Name]
- [ ] Task 1
- [ ] Task 2

---

## 15. Testing Strategy

Define how the product will be validated at each level:

| Level | Scope | Tools / Approach |
|-------|-------|------------------|
| Unit Tests | Individual functions and modules | Testing framework (e.g., Jest, Vitest, pytest) |
| Integration Tests | Component interactions and workflows | Mock dependencies, test state transitions |
| Manual / Exploratory | End-to-end user experience | Playtesting, peer review, exploratory sessions |
| Performance | Throughput, latency, resource usage | Profiling tools, benchmarks |
| Cross-Platform | Behavior across target platforms/browsers | Manual or automated matrix testing |

List key test scenarios as a numbered checklist.

---

## 16. Analytics / Success Metrics

Define how success will be measured after launch:

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| [metric name] | [target value] | [how it's measured] |

If no telemetry is planned, state that and describe how success will be evaluated (e.g., manual testing, user feedback).

---

## 17. Acceptance Criteria

Numbered list of conditions that must be true for the project to be considered complete.

---

## 18. Dependencies and Risks

### 18.1 Dependencies
List external libraries, services, APIs, or tools the project depends on, with mitigation if unavailable.

| Dependency | Type | Risk if Unavailable | Mitigation |
|------------|------|---------------------|------------|
| [name] | npm / API / service | [impact] | [mitigation] |

### 18.2 Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| [risk description] | Low / Medium / High | [impact] | [mitigation strategy] |

---

## 19. Future Considerations

Items explicitly out of scope for the current version but worth documenting for future releases:

| Item | Description | Potential Version |
|------|-------------|-------------------|
| [feature] | [what it would do] | v2 / v3 / TBD |

---

## 20. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Unresolved question | What we'll assume if not answered |

---

## 21. Glossary

| Term | Definition |
|------|------------|
| Term | What it means in this context |
```

---

## Guidelines

- **Be specific and actionable.** Requirements should be clear enough that a developer or AI agent can implement them without ambiguity.
- **Use tables** for structured data like requirements, comparisons, and configuration values.
- **State assumptions explicitly.** If information was not provided, document the assumption and flag it in Open Questions.
- **Prioritize with MoSCoW** (Must / Should / Could / Won't) unless the user requests a different scheme.
- **Keep the document self-contained.** A reader should understand the full scope without needing to refer to external conversations.
- **Scale to the project.** A weekend prototype needs a lighter document than an enterprise platform. Adjust depth accordingly, but keep all section headings for consistency.
- **Reference existing project docs.** If the repository already contains documentation (e.g., a prior PRD, architecture docs, or research notes), review them and build upon or reference them where relevant rather than duplicating or contradicting existing decisions.


