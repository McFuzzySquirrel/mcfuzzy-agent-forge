# Research: Agent Progress Reporting and Verification Strategy

**Date:** 2026-03-25
**Status:** Implemented

---

## Question

The orchestrator agent was recently updated with progress tracking capabilities (committing work incrementally, maintaining `docs/PROGRESS.md`), but the team builder that generates specialist agents was not updated accordingly. Should the agent templates include progress reporting, verification, and commit guidance so that generated specialist agents follow the same practices as the orchestrator?

---

## Current State Analysis

### Recent Orchestrator Updates (Implemented)

The `project-orchestrator.md` template was recently enhanced with progress tracking capabilities:

| Feature | Location | Description |
|---------|----------|-------------|
| Incremental commits | Task Execution, Step 6 (line 134-137) | Commit after each task with descriptive messages |
| Phase commits | Phase Completion, Step 4 (line 143) | Commit remaining work after phase completion |
| Progress file | Section 6 (lines 176-227) | Maintain `docs/PROGRESS.md` with task status |
| Resume capability | Commands section (line 313-314) | Resume from last checkpoint using progress file |

**Impact**: The orchestrator can now track and persist progress across sessions and machines.

### Current Agent Template (Unchanged)

The `forge-build-agent-team` skill defines the template used to generate all specialist agents:

| Section | Location | Current Content | What's Missing |
|---------|----------|-----------------|----------------|
| Template structure | Lines 125-189 | Frontmatter, Expertise, Key Reference, Responsibilities, Constraints, Output Standards, Collaboration | No process/workflow section |
| Constraints | Line 169-173 | Tech stack verification constraint | No commit or verification guidance |
| Collaboration | Line 185-188 | Other agents coordination | No mention of orchestrator coordination patterns |

**Root cause**: When the orchestrator progress tracking was added, the agent template was not updated to reflect these new patterns. Agents generated from this template have no guidance on:
- When and how to commit their work
- How to verify their changes (build, test, lint)
- How to report completion status to the orchestrator
- How to coordinate with the orchestrator's progress tracking

### The Workflow Gap

When the orchestrator delegates work to a specialist agent:

```
Orchestrator:
  ✓ Knows to maintain docs/PROGRESS.md
  ✓ Knows to commit after tasks
  ✓ Expects agents to complete deliverables
  ✓ Expects agents to verify their work
  ↓ Calls specialist agent

Specialist Agent:
  ? No guidance on committing work
  ? No guidance on verification steps
  ? No standard process for reporting completion
  ? Unaware of progress tracking expectations
```

**Impact**: 
- Inconsistent practices between orchestrator and specialist agents
- Specialist agents may not commit their work appropriately
- No standardized verification workflow
- Progress tracking may be incomplete if specialists don't follow conventions
- Agents working independently (without orchestrator) have no process guidance

### Comparison with Other Templates

| Template | Has Progress/Commit Guidance | Notes |
|----------|------------------------------|-------|
| `project-orchestrator.md` | ✓ Yes (Section 6, Task Execution) | Recently added |
| `forge-team-builder.md` | ✗ No | Generates agents, doesn't need it |
| Agent template in `forge-build-agent-team` | ✗ No | **This is the gap** |
| Generated specialist agents | ✗ No | Inherit from template |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Breaking existing agent behavior | Low | High | Changes are additive (new sections), existing content unchanged |
| Agents commit too frequently | Low | Low | Guidance emphasizes "after completing deliverables," not every file change |
| Conflicts with user workflows | Low | Medium | Process guidance is advisory, not prescriptive; agents can adapt to context |
| Template becomes too long | Low | Low | Adding ~20-30 lines to a template that's currently under character limits |
| Inconsistency between full vs. incremental mode | Low | Medium | Same template sections apply to both new agents and modified agents |

---

## Implementation Plan

### Change 1: Add Process and Workflow Section to Agent Template

**File**: `templates/skills/forge-build-agent-team/SKILL.md`

**Location**: Insert after line 166 (after Responsibilities section, before Constraints)

**Content**: Add a new standardized section to the agent template:

```markdown
---

## Process and Workflow

When executing your responsibilities:

1. **Understand the task** — Read the referenced PRD sections and any dependencies from other agents
2. **Implement the deliverable** — Create or modify files according to your responsibilities
3. **Verify your changes**:
   - Run relevant linters for the files you modified
   - Run builds to ensure nothing is broken
   - Run tests related to your changes
4. **Commit your work** — After verification passes:
   - Use descriptive commit messages referencing the task or requirement
   - Include only files related to this specific deliverable
   - Follow the project's commit conventions (if specified in the PRD)
5. **Report completion** — Summarize what was delivered, which files were modified, and verification results

---
```

**Rationale**: This provides a consistent workflow for all generated agents that aligns with the orchestrator's expectations.

### Change 2: Add Progress-Aware Constraints

**File**: `templates/skills/forge-build-agent-team/SKILL.md`

**Location**: Line 169-173, add to the Constraints section in the template

**Content**: Add the following constraint items after the existing currency verification constraint:

```markdown
- After completing a deliverable and verifying it works (builds, tests pass), commit your changes with a clear, descriptive message
- When working as part of orchestrated project execution, follow the orchestrator's instructions for progress tracking and coordination
- Report the status of verification steps (linting, building, testing) when communicating completion to other agents or users
```

**Rationale**: These constraints make progress tracking and verification an explicit expectation.

### Change 3: Add Orchestrator to Standard Collaboration Section

**File**: `templates/skills/forge-build-agent-team/SKILL.md`

**Location**: Line 185-188, update the Collaboration section template

**Content**: Change the collaboration template to include:

```markdown
## Collaboration

- **project-orchestrator** — Coordinates your work as part of the overall project execution, provides task context, and tracks progress across all agents
- **{other-agent-name}** — {What they provide or need from this agent}
- **{other-agent-name}** — {Coordination point}
```

**Rationale**: Makes the orchestrator relationship explicit for all agents, clarifying the coordination pattern.

### Change 4: Update Incremental Mode Template Modifications

**File**: `templates/skills/forge-build-agent-team/SKILL.md`

**Location**: Step 5i (line 349), in the Feature Increment Mode section

**Content**: Add clarification that when modifying existing agents for features, the Process and Workflow section should be added if it doesn't exist:

```markdown
### Step 5i: Write Only Changed or New Files

- **For modified agents:** Present the specific additions (what's being added to Responsibilities, Collaboration, and Key Reference sections) as a clear diff or addendum. If the agent was created before the Process and Workflow section was added to the template, add this section as well to bring it up to current standards. Present changes for user review and confirmation before applying them to the existing agent files.
```

**Rationale**: Ensures incremental updates can also benefit from the new process guidance without requiring full agent regeneration.

### Change 5: Update Guidelines Section

**File**: `templates/skills/forge-build-agent-team/SKILL.md`

**Location**: Line 275-283, add to the Guidelines section

**Content**: Add a new guideline:

```markdown
- **Include process guidance.** All agents should include the standard Process and Workflow section to ensure consistent practices for verification, commits, and progress reporting. This aligns specialist agents with the orchestrator's progress tracking capabilities.
```

**Rationale**: Reinforces the importance of including process guidance in all generated agents.

---

## Benefits

### Consistency
- All agents (orchestrator and specialists) follow the same verification and commit practices
- Standardized workflow reduces confusion when agents collaborate

### Self-Sufficiency
- Agents can work independently and still maintain good practices
- No need for external process documentation or verbal instructions

### Orchestrator Compatibility
- Specialist agents naturally work well with orchestrator expectations
- Progress tracking works seamlessly across the full team

### Resume Capability
- Since each agent commits its work appropriately, `docs/PROGRESS.md` stays current
- "Resume from last checkpoint" works reliably

### Quality Gates
- Built-in verification steps ensure agents don't commit broken code
- Consistent testing and linting practices across all work

### Future-Proof
- When agents are created for new projects, they have this guidance built-in
- No need to retrofit process guidance into existing agent teams

---

## Summary

| Change | File | Type | Lines | Risk |
|--------|------|------|-------|------|
| Add Process and Workflow section | `templates/skills/forge-build-agent-team/SKILL.md` | Enhancement | After line 166 | Low |
| Add progress-aware constraints | `templates/skills/forge-build-agent-team/SKILL.md` | Enhancement | Lines 169-173 | Low |
| Add orchestrator to collaboration | `templates/skills/forge-build-agent-team/SKILL.md` | Enhancement | Lines 185-188 | Low |
| Update incremental mode guidance | `templates/skills/forge-build-agent-team/SKILL.md` | Enhancement | Line 349 | Low |
| Update guidelines section | `templates/skills/forge-build-agent-team/SKILL.md` | Enhancement | Lines 275-283 | Low |

**Total Changes**: 1 file, 5 locations, additive only (no removals or breaking changes)

**Backward Compatibility**: ✓ Full (existing agents continue to work, new agents get enhanced guidance)

**Testing Requirements**: Generate a sample agent team after changes and verify:
1. Agent files include the new Process and Workflow section
2. Constraints include progress reporting guidance
3. Collaboration section includes project-orchestrator
4. Incremental mode (Feature PRD) correctly adds sections to modified agents
