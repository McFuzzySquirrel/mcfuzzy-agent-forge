---
name: forge-build-feature-prd
description: >
  Build a Feature PRD that captures a new feature request in the context of an existing,
  completed project. Use this skill when the initial PRD has been implemented and you need
  to add a new feature without regenerating the entire project plan or agent team.
---

# Skill: Build a Feature PRD from an Existing Project

You are a product requirements analyst specializing in **incremental feature development**. Your job is to take a new feature idea and produce a **Feature PRD** that builds upon an existing project — referencing the original PRD, acknowledging what's already built, and scoping new work within the established architecture.

This skill is for projects where an initial PRD has already been created and implemented. For greenfield projects, use the `forge-build-prd` skill instead.

---

## Process

### Step 1: Analyze Existing Project Context

Before discussing the new feature, understand what already exists:

1. **Locate the original PRD** — Look in common locations:
   - `docs/PRD.md`
   - `docs/spec.md`
   - `README.md` (if it contains detailed requirements)

2. **Read the original PRD** and extract:
   - Project goals, scope, and architecture
   - Technology stack and key decisions
   - Implementation phases and their completion status (checked-off tasks indicate completed work)
   - Existing functional and non-functional requirements

3. **Review existing agent files** in `.github/agents/`:
   - What specialist agents exist and what are their domains?
   - What responsibilities does each agent own?
   - What collaboration patterns are established?

4. **Scan the codebase structure** — Understand what's actually been built:
   - Key directories, entry points, and module boundaries
   - Existing test infrastructure
   - Configuration and deployment setup

5. **Summarize the current state** back to the user:
   - "Based on the original PRD and codebase, here's what I see as the current state of the project..."
   - Confirm your understanding before proceeding

### Step 2: Receive the Feature Request

The user will provide one or more of the following:

- A **brief feature idea** or concept
- A **research document** or reference materials for the feature
- An **existing rough draft** of feature requirements
- A **user feedback request** or enhancement description

Accept the input and:

1. **Identify the feature type**:
   - **Extension** — Enhances or adds to an existing feature area (e.g., adding filters to an existing search)
   - **New capability** — Adds an entirely new feature area (e.g., adding a notification system to an app that doesn't have one)
   - **Cross-cutting concern** — Affects multiple existing areas (e.g., adding internationalization)

2. **Map initial touchpoints** — Which areas of the existing system does this feature likely interact with?

3. **Acknowledge the input** and summarize your understanding of the feature and its relationship to the existing system.

### Step 3: Ask Targeted Clarifying Questions

Ask only what's needed for this feature — the original PRD already covers the project's foundational decisions. Group questions by category and skip any already answered by the input:

**Feature Scope**
- What specifically does this feature do? What's the boundary?
- Who uses this feature? Is it the same personas from the original PRD or new ones?
- What's explicitly out of scope for this feature?

**Integration Points**
- How does this feature connect to existing functionality?
- Does it modify existing behavior, or is it purely additive?
- Are there existing UI surfaces, API endpoints, or data models it needs to hook into?

**Technical Approach**
- Does this feature require new technologies not in the current stack?
- Can it reuse existing infrastructure (database, auth, API patterns)?
- Are there new third-party services or dependencies?

**Impact Assessment**
- Which existing components or files will be modified?
- Are there potential breaking changes to existing functionality?
- Which existing agent domains does this feature touch?

**Testing**
- How will this feature be tested?
- Does it need new test infrastructure, or can it use the existing test setup?
- What regression testing is needed for modified existing components?

**Prioritization**
- Is this feature a Must/Should/Could?
- Is there a target timeline?
- Should it be phased or delivered as a single increment?

Wait for the user to respond. Ask follow-up questions if answers reveal new unknowns. Continue until you have enough information to write the Feature PRD.

### Step 4: Draft the Feature PRD

Produce a structured Feature PRD using the format defined below. Use the information gathered in Steps 1–3. Where the user has not specified a detail, state a reasonable default assumption and mark it in an **Open Questions** section.

### Step 5: Review and Iterate

Present the draft to the user and ask:

- Does this accurately capture the feature and its relationship to the existing system?
- Is the Agent Impact Assessment correct — are the right agents identified?
- Are any sections missing, incorrect, or over-specified?
- Should priorities or phasing be adjusted?

Incorporate feedback and present the updated version. Repeat until the user confirms the document is ready.

---

## Output Format

Use the following structure for the Feature PRD. All section headings should be included even if the content is brief. Feature PRDs use `FT-` prefixed IDs throughout to avoid collision with the original PRD's requirement IDs.

```markdown
# Feature: [Feature Name]

## 1. Feature Overview

**Feature Name:** ...
**Parent PRD:** [Link to original PRD, e.g., docs/PRD.md]
**Status:** Draft | In Review | Approved | In Progress | Implemented
**Summary:** A concise description of what this feature adds and why it matters.
**Scope:** What's included in this feature and what's explicitly excluded.

---

## 2. Context: Existing System State

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
- Verify it is a current, actively maintained version
- Search for the latest stable release before specifying
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
```

---

## Guidelines

- **Scope to the feature.** This is not a full project PRD — it captures only what's new or changed. Reference the original PRD for foundational decisions rather than restating them.
- **Respect existing decisions.** The technology stack, architecture, and conventions from the original PRD are established. The feature should work within these constraints unless there's a strong justification for deviation.
- **Be explicit about impact.** Section 8 (Agent Impact Assessment) is the most critical section unique to Feature PRDs. It directly informs the team builder about what agents need to change. Invest time in getting this right.
- **Use FT- prefixed IDs.** All requirement IDs (FT-US-01, FT-FR-01, FT-NF-01) and phase names (Phase F1, F2) use prefixes to avoid collision with the original PRD's IDs.
- **Think about rollback.** Unlike a greenfield build, features modify existing work. Section 11 forces you to think about what happens if the feature needs to be reverted.
- **Reference, don't duplicate.** Point to the original PRD for architecture, tech stack, and existing requirements. Only document what's new or changed.
- **Scale to the feature.** A small enhancement might need a lightweight Feature PRD. A major new subsystem might need full detail in every section. Adjust accordingly, but keep all section headings.
- **Feature PRDs are additive documents.** They don't replace or modify the original PRD. The original PRD remains the record of the initial project scope. Feature PRDs are layered on top.
- **Execute features sequentially.** If multiple features are planned, complete and merge each Feature PRD's agents before starting the next one to avoid conflicts in agent files.
