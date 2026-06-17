# PRD Output Format Template

This is the authoritative template for Product Requirements Documents. Load this when drafting or reviewing a PRD.

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
