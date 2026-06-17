# Feature PRD Output Format Template

This is the authoritative template for Feature PRDs. Load this when drafting or reviewing a Feature PRD.

# Feature: [Feature Name]

## 1. Feature Overview

**Feature Name:** ...
**Parent Document:** [Link to original PRD or product vision, e.g., docs/PRD.md or docs/product-vision.md]
**Status:** Draft | In Review | Approved | In Progress | Implemented
**Summary:** A concise description of what this feature does and why it matters.
**Scope:** What's included in this feature and what's explicitly excluded.
**Dependencies:** [List of features this depends on, or "None"]

---

## 2. Context: Existing System State

> **Note:** This section is required in **post-project mode** (adding to an existing project). In **greenfield mode** (initial project decomposition), replace with a brief note: "Greenfield feature — no existing system. See Product Vision at [path]."

**Completed PRD Phases:** List which phases from the original PRD are complete (with checkmarks).
**Relevant Existing Components:** Which parts of the existing system this feature touches (files, modules, services).
**Existing Agents Involved:** Which current agents' domains this feature falls within.
**Established Conventions:** Key architectural or coding conventions from the original project that this feature must follow.

---

## 3. Feature Goals and Non-Goals

### 3.1 Goals
- What this feature achieves (bulleted list of outcomes)

### 3.2 Non-Goals
- What this feature explicitly does not change about the existing system
- Existing behavior that must remain untouched

---

## 4. User Stories

| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| FT-US-01 | [persona] | [action] | [outcome] | Must / Should / Could |

---

## 5. Technical Approach

### 5.1 Impact on Existing Architecture
What existing components/files change and how. Be specific about which files are modified and what changes.

### 5.2 New Components
What new components/files are needed. Include proposed file paths.

### 5.3 Technology Additions
Any new technologies, libraries, or tools required. For each:
- Search for the latest stable release and verify it is a current, actively maintained version before specifying
- Check the official documentation or package registry for the latest version rather than relying on training data
- Flag any compatibility considerations with the existing stack

---

## 6. Functional Requirements

| ID | Requirement | Affects Existing | Priority |
|----|-------------|-----------------|----------|
| FT-FR-01 | Description of the requirement | Yes/No (which component if yes) | Must / Should / Could |

---

## 7. Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FT-NF-01 | Performance, security, accessibility requirements specific to this feature | Must / Should / Could |

---

## 8. Agent Impact Assessment

> **Note:** This section is required in **post-project mode** (adding to an existing project with existing agents). In **greenfield mode** (initial project decomposition), this section is optional — if agents haven't been generated yet, note: "Greenfield feature — agents will be generated from all feature documents together."

### 8.1 Existing Agents — Extended Responsibilities

| Agent | New Responsibilities | Modified Boundaries |
|-------|---------------------|-------------------|
| `existing-agent` | What they now also need to do | How their boundary changes |

### 8.2 New Agents Required

| Agent | Role | Why Existing Agents Can't Cover This |
|-------|------|--------------------------------------|
| `new-agent` | What they specialize in | Justification for why this can't be handled by an existing agent |

### 8.3 Existing Agents — No Changes

| Agent | Reason |
|-------|--------|
| `unaffected-agent` | Not involved in this feature |

---

## 9. Implementation Phases

### Phase F1: [Name]
- [ ] Task 1
- [ ] Task 2

### Phase F2: [Name]
- [ ] Task 1
- [ ] Task 2

---

## 10. Testing Strategy

How this feature will be tested:

| Level | Scope | Approach |
|-------|-------|----------|
| Unit Tests | New feature code | ... |
| Integration Tests | Feature + existing system | ... |
| Regression Tests | Affected existing components | ... |

Key test scenarios as a numbered checklist.

---

## 11. Rollback Considerations

What happens if this feature needs to be reverted:
- Which existing files were modified (and what changed)?
- Which new files can simply be removed?
- Are there database migrations or data changes that need rollback?
- Which tests verify the original behavior still works?

---

## 12. Acceptance Criteria

Numbered list of conditions for this feature to be considered complete.

---

## 13. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | Unresolved question | What we'll assume if not answered |
