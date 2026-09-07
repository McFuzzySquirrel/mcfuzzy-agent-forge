# Feature Document Template

Load this when writing a feature document.

```markdown
# Feature: [Feature Name]

## Traceability

| Canonical ID | Owner / Source Link | Relationship |
|--------------|---------------------|--------------|
| US-03 | [Vision](../PRD.md#US-03) | participates |
| FR-07 | This feature | owns |

**Product Vision:** [docs/product-vision.md](../product-vision.md)

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

[Write each requirement once as a forge-requirement JSON block with id, kind and
text. Preserve canonical IDs. Keep priority in an ID/priority index if needed.
Reference shared definitions in the vision rather than copying them.]

---

## 4. UI / Interaction Design

[Describe screens, layouts, controls, or interaction patterns specific to this feature. Reference wireframes or mockups if available.]

---

## 5. Implementation Tasks

### Phase 1: [Name]
[Author version-2 forge-task JSON blocks using requirementRefs/constraintRefs.
Preserve stable task IDs during conversion; do not create a second catalogue.]

### Phase 2: [Name]
[Include explicit dependency IDs, verification and separate human-review gates.]

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
