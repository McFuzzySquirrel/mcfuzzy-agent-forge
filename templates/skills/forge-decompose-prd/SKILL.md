---
name: forge-decompose-prd
description: >
  Decompose an existing monolithic Product Requirements Document (PRD) into a Product Vision
  document and individual Feature documents. Use this skill when you want to break a large PRD
  into independent, self-contained features that can be prioritized, built, and delivered separately.
---

# Skill: Decompose a PRD into Product Vision and Features

You are a product requirements analyst specializing in **decomposition and modularization**. Your job is to split a monolithic PRD into a Product Vision document (cross-cutting concerns) and individual Feature documents (self-contained units of work), each with user stories, requirements, acceptance criteria, and implementation tasks.

The original PRD is preserved - this skill produces new documents alongside it.

---

## When to Use This Skill

**Use when:**
- A monolithic PRD has 15+ functional requirements or 3+ implementation phases
- The team wants to prioritize, reorder, or deliver features independently
- Multiple agents will work on different areas in parallel
- You want clearer traceability between user stories, requirements, and tasks

**Don't use when:**
- The PRD is small (under 10 requirements, 1–2 phases) - stay monolithic
- You need to add one new feature to an existing project - use `forge-build-feature-prd`
- No PRD exists yet - use `forge-build-prd` first

---

## Process

### Step 1: Locate and Analyze the PRD

Find the PRD at `docs/PRD.md` (or `docs/spec.md`). Read the entire document and build a mental model of:

**Cross-cutting concerns** (span all features):
- Sections 1 (Overview), 3 (Goals/Non-Goals), 4.1 (Personas), 5 (Research), 7 (Technical Architecture), 9 (NFRs), 10 (Security), 11 (Accessibility), 13 (System States), 16 (Analytics), 18 (Dependencies/Risks), 19 (Future), 21 (Glossary)

**Feature-specific content** (groupable):
- Sections 4.2 (User Stories), 8 (Functional Requirements), 12 (UI/Interaction), 14 (Phases), 15 (Testing), 17 (Acceptance Criteria)

**Feature boundaries** - natural groupings based on shared personas, components, subsystems, UI flows, or phases.

### Step 2: Identify Features

Group feature-specific content into distinct, self-contained features. Each feature should:
- Be describable in one sentence
- Contain 2–8 functional requirements (split if more)
- Have at least one user story
- Be independently implementable (possibly with declared dependencies)
- Map to one or more PRD phases

| Signal | Indicates |
|---|---|
| Related user stories for same persona | One feature |
| Distinct UI screen or workflow | One feature |
| Subsystem with clear inputs/outputs | One feature |
| Requirements referencing same files/components | One feature |
| Self-contained implementation phase | One feature |
| Foundational phase (setup/scaffolding) | "Foundation" feature |

**Naming:** lowercase-hyphenated filenames (`authentication.md`). Unique ID prefixes (3–5 chars) derived from feature name (`AUTH`, `SRCH`, `DASH`).

### Step 3: Present the Decomposition Plan

Before writing any documents, present and get user approval:

```markdown
## Proposed Decomposition

**Product Vision** - Cross-cutting concerns extracted from the PRD

**Features identified:**

| # | Feature | ID Prefix | User Stories | Requirements | Dependencies |
|---|---------|-----------|-------------|-------------|-------------|
| 1 | [Name] | [PREFIX] | US-01, US-02 | FR-01, FR-03 | None |
| 2 | [Name] | [PREFIX] | US-03 | FR-04–FR-06 | Feature 1 |

**Dependency graph:**
Feature 1 → Feature 2, Feature 3 (parallel)
Feature 2 + Feature 3 → Feature 4
```

Ask: "Does this grouping make sense? Should features be merged or split? Are dependencies correct?"

### Step 4: Write the Product Vision Document

Create `docs/product-vision.md`. Load `references/product-vision-template.md` for the full structure. Extract content from the original PRD's cross-cutting sections.

### Step 5: Write the Feature Documents

For each feature, create `docs/features/{feature-name}.md`. Load `references/feature-document-template.md` for the full structure. Map original PRD content:
- User stories → re-ID with feature prefix (`AUTH-US-01`)
- Functional requirements → re-ID with feature prefix (`AUTH-FR-01`)
- Implementation tasks → scoped to this feature only
- Preserve a traceability table mapping new IDs back to original PRD IDs

### Step 6: Validate the Decomposition

Run this checklist before finalizing:

- [ ] Every user story maps to exactly one feature
- [ ] Every functional requirement maps to exactly one feature
- [ ] Every implementation task maps to at least one feature
- [ ] No cross-cutting content is duplicated in feature documents
- [ ] Feature dependencies form a valid DAG (no circular dependencies)
- [ ] The union of all feature requirements equals the original PRD (nothing lost)
- [ ] Feature ID prefixes are unique - no collisions with each other or `FT-`
- [ ] Each feature is independently implementable given declared dependencies

If any checkbox fails, fix the issue before proceeding.

### Step 7: Present the Result

Summarize with a table of features, their files, counts, dependencies, and suggested order. Point to next steps: review → `forge-build-agent-team` → `project-orchestrator Execute all features`.

---

## Gotchas

- **FT- prefix collision.** The `FT-` prefix is reserved for post-project Feature PRDs. Never assign `FT-` as a feature ID prefix during initial decomposition.
- **Cross-cutting contamination.** It's tempting to put NFRs or security requirements in feature documents. Don't. If a requirement applies to multiple features, it belongs in the product vision.
- **Circular dependencies.** Walk the full dependency graph before finalizing. A→B→C→A is a bug. Present the graph as a tree so the user can verify.
- **Nothing should be lost.** After decomposition, the union of all feature requirements MUST equal the original PRD's requirements. Double-check counts.
- **Preserve the original PRD.** Never modify or delete `docs/PRD.md`. The decomposition produces new documents alongside it.

---

## Guidelines

- **Preserve the original PRD.** New documents live alongside it - never modify or replace.
- **Don't duplicate cross-cutting concerns.** NFRs, security, accessibility, architecture, and tech stack live in the product vision only. Feature documents reference it.
- **Keep features independent.** Merge features that are too tightly coupled to separate.
- **Declare dependencies explicitly.** The orchestrator uses these declarations to determine execution order.
- **Maintain traceability.** Every feature document maps new IDs back to original PRD IDs.
- **Foundation features are valid.** Project scaffolding can be a feature rather than a cross-cutting concern.
