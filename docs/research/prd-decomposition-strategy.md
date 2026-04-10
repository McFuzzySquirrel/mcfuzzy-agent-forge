# Research: PRD Decomposition Strategy — Breaking Monolithic PRDs into Features

**Date:** 2026-04-09
**Status:** Research Complete

---

## Question

The current PRD creation flow produces a single monolithic document. Would it make more sense to break the PRD into features and user stories from day one, rather than only supporting feature-level decomposition as a post-project addition? What changes are needed to support this without breaking the existing pipeline?

---

## Current State Analysis

### What Exists Today

The framework operates on a **single-PRD, single-team-generation model** for initial project builds, with feature-level work supported only as a post-project addon:

| Component | Current Behavior | Limitation |
|-----------|-----------------|------------|
| `forge-build-prd` skill | Creates one comprehensive PRD with embedded user stories, requirements, and phases | No decomposition into independent features; all requirements in flat tables |
| `forge-build-feature-prd` skill | Creates Feature PRDs for post-project additions | Assumes project is already complete; requires "Context: Existing System State" |
| `forge-build-agent-team` skill | Full Build Mode from single PRD, or Feature Increment Mode from Feature PRDs | No support for building a team from a product vision + multiple feature docs |
| `project-orchestrator` agent | Executes PRD phases or Feature PRD phases | Feature execution is a secondary mode; no dependency ordering between features |
| `forge-team-builder` agent | Routes to PRD skill or feature PRD skill | No awareness of decomposition workflow |

### Gap Analysis

1. **No decomposition path** — Users with a monolithic PRD cannot break it into features without manually splitting the document.
2. **Feature PRDs assume completion** — The `forge-build-feature-prd` skill requires a completed project context, making it unsuitable for initial feature decomposition.
3. **No product vision concept** — Cross-cutting concerns (architecture, tech stack, NFRs, security, accessibility) have no standalone home outside the monolithic PRD.
4. **No feature dependency tracking** — Features reference the original PRD but not each other.
5. **Single-document assumption** — Both `forge-build-agent-team` and `project-orchestrator` assume a single authoritative PRD document.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Breaking existing monolithic PRD workflow | Low | High | All changes are additive; `forge-build-prd` remains unchanged |
| Feature decomposition creating too many small documents | Medium | Medium | Provide guidance on when decomposition is appropriate vs. overkill |
| Cross-cutting concerns lost in decomposition | Medium | High | Product Vision document explicitly owns NFRs, architecture, security, accessibility |
| Inter-feature dependency conflicts | Medium | Medium | Explicit dependency declarations in feature docs; orchestrator validates before execution |
| Agent boundary conflicts across features | Low | Medium | Agent team builder aggregates all feature requirements before generating boundaries |

---

## Implementation Plan

### Approach: Hybrid — Keep Monolithic, Add Decomposition

The most pragmatic approach is to keep the monolithic PRD as an option for simple projects while adding first-class support for feature decomposition as an alternative path. This leverages the feature infrastructure that's already ~70% built.

### Changes Required

#### 1. New Skill: `forge-decompose-prd` (new file)

**File:** `templates/skills/forge-decompose-prd/SKILL.md`

Creates a new skill that takes an existing monolithic PRD and decomposes it into:
- A **Product Vision** document (overview, goals, personas, architecture, tech stack, NFRs, security, accessibility, glossary)
- Individual **Feature documents** (user stories, functional requirements, acceptance criteria, implementation tasks, testing)

Key design decisions:
- Product Vision retains Sections 1–7 and 9–13 from the PRD format (the cross-cutting concerns)
- Features are extracted from Sections 4.2 (User Stories), 8 (Functional Requirements), and 14 (Implementation Phases)
- Feature IDs use the format `{FEATURE-PREFIX}-US-01`, `{FEATURE-PREFIX}-FR-01` to avoid collision
- Each feature includes a dependency declaration for inter-feature ordering
- The skill outputs files to `docs/product-vision.md` and `docs/features/*.md`

#### 2. Extend: `forge-build-feature-prd` (modify existing)

**File:** `templates/skills/forge-build-feature-prd/SKILL.md`

Changes:
- Make "Context: Existing System State" (Section 2) conditional — required for post-project features, optional for greenfield features during initial decomposition
- Make "Agent Impact Assessment" (Section 8) conditional — required for post-project features, optional for greenfield features
- Add a mode detection similar to `forge-build-agent-team`'s Step 0: detect whether this is a greenfield feature (no existing agents) or a post-project feature (existing agents present)
- For greenfield features, simplify the output format: drop the existing-system-awareness sections, keep the core feature structure (overview, user stories, requirements, phases, testing, acceptance criteria)

#### 3. Extend: `forge-build-agent-team` (modify existing)

**File:** `templates/skills/forge-build-agent-team/SKILL.md`

Changes:
- Add a third mode to Step 0: **Vision + Features Mode** — detected when a product vision document exists alongside feature documents in `docs/features/`
- Add Steps 1v–8v for Vision + Features Mode:
  - Step 1v: Read the product vision for architecture, tech stack, and cross-cutting concerns
  - Step 2v: Read all feature documents and aggregate requirements
  - Step 3v: Identify specialist roles across all features (same heuristics as Step 2)
  - Step 4v–8v: Follow existing Steps 3–8 but sourcing requirements from multiple feature docs
- The existing Full Build Mode (Steps 1–8) and Feature Increment Mode (Steps 1i–7i) remain unchanged

#### 4. Extend: `project-orchestrator` (modify existing)

**File:** `templates/agents/project-orchestrator.md`

Changes:
- Add a new Section 1c: "Analyze Product Vision and Feature Documents" — for when the project uses decomposed features instead of a monolithic PRD
- Add feature dependency ordering: read dependency declarations from each feature doc and build a dependency graph to determine execution order
- Add new commands: `Execute all features`, `Execute feature docs/features/auth.md`, `Execute features in order`
- Extend the `docs/PROGRESS.md` format to track feature-level progress in addition to phase-level
- The existing monolithic PRD execution (Sections 1–6) and Feature PRD execution (Section 1b) remain unchanged

#### 5. Update: `forge-team-builder` (modify existing)

**File:** `templates/agents/forge-team-builder.md`

Changes:
- Add awareness of the decomposition workflow in the Process section
- Add the `forge-decompose-prd` skill to the Collaboration section
- Add routing guidance: when to recommend decomposition vs. monolithic PRD

#### 6. Update: `README.md` (modify existing)

Changes:
- Add the decomposition workflow to the "How it works" section
- Document the new `forge-decompose-prd` skill
- Add a section comparing monolithic vs. decomposed approaches

---

## Benefits

1. **Backward compatible** — Existing monolithic PRD workflow is completely unchanged
2. **Leverages existing infrastructure** — Feature PRD format, agent increment mode, and feature execution mode are already built
3. **User choice** — Teams can choose the approach that fits their project size and complexity
4. **Incremental adoption** — Users can start with a monolithic PRD and decompose later using `forge-decompose-prd`
5. **Better traceability** — Feature-level user stories → requirements → tasks form clear chains
6. **Natural incremental delivery** — Features can be prioritized, reordered, and shipped independently

---

## Summary

| Item | Action | Risk |
|------|--------|------|
| `forge-build-prd` | No changes (backward compatible) | None |
| `forge-decompose-prd` | New skill | Low — additive only |
| `forge-build-feature-prd` | Extend for greenfield features | Low — conditional logic, no behavior change for existing use |
| `forge-build-agent-team` | Add Vision + Features Mode | Low — new mode alongside existing modes |
| `project-orchestrator` | Add feature dependency ordering | Low — extends existing feature execution |
| `forge-team-builder` | Add decomposition routing | Low — documentation update |
| `README.md` | Add decomposition workflow | Low — documentation |
| Bootstrap scripts | No changes (auto-discover) | None |
