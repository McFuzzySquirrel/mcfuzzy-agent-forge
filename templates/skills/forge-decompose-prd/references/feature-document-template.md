# Feature Document Template

Load this when writing a feature document.

```markdown
# Feature: [Feature Name]

## Traceability

| Feature ID | Original PRD ID | Description |
|-----------|----------------|-------------|
| {PREFIX}-US-01 | US-03 | Original user story reference |
| {PREFIX}-FR-01 | FR-07 | Original requirement reference |

**Product Vision:** [docs/product-vision.md](../product-vision.md)
**Original PRD:** [docs/PRD.md](../PRD.md)

---

## 1. Feature Overview

**Feature Name:** ...
**ID Prefix:** {PREFIX}
**Summary:** A concise description of what this feature does and why it matters.
**Dependencies:** [List of features this depends on, or "None"]
**Priority:** Must / Should / Could

---

## 2. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| {PREFIX}-US-01 | [persona] | [action] | [outcome] | Must / Should / Could |

---

## 3. Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| {PREFIX}-FR-01 | Description of the requirement | Must / Should / Could |

---

## 4. UI / Interaction Design

[Describe screens, layouts, controls, or interaction patterns specific to this feature. Reference wireframes or mockups if available.]

---

## 5. Implementation Tasks

### Phase 1: [Name]
- [ ] Task 1
- [ ] Task 2

### Phase 2: [Name]
- [ ] Task 1

---

## 6. Testing Strategy

| Level | Scope | Approach |
|-------|-------|----------|
| Unit Tests | Feature-specific code | ... |
| Integration Tests | Feature + existing system | ... |

Key test scenarios:
1. [Scenario 1]
2. [Scenario 2]

---

## 7. Acceptance Criteria

1. [Condition that must be true for this feature to be complete]
2. [Next condition]

---

## 8. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | [Unresolved question specific to this feature] | [Assumption] |
```
