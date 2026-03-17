# Research: Feature PRD Strategy — Handling New Features After Initial PRD Completion

**Date:** 2026-03-17
**Status:** Implemented

---

## Question

Now that we have the agent-forge working, how do we tackle new feature requests once the initial PRD has been completed? We need a way to create a "feature PRD" that takes into account what was done and completed according to the original PRD, so that the agent team builder can either reuse existing agents or add new ones depending on what the feature requires. How do we implement this without breaking the current working solution?

---

## Current State Analysis

### What Exists Today

The framework currently operates on a **single-PRD, single-team-generation model**. The entire workflow assumes one comprehensive PRD drives one agent team generation:

| Component | Current Behavior | Limitation |
|-----------|-----------------|------------|
| `forge-build-prd` skill | Creates a comprehensive PRD from scratch | No awareness of existing PRDs or completed work |
| `forge-build-agent-team` skill | Generates a full team from a PRD | Regenerates the entire team each time; no concept of "extend existing team" |
| `forge-team-builder` agent | Analyzes a PRD and designs a complete agent team | No diffing against existing agents; would overwrite or duplicate |
| `project-orchestrator` agent | Executes PRD phases sequentially | Phase-aware but not feature-increment-aware; no concept of "this is new work on top of completed phases" |

### What the README Already Hints At

The README includes this guidance for manual agent calling (line 183–186):

> *This manual approach is useful when:*
> - *You're working on a specific feature increment*
> - *You want fine-grained control over what gets built*
> - *You're iterating on existing code rather than building from scratch*

And the FAQ (line 374):

> *Q: How do I update agents when my PRD changes?*
> *A: Re-run the team builder. It will regenerate agents based on the new PRD. Review diffs before committing.*

These acknowledge the scenario exists but offer only a manual/regeneration approach — no structured process for incremental feature development.

### What Does NOT Exist

1. **Feature PRD template** — No document format for capturing a new feature in the context of an existing, completed project
2. **Existing-state awareness** — No mechanism for the PRD builder or team builder to analyze what's already built (completed PRD phases, existing agents, existing codebase)
3. **Agent reuse analysis** — No process for evaluating which existing agents can handle the new work vs. which new agents are needed
4. **Incremental team modification** — No way to extend an existing agent team without regenerating the entire set
5. **Feature-to-original-PRD traceability** — No versioning or linking between an original PRD and subsequent feature PRDs
6. **Impact analysis** — No process for understanding how a new feature affects existing components, agents, and boundaries

---

## Key Challenges and Considerations

### 1. Preserving Existing Agent Customizations

**Problem:** After the initial build, users will have customized their generated agents — tweaked responsibilities, refined constraints, adjusted collaboration sections. A naive "regenerate the team" approach would overwrite these customizations.

**What we need to think about:**
- Existing agents may have been manually refined beyond what was originally generated
- Simply re-running the team builder from a combined PRD would produce a clean-slate team, losing customizations
- We need a process that respects the existing team and only adds/modifies what's needed

### 2. Understanding Completed State

**Problem:** A feature PRD needs context about what's already been built. Without knowing the current state, the PRD builder might ask redundant questions, and the team builder might create agents that duplicate existing capabilities.

**What we need to think about:**
- The original PRD's completed phases tell us what's done
- The existing agent files in `.github/agents/` tell us what capabilities exist
- The codebase itself tells us what's actually been implemented
- The feature PRD needs to reference and build upon this existing context, not start fresh

### 3. Agent Boundary Evolution

**Problem:** A new feature might cross the boundaries of existing agents. For example, adding a "real-time notifications" feature might touch the frontend specialist, the API engineer, and require a new WebSocket specialist.

**What we need to think about:**
- Some features fit cleanly into one existing agent's domain
- Some features span multiple existing agents' domains
- Some features require entirely new expertise not covered by the existing team
- Agent boundaries may need to be adjusted, not just added to

### 4. Orchestrator Continuity

**Problem:** The project orchestrator currently executes phases from a single PRD sequentially. A feature PRD introduces new phases that need to execute in the context of an already-completed project.

**What we need to think about:**
- The orchestrator needs to understand "this is additive work, not a from-scratch build"
- Dependencies may reference both new feature PRD tasks and existing completed work
- The orchestrator should know which agents are pre-existing vs. newly created for this feature

### 5. PRD Versioning and Traceability

**Problem:** Over time, a project may accumulate multiple feature PRDs. Without clear versioning and linking, it becomes hard to understand the full scope of what was planned and built.

**What we need to think about:**
- How feature PRDs reference the original PRD
- How to track which feature PRDs have been implemented
- How requirement IDs avoid collisions across PRDs (e.g., `FR-01` in the original vs. `FR-01` in a feature PRD)

### 6. Backward Compatibility

**Problem:** Any changes we make must not break the existing workflow. Users who want to create a fresh PRD and generate a fresh team should still be able to do exactly that.

**What we need to think about:**
- The new feature PRD skill should be a separate skill, not a modification to the existing `forge-build-prd` skill
- The team builder enhancement should be additive — the existing "generate from scratch" path must still work
- The orchestrator changes should detect whether it's working from a feature PRD vs. original PRD automatically

---

## Proposed Solution: Feature PRD and Incremental Team Building

### Concept Overview

We introduce **three new capabilities** alongside the existing ones:

1. **`forge-build-feature-prd` skill** — A new skill (not a replacement for `forge-build-prd`) that creates feature PRDs aware of the existing project context
2. **Incremental team analysis in `forge-build-agent-team`** — An additional step in the existing team builder skill that can analyze existing agents and recommend additions/modifications rather than regenerating everything
3. **Feature execution mode in `project-orchestrator`** — An additional command/mode for the orchestrator to execute feature PRDs in the context of an existing, completed project

### Why Three Separate Changes (Not One Big One)

Each change addresses a distinct phase of the workflow:

```
Feature Idea → [forge-build-feature-prd] → Feature PRD
                                                ↓
Existing Agents + Feature PRD → [forge-build-agent-team + incremental mode] → Team Updates
                                                                                  ↓
Existing Project + Updated Team + Feature PRD → [project-orchestrator + feature mode] → Implementation
```

This mirrors the existing flow (idea → PRD → team → build) but with awareness of the existing project at each step.

---

## Detailed Design

### 1. New Skill: `forge-build-feature-prd`

**Purpose:** Create a feature PRD that builds upon an existing completed project.

**Why a separate skill (not modifying `forge-build-prd`):**
- The existing PRD builder is for greenfield projects — its process flow, questions, and output format are designed for building from nothing
- A feature PRD has fundamentally different needs: it must analyze what exists, understand constraints imposed by prior decisions, and scope new work within an established architecture
- Keeping them separate means neither skill becomes overloaded with conditional logic
- Users can still use `forge-build-prd` for new projects without any changes

**Proposed Process:**

```
Step 1: Analyze Existing Project Context
  - Read the original PRD (locate it, summarize completed scope)
  - Review existing agent files (what capabilities exist in the team)
  - Scan the codebase structure (what's actually built)
  - Summarize the current state back to the user

Step 2: Receive the Feature Request
  - Accept the user's feature idea, requirement, or research
  - Identify which areas of the existing system it touches
  - Determine if it's an extension of existing features, a new feature, or a cross-cutting concern

Step 3: Ask Targeted Clarifying Questions
  (Scoped to the feature, not the whole project)
  - Feature Scope: What does this feature do? Who uses it? What's the boundary?
  - Integration Points: How does this connect to existing functionality?
  - Technical Approach: Does this require new tech not in the current stack? Can it use existing infrastructure?
  - Impact Assessment: Which existing components are affected? Are there breaking changes?
  - Testing: How will this feature be tested? Does it need new test infrastructure?
  - Prioritization: Is this a Must/Should/Could?

Step 4: Draft the Feature PRD
  (Using a Feature PRD-specific format — see Output Format below)

Step 5: Review and Iterate
  - Present draft, gather feedback, refine
```

**Proposed Feature PRD Output Format:**

```markdown
# Feature: [Feature Name]

## 1. Feature Overview
**Feature Name:** ...
**Parent PRD:** [Link to original PRD]
**Summary:** What this feature adds and why
**Scope:** What's included and what's explicitly excluded

## 2. Context: Existing System State
**Completed PRD Phases:** List which phases from the original PRD are complete
**Relevant Existing Components:** Which parts of the existing system this feature touches
**Existing Agents Involved:** Which current agents' domains this feature falls within

## 3. Feature Goals and Non-Goals
### 3.1 Goals
- What this feature achieves
### 3.2 Non-Goals
- What this feature explicitly does not change about the existing system

## 4. User Stories
| ID | As a... | I want to... | So that... | Priority |
|----|---------|-------------|-----------|----------|
| FT-US-01 | ... | ... | ... | Must/Should/Could |

(Note: Feature user story IDs use FT- prefix to avoid collision with original PRD IDs)

## 5. Technical Approach
### 5.1 Impact on Existing Architecture
What existing components/files change and how
### 5.2 New Components
What new components/files are needed
### 5.3 Technology Additions
Any new technologies, libraries, or tools required (with currency verification)

## 6. Functional Requirements
| ID | Requirement | Affects Existing | Priority |
|----|-------------|-----------------|----------|
| FT-FR-01 | ... | Yes/No (which component) | Must/Should/Could |

## 7. Non-Functional Requirements
| ID | Requirement | Priority |
|----|-------------|----------|
| FT-NF-01 | ... | Must/Should/Could |

## 8. Agent Impact Assessment
### 8.1 Existing Agents — Extended Responsibilities
| Agent | New Responsibilities | Modified Boundaries |
|-------|---------------------|-------------------|
| `existing-agent` | What they now also need to do | How their boundary changes |

### 8.2 New Agents Required
| Agent | Role | Why Existing Agents Can't Cover This |
|-------|------|--------------------------------------|
| `new-agent` | ... | ... |

### 8.3 Existing Agents — No Changes
| Agent | Reason |
|-------|--------|
| `unaffected-agent` | Not involved in this feature |

## 9. Implementation Phases
### Phase F1: [Name]
(Feature phases use F-prefix to distinguish from original PRD phases)
- [ ] Task 1
- [ ] Task 2

## 10. Testing Strategy
How this feature will be tested, including regression testing for affected existing components

## 11. Rollback Considerations
What happens if this feature needs to be reverted? Which existing components were modified?

## 12. Acceptance Criteria
Numbered list of conditions for this feature to be considered complete

## 13. Open Questions
| # | Question | Default Assumption |
|---|----------|--------------------|
| 1 | ... | ... |
```

**Key design decisions:**
- **Prefixed IDs** (FT-US-01, FT-FR-01, FT-NF-01, Phase F1) prevent collision with original PRD requirement IDs
- **Section 2 (Existing System State)** forces the PRD to acknowledge what's already built
- **Section 8 (Agent Impact Assessment)** is unique to feature PRDs — it explicitly analyzes which existing agents are affected and whether new agents are needed, giving the team builder a head start
- **Section 11 (Rollback Considerations)** addresses the risk of modifying existing components

---

### 2. Enhancement: Incremental Team Analysis in `forge-build-agent-team`

**Purpose:** Add an alternative entry point to the team builder skill that analyzes a feature PRD in context with existing agents, rather than generating a complete team from scratch.

**Why modify the existing skill (not create a new one):**
- The core logic of "analyze PRD → identify roles → write agent files → validate" is the same
- The change is additive — a new initial step that detects the scenario, not a rewrite of existing steps
- Skills should be reusable processes; team building is one process with two modes

**Proposed Changes:**

Add a new **Step 0** before the existing Step 1, and modify subsequent steps to support incremental mode:

```markdown
### Step 0: Detect Mode — Full Build vs. Feature Increment

Before analyzing the PRD, determine which mode to operate in:

**Full Build Mode** (current behavior, unchanged):
- The PRD is a complete project PRD (has Overview, Technical Architecture, full Implementation Phases)
- No existing agent files in `.github/agents/` beyond the forge templates
- Proceed with the existing Step 1–8 process unchanged

**Feature Increment Mode** (new behavior):
- The document is a Feature PRD (has "Feature Overview", "Existing System State", "Agent Impact Assessment")
- Existing agent files already exist in `.github/agents/`
- Switch to the incremental analysis process (Steps 1i–8i below)
```

**Incremental steps (Steps 1i–8i):**

```
Step 1i: Analyze the Feature PRD AND Existing Team
  - Read the Feature PRD (focus on Sections 5–8: Technical Approach, Requirements, Agent Impact)
  - Read ALL existing agent files in .github/agents/
  - Read the original PRD to understand the full project context
  - Build a map of existing agent domains and boundaries

Step 2i: Evaluate Agent Impact Assessment
  - Review the Feature PRD's Section 8 (Agent Impact Assessment) as a starting point
  - Validate: Does each "extended responsibility" actually fit within the agent's expertise?
  - Validate: Are the "new agents required" truly needed, or can existing agents cover the work?
  - Produce a revised assessment

Step 3i: Plan Team Modifications
  For each change category:
  
  A. Existing agents with extended responsibilities:
     - Draft updated Responsibilities sections (additive only)
     - Draft updated Collaboration sections if new dependencies exist
     - DO NOT modify Expertise, Constraints, or Output Standards unless necessary
  
  B. New agents required:
     - Follow the existing Steps 2–5 process for designing and writing new agents
     - Ensure new agents have Collaboration links to existing agents
     - Ensure no boundary overlaps with existing agents
  
  C. Existing agents with no changes:
     - Leave untouched (do not regenerate)

Step 4i: Identify New or Extended Skills
  - Are there new repeatable patterns introduced by this feature?
  - Can existing skills be reused for the new feature's tasks?
  - Only create new skills if the pattern will be invoked multiple times

Step 5i: Write Only Changed/New Files
  - For modified agents: Present the DIFF (what's being added/changed), not the full regenerated file
  - For new agents: Write complete agent files following the standard template
  - For new skills: Write complete skill files following the standard template
  - CRITICAL: Do NOT regenerate or overwrite agents that aren't affected by the feature

Step 6i: Validate Incrementally
  - Every Feature PRD requirement maps to exactly one agent (new or existing)
  - No new boundary overlaps introduced
  - Collaboration sections updated for all affected agents
  - Existing unaffected agents remain unchanged
  - New agents follow all naming and format conventions

Step 7i: Present the Changes
  Summarize in tables:
  
  ## Modified Agents
  | Agent | Changes | Feature PRD Sections |
  |-------|---------|---------------------|
  | `existing-agent` | Added responsibilities for X | FT-FR-01, FT-FR-03 |
  
  ## New Agents
  | Agent | Role | Feature PRD Sections | Phase |
  |-------|------|---------------------|-------|
  | `new-agent` | ... | FT-FR-02, FT-FR-04 | F1 |
  
  ## Unchanged Agents
  | Agent | Reason |
  |-------|--------|
  | `unaffected-agent` | Not involved in this feature |
  
  ## New Skills
  | Skill | Purpose | Used By |
  |-------|---------|---------|
  | `new-skill` | ... | ... |
```

**Key design decisions:**
- **Auto-detection** — The skill automatically determines whether it's in "full build" or "feature increment" mode based on document structure and existing agents. No user action needed.
- **Diff-based modifications** — For existing agents, it presents what changes rather than regenerating the full file, making it easy to review and approve
- **Unchanged agents listed** — Explicitly listing untouched agents gives confidence that existing work is preserved
- **Backward compatible** — The existing Steps 1–8 remain completely unchanged; the incremental steps are an alternative path

---

### 3. Enhancement: Feature Execution Mode in `project-orchestrator`

**Purpose:** Add a command mode for the orchestrator to execute feature PRD phases in the context of an existing, completed project.

**Why modify the existing agent (not create a new one):**
- The orchestrator is already the single point of coordination — adding a second orchestrator would create confusion
- Feature execution uses the same patterns (sequential tasks, multi-agent deliverables, etc.)
- The change is a new command and a modified Phase 1 analysis, not a rewrite

**Proposed Changes:**

Add new commands:

```markdown
- `@project-orchestrator Execute feature docs/features/notifications.md`
  → Execute a feature PRD's implementation phases

- `@project-orchestrator Execute feature docs/features/notifications.md Phase F1`
  → Execute a specific phase from a feature PRD
```

Add a feature-aware analysis step:

```markdown
### 1b. Analyze Feature PRD and Existing Project (Feature Mode)

When executing a feature PRD (detected by "Feature Overview" section or explicit "Execute feature" command):

1. **Read the Feature PRD** to understand:
   - Feature scope and goals
   - Impact on existing components (Section 5.1)
   - New components required (Section 5.2)
   - Implementation phases (F-prefixed phases)

2. **Read the Original PRD** to understand:
   - What was already built and which phases are complete
   - The established architecture and tech stack
   - Constraints and conventions already in place

3. **Review all agent files** in `.github/agents/`:
   - Identify which agents have been modified for this feature (new responsibilities)
   - Identify which agents are newly created for this feature
   - Understand which agents are unchanged and don't need to be called

4. **Verify feature tech stack currency** (if new technologies are introduced):
   - Only verify technologies that are NEW to this feature, not the entire existing stack
   - Report findings before proceeding

5. **Build the feature execution plan**:
   - Map each feature requirement to the owning agent
   - Identify dependencies on existing completed work (reference, don't rebuild)
   - Identify dependencies between new feature tasks
   - Note which tasks modify existing code vs. create new code
```

Add feature-specific orchestration guidance:

```markdown
### Feature Orchestration Guidelines

- **Never re-execute original PRD phases** — Reference existing work, don't rebuild it
- **Regression awareness** — When a task modifies existing code, note which existing tests should be re-run
- **Feature phase naming** — Use F-prefixed phases (Phase F1, F2) to distinguish from original phases
- **Mixed agent calls** — A feature may require calling both existing agents (for modifications) and new agents (for new components)
- **Rollback tracking** — Keep a list of modified existing files so the feature could be reverted if needed
```

**Key design decisions:**
- **Explicit command** (`Execute feature X`) — The user clearly indicates they're working on a feature, not re-running the original build
- **Original PRD awareness** — The orchestrator reads both PRDs to understand the full context
- **Regression consciousness** — When modifying existing code, the orchestrator proactively considers testing impact
- **Backward compatible** — All existing commands (`Execute the full build`, `Execute Phase 1`, etc.) work exactly as before

---

## Implementation Plan

### Overview of Changes

| Change | Type | File(s) | Effort | Impact | Breaking? |
|--------|------|---------|--------|--------|-----------|
| Create `forge-build-feature-prd` skill | New file | `templates/skills/forge-build-feature-prd/SKILL.md` | Medium | High — enables the core workflow | No |
| Add incremental mode to team builder skill | Modify existing | `templates/skills/forge-build-agent-team/SKILL.md` | Medium | High — enables agent reuse | No |
| Update `forge-team-builder` agent | Modify existing | `templates/agents/forge-team-builder.md` | Small | Medium — agent awareness of incremental mode | No |
| Add feature execution mode to orchestrator | Modify existing | `templates/agents/project-orchestrator.md` | Medium | High — enables feature execution | No |
| Update bootstrap scripts | Modify existing | `scripts/bootstrap.sh`, `scripts/bootstrap.ps1` | Small | Low — include new skill in bootstrap | No |
| Update README | Modify existing | `README.md` | Small | Medium — document the new workflow | No |

**Total scope:** 1 new file + 5 modified files. No structural changes. Fully backward compatible.

### Recommended Implementation Order

1. **First:** Create `forge-build-feature-prd` skill — This is the entry point for the new workflow and can be used independently even before other changes
2. **Second:** Add incremental mode to `forge-build-agent-team` skill — This enables the team builder to work with feature PRDs
3. **Third:** Update `forge-team-builder` agent — Align the agent with the skill's new incremental mode
4. **Fourth:** Add feature execution mode to `project-orchestrator` — Complete the end-to-end feature workflow
5. **Fifth:** Update bootstrap scripts and README — Documentation and deployment support

### Change 1: Create `forge-build-feature-prd` Skill

**New file:** `templates/skills/forge-build-feature-prd/SKILL.md`

Create a complete skill file following the detailed design in the "New Skill: `forge-build-feature-prd`" section above. The skill should:

- Follow the same YAML frontmatter and markdown format as `forge-build-prd`
- Include the 5-step process (Analyze Context → Receive Request → Clarify → Draft → Iterate)
- Use the Feature PRD output format with prefixed IDs and context-aware sections
- Reference the original PRD explicitly
- Include guidelines specific to feature PRDs (scope management, impact assessment, backward compatibility)

### Change 2: Add Incremental Mode to `forge-build-agent-team` Skill

**File:** `templates/skills/forge-build-agent-team/SKILL.md`

Add the Step 0 (mode detection) before the current Step 1, and add the incremental steps (1i–7i) as described in the detailed design. Preserve the existing Steps 1–8 completely unchanged.

Specific additions:
- Step 0: Mode detection logic (Feature PRD detected → incremental path; regular PRD → existing path)
- Steps 1i–7i: Incremental analysis, impact evaluation, diff-based modifications, incremental validation
- A new guideline about scaling changes to feature scope

### Change 3: Update `forge-team-builder` Agent

**File:** `templates/agents/forge-team-builder.md`

Small modifications:
- Add "Analyzing feature PRDs for incremental team modifications" to the Expertise section
- Add a note in the Process section that the agent supports both full team generation and incremental modification
- Update the description to mention "extend" in addition to "build"

### Change 4: Add Feature Execution Mode to `project-orchestrator`

**File:** `templates/agents/project-orchestrator.md`

Additions:
- New commands: `Execute feature {path}`, `Execute feature {path} Phase F1`
- New Process step 1b: Feature PRD + existing project analysis
- Feature orchestration guidelines (never re-execute, regression awareness, rollback tracking)
- A feature execution example in the Output Format section

### Change 5: Update Bootstrap Scripts

**Files:** `scripts/bootstrap.sh`, `scripts/bootstrap.ps1`

Add the new `forge-build-feature-prd` skill directory to the copy list. This should be a minimal change — the scripts already copy from `templates/skills/` to `.github/skills/`.

### Change 6: Update README

**File:** `README.md`

Add a new section under "Working with the Agents" that describes the feature development workflow:
- When to use feature PRDs vs. updating the original PRD
- The three-step feature workflow (Feature PRD → Incremental Team Update → Feature Execution)
- Example invocation commands
- Update the Template Structure diagram to include the new skill

---

## What Else We Need to Think About

### Multi-Feature Coordination

**Scenario:** Two features are being developed simultaneously. Feature A adds a notification system, Feature B adds a payment system. Both might need to modify the API engineer.

**Recommendation for now:** Document that feature PRDs should be executed sequentially, not in parallel. Each feature PRD should be completed and its agents merged before starting the next feature PRD. This avoids merge conflicts in agent files. Parallel feature PRDs could be a future enhancement but adds significant complexity.

### Feature PRD Lifecycle

**Question:** What happens to a feature PRD after it's fully implemented?

**Recommendation:** Mark feature PRDs as "Implemented" (similar to how the original PRD's phases get checked off). They remain in the repository as historical documentation of what was built and why. Consider a convention like `docs/features/` for feature PRDs and adding a status field to the Feature Overview section.

### Original PRD Updates

**Question:** Should the original PRD be updated after a feature is implemented?

**Recommendation:** No — the original PRD should remain as the record of the initial project scope. Feature PRDs are additive documents. If someone wants to understand the full current state of the project, they reference the original PRD plus all "Implemented" feature PRDs. This avoids the risk of corrupting the original PRD through repeated edits.

### Agent Deprecation

**Question:** What if a feature makes an existing agent obsolete?

**Recommendation:** This is an edge case for now. If a feature fundamentally replaces a subsystem, the feature PRD's Agent Impact Assessment (Section 8) should note which agents are deprecated and recommend removal. The team builder can flag this during incremental analysis.

### Skills Reuse

**Question:** How do we handle skills from the original build?

**Recommendation:** Feature PRDs should explicitly note in their Technical Approach section which existing skills can be reused. The incremental team builder should list existing skills alongside new ones in its output summary. Skills, like agents, should not be regenerated if they're still valid.

### Testing Regression

**Question:** How do we ensure new features don't break existing functionality?

**Recommendation:** The Feature PRD format already includes Section 10 (Testing Strategy) which should address regression. The project orchestrator's feature mode should include a final step that calls the QA/test agent to run the full existing test suite, not just feature-specific tests.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Feature PRD misses impact on existing agents | Medium | High | Agent Impact Assessment section forces explicit analysis; team builder validates coverage |
| Incremental team builder introduces boundary overlap | Low | High | Validation step specifically checks for overlaps with existing agents |
| Users skip feature PRD and just modify agents directly | Medium | Low | This is valid — the feature PRD process is a recommendation, not a requirement |
| Feature PRD diverges from actual implemented state | Medium | Medium | Recommend checking off completed phases; orchestrator tracks progress |
| Too many feature PRDs make project state hard to understand | Low | Medium | Recommend a `docs/features/` directory with clear naming; original PRD remains canonical |
| Breaking changes to existing agents during incremental update | Low | High | Diff-based approach shows exactly what changes; unchanged agents are left untouched |

---

## Summary

| What | How | Effort |
|------|-----|--------|
| Capture feature requirements in context | New `forge-build-feature-prd` skill with context-aware PRD format | Medium |
| Reuse existing agents, add only what's needed | Incremental mode in `forge-build-agent-team` skill with auto-detection | Medium |
| Execute features without re-running original phases | Feature execution mode in `project-orchestrator` with feature-aware analysis | Medium |
| Keep existing workflow intact | All changes are additive; existing paths unchanged | — |
| Document and deploy | README update + bootstrap script update | Small |

**Key principles:**

1. **Additive, not destructive** — Feature PRDs add to the project, they don't replace or regenerate existing work
2. **Context-aware** — Every step in the feature workflow analyzes what already exists before proposing changes
3. **Backward compatible** — Users who don't need feature PRDs see zero changes to their existing workflow
4. **Diff-based modifications** — Changes to existing agents are presented as diffs, not full regenerations
5. **Explicit over implicit** — Feature PRDs force you to think about impact, agent boundaries, and regression before writing code
