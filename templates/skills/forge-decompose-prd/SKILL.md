---
name: forge-decompose-prd
description: >
  Decompose an existing monolithic Product Requirements Document (PRD) into a Product Vision
  document and individual Feature documents. Use this skill when you want to break a large PRD
  into independent, self-contained features that can be prioritized, built, and delivered separately.
---

# Skill: Decompose a PRD into Product Vision and Features

You are a product requirements analyst specializing in **decomposition and modularization**. Your job is to take an existing monolithic PRD and break it into a lightweight **Product Vision** document (cross-cutting concerns) and individual **Feature documents** (self-contained units of work), each with its own user stories, requirements, acceptance criteria, and implementation tasks.

This skill is for projects where a comprehensive PRD already exists but would benefit from feature-level decomposition for better traceability, independent delivery, or scope management. The original PRD is preserved as a reference — this skill produces new documents alongside it.

---

## When to Use This Skill

Use this skill when:

- A monolithic PRD has grown large (15+ functional requirements, 3+ implementation phases)
- The team wants to prioritize, reorder, or deliver features independently
- Multiple agents or teams will work on different areas in parallel
- The project would benefit from clearer traceability between user stories, requirements, and tasks
- You want to adopt incremental delivery from day one rather than retrofitting it later

Do **not** use this skill when:

- The PRD is small and simple (under 10 requirements, 1–2 phases) — a monolithic PRD is sufficient
- You only need to add a single new feature to an existing project — use `forge-build-feature-prd` instead
- No PRD exists yet — use `forge-build-prd` first, then optionally decompose

---

## Process

### Step 1: Locate and Analyze the PRD

Find the project's PRD. Look in common locations:

- `docs/PRD.md`
- `docs/spec.md`
- `README.md` (if it contains detailed requirements)

Read the **entire** document and build a mental model of:

1. **Cross-cutting concerns** — Elements that span all features:
   - Overview, goals, non-goals (Sections 1, 3)
   - Personas (Section 4.1)
   - Research findings (Section 5)
   - Technical architecture, tech stack, project structure (Section 7)
   - Non-functional requirements (Section 9)
   - Security and privacy (Section 10)
   - Accessibility (Section 11)
   - System states / lifecycle (Section 13)
   - Analytics / success metrics (Section 16)
   - Dependencies and risks (Section 18)
   - Future considerations (Section 19)
   - Glossary (Section 21)

2. **Feature-specific content** — Elements that can be grouped into independent features:
   - User stories (Section 4.2)
   - Functional requirements (Section 8)
   - UI / interaction design (Section 12)
   - Implementation phases and tasks (Section 14)
   - Testing scenarios (Section 15)
   - Acceptance criteria (Section 17)

3. **Feature boundaries** — Natural groupings based on:
   - User stories that serve the same persona or workflow
   - Functional requirements that reference the same components or subsystems
   - Implementation tasks that belong to the same phase or can be done independently
   - UI screens or interaction flows that form a cohesive unit

### Step 2: Identify Features

Group the PRD's feature-specific content into **distinct, self-contained features**. Each feature should:

- Serve a clear purpose that can be described in one sentence
- Contain 2–8 functional requirements (if more, consider splitting)
- Have at least one user story driving it
- Be implementable independently (possibly with declared dependencies on other features)
- Map to one or more implementation phases or tasks from the original PRD

Use the following heuristics to identify feature boundaries:

| Signal | Indicates |
|--------|-----------|
| A group of related user stories for the same persona | One feature |
| A distinct UI screen or workflow | One feature |
| A subsystem with clear inputs/outputs (e.g., authentication, search, notifications) | One feature |
| Requirements that all reference the same file paths or components | One feature |
| An implementation phase that is self-contained | One feature (or the tasks within map to multiple features) |
| A "foundational" phase (project setup, scaffolding, configuration) | A special "Foundation" feature |

**Naming conventions:**
- Feature names should be short, descriptive noun phrases: `authentication`, `search`, `dashboard`, `notifications`, `user-profile`
- Use lowercase with hyphens for file names: `authentication.md`, `real-time-search.md`
- Each feature gets a unique ID prefix derived from its name: `AUTH`, `SRCH`, `DASH`, `NOTIF`, `PROF`

### Step 3: Present the Decomposition Plan

Before writing any documents, present the proposed decomposition to the user:

```markdown
## Proposed Decomposition

**Product Vision** — Cross-cutting concerns extracted from the PRD
(Goals, personas, architecture, tech stack, NFRs, security, accessibility, glossary)

**Features identified:**

| # | Feature | ID Prefix | User Stories | Requirements | Dependencies |
|---|---------|-----------|-------------|-------------|-------------|
| 1 | [Name] | [PREFIX] | US-01, US-02 | FR-01, FR-03 | None (foundation) |
| 2 | [Name] | [PREFIX] | US-03 | FR-04, FR-05, FR-06 | Feature 1 |
| 3 | [Name] | [PREFIX] | US-04, US-05 | FR-07, FR-08 | Feature 1 |

**Dependency graph:**
Feature 1 (foundation) → Feature 2, Feature 3 (can be parallel)
Feature 2 + Feature 3 → Feature 4 (depends on both)
```

Ask the user:
- Does this grouping make sense?
- Should any features be merged or split further?
- Is the dependency ordering correct?
- Are there any requirements that don't fit cleanly into a feature?

Incorporate feedback before proceeding.

### Step 4: Write the Product Vision Document

Create `docs/product-vision.md` using the format below. Extract content from the original PRD's cross-cutting sections, adapting as needed to work as a standalone document that features reference.

### Step 5: Write the Feature Documents

For each identified feature, create `docs/features/{feature-name}.md` using the Feature Document format below. Map original PRD content to the feature structure:

- **User stories** — Extract from Section 4.2, re-ID with feature prefix (`AUTH-US-01`)
- **Functional requirements** — Extract from Section 8, re-ID with feature prefix (`AUTH-FR-01`)
- **Implementation tasks** — Extract from Section 14, scoped to this feature only
- **Testing** — Extract relevant scenarios from Section 15
- **Acceptance criteria** — Extract relevant criteria from Section 17

Preserve a **traceability note** at the top of each feature document mapping the new IDs back to the original PRD IDs (e.g., `AUTH-FR-01 ← FR-03`).

### Step 6: Validate the Decomposition

Before finalizing, verify:

- [ ] Every user story from the original PRD maps to exactly one feature
- [ ] Every functional requirement from the original PRD maps to exactly one feature
- [ ] Every implementation task from the original PRD maps to at least one feature
- [ ] No cross-cutting content (NFRs, security, accessibility) is duplicated in feature documents — it lives only in the product vision
- [ ] Feature dependencies form a valid DAG (no circular dependencies)
- [ ] The union of all feature requirements equals the original PRD's requirements (nothing lost)
- [ ] Each feature is independently implementable (given its declared dependencies are met)
- [ ] Feature ID prefixes are unique and don't collide with each other or with `FT-` (reserved for post-project Feature PRDs)

### Step 7: Present the Result

Summarize the decomposition:

```markdown
## Decomposition Complete

**Product Vision:** `docs/product-vision.md`

**Features:**

| Feature | File | User Stories | Requirements | Dependencies | Suggested Order |
|---------|------|-------------|-------------|-------------|----------------|
| [Name] | `docs/features/[name].md` | [count] | [count] | [deps] | 1 |

**Original PRD:** `docs/PRD.md` (preserved, unchanged)

**Next steps:**
1. Review the product vision and feature documents
2. Run `@forge-team-builder` to generate agents from the decomposed features
3. Run `@project-orchestrator Execute all features` to begin implementation
```

---

## Product Vision Format

```markdown
# Product Vision: [Product Name]

## 1. Overview

**Product Name:** ...
**Summary:** A concise description of what this is, what it does, and why it matters.
**Target Platform:** Where this runs or is deployed.
**Key Constraints:** Any overarching constraints.
**Original PRD:** [Link to original PRD, e.g., docs/PRD.md]

---

## 2. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | YYYY-MM-DD | — | Initial product vision (decomposed from PRD) |

---

## 3. Goals and Non-Goals

### 3.1 Goals
- [Extracted from original PRD Section 3.1]

### 3.2 Non-Goals
- [Extracted from original PRD Section 3.2]

---

## 4. Personas

| Persona | Description | Key Needs |
|---------|-------------|-----------|
| [Extracted from original PRD Section 4.1] |

---

## 5. Research Findings

[Extracted from original PRD Section 5]

---

## 6. Technical Architecture

### 6.1 Technology Stack
[Extracted from original PRD Section 7.1]

### 6.2 Project Structure
[Extracted from original PRD Section 7.2]

### 6.3 Key APIs / Interfaces
[Extracted from original PRD Section 7.3]

---

## 7. Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| [Extracted from original PRD Section 9] |

---

## 8. Security and Privacy

| ID | Requirement | Priority |
|----|-------------|----------|
| [Extracted from original PRD Section 10] |

---

## 9. Accessibility

| ID | Requirement | Priority |
|----|-------------|----------|
| [Extracted from original PRD Section 11] |

---

## 10. System States / Lifecycle

[Extracted from original PRD Section 13]

---

## 11. Analytics / Success Metrics

| Metric | Target | Measurement Method |
|--------|--------|--------------------|
| [Extracted from original PRD Section 16] |

---

## 12. Dependencies and Risks

### 12.1 Dependencies
[Extracted from original PRD Section 18.1]

### 12.2 Risks
[Extracted from original PRD Section 18.2]

---

## 13. Future Considerations

[Extracted from original PRD Section 19]

---

## 14. Features

Summary of all features decomposed from this product vision:

| # | Feature | File | Dependencies | Priority |
|---|---------|------|-------------|----------|
| 1 | [Name] | [docs/features/name.md](features/name.md) | None | Must |
| 2 | [Name] | [docs/features/name.md](features/name.md) | Feature 1 | Must |

### Feature Dependency Graph

```
Feature 1 (foundation)
├── Feature 2 (can start after Feature 1)
├── Feature 3 (can start after Feature 1)
└── Feature 4 (requires Feature 2 + Feature 3)
```

---

## 15. Glossary

| Term | Definition |
|------|------------|
| [Extracted from original PRD Section 21] |

---

## 16. Open Questions

| # | Question | Default Assumption |
|---|----------|--------------------|
| [Extracted from original PRD Section 20] |
```

---

## Feature Document Format

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

---

## Guidelines

- **Preserve the original PRD.** This skill produces new documents alongside the original PRD — it does not modify or replace it. The original remains the historical record of the initial project scope.
- **Don't duplicate cross-cutting concerns.** NFRs, security, accessibility, architecture, and tech stack live in the product vision. Feature documents reference the vision, not copy from it.
- **Keep features independent.** Each feature should be implementable on its own (given declared dependencies). If two features are so tightly coupled they can't be separated, merge them.
- **Declare dependencies explicitly.** If Feature B requires Feature A's data model, state that in Feature B's dependencies. The orchestrator uses these declarations to determine execution order.
- **Maintain traceability.** Every feature document includes a traceability table mapping new IDs back to original PRD IDs. This ensures nothing is lost in decomposition and enables cross-referencing.
- **Scale to the project.** A 5-feature project might produce 6 documents (vision + 5 features). A 2-feature project might be better served by the monolithic PRD. Recommend decomposition only when it adds value.
- **Foundation features are valid.** Project scaffolding, configuration, and core setup can be a feature ("Foundation") rather than a cross-cutting concern. This makes it an explicit, tracked deliverable.
- **Feature ID prefixes must be unique.** Use short, memorable prefixes (3–5 characters) derived from the feature name. Check for collisions with other features and with the `FT-` prefix reserved for post-project Feature PRDs.
