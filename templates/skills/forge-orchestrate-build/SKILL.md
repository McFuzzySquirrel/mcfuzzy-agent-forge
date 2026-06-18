---
name: forge-orchestrate-build
description: >
  Coordinate specialist agents through PRD implementation phases. Provides the
  full execution process for PRD full builds, Feature PRD executions, and
  feature-based builds from decomposed documents. Use this skill when the
  project-orchestrator agent invokes it, or when you need to drive a build
  step by step.
---

# Skill: Orchestrate Project Build

You are driving a multi-agent project build. Your job is to coordinate specialist agents through implementation phases in the correct order, verifying deliverables, maintaining progress tracking, and preserving user control between phases.

---

## Process

### 1. Analyze the PRD and Agent Team

Before starting:
1. Read the complete PRD — goals, scope, tech stack, all requirements, phases, dependencies.
2. Review all agent files in `.agents/agents/` — expertise, collaboration sections, which agents operate in which phases.
3. Build the execution plan: map each requirement to an owner agent, identify dependencies, determine ordering within and across phases.
4. Verify tech stack currency — search for latest stable versions of every major technology. Flag deprecated or end-of-life dependencies. Report findings before proceeding with Phase 1.

### 1b. Analyze Feature PRD (Feature Mode)

When the document is a Feature PRD (F-prefixed phases, "Feature Overview" section):
1. Read the Feature PRD — scope, impact, new components, phases, Agent Impact Assessment.
2. Read the original PRD — what's already built, established architecture.
3. Review agent files — identify modified, new, and unchanged agents.
4. Verify tech stack only for NEW technologies introduced by the feature.
5. Build the feature execution plan — map FT-FR-* requirements, identify dependencies on existing work.

### 1c. Analyze Product Vision + Feature Documents (Feature-Based Build Mode)

When building from decomposed features (detected by `docs/product-vision.md` + `docs/features/`):
1. Read the Product Vision — goals, architecture, NFRs, feature list, dependency graph (Section 14).
2. Read ALL feature documents — scope, user stories, requirements, phases, dependencies.
3. Review agent files — agents may own requirements from multiple features.
4. Build the feature dependency graph — verify a valid DAG, determine execution order (dependencies first), identify parallel opportunities.
5. Verify tech stack currency for the product vision.
6. Build the execution plan — order features by dependency, order tasks by feature phases.

### 2. Execute Phase by Phase

For each phase:

**Phase Start:** Announce the phase, list agents involved and their deliverables, identify prerequisite dependencies.

**Task Execution:**
1. Identify the owning agent from your execution plan.
2. Check that all prerequisite tasks are complete.
3. Call the specialist agent with clear instructions — reference PRD sections, specify what to build, mention dependent outputs, state target file paths.
4. Verify the output — files exist at correct locations, PRD requirements followed, output usable by dependent agents.
5. Document completion for handoff.
6. Commit progress — descriptive commit message (`Phase N, Task N.M: description`), include only task-related files, update `docs/PROGRESS.md` and include in the commit.

**Phase Completion:**
1. Review all deliverables.
2. Verify phase acceptance criteria from the PRD.
3. Summarize what was built and what's ready for the next phase.
4. Commit remaining uncommitted work.

### 3. Handle Cross-Agent Coordination

When a task spans multiple agents:
1. Identify the primary owner.
2. Call supporting agents first to create inputs.
3. Call the primary agent with references to supporting outputs.
4. Call dependent agents after primary work completes (e.g., `@qa-tester` after `@api-engineer`).

### 4. Monitor and Adapt

Track completed vs. remaining work. Identify blockers. Reorder tasks within a phase if dependencies require it. Escalate ambiguities to the user. Validate consistency across agent outputs.

### 5. Provide Progress Updates

After each milestone: summarize accomplishments, list files created, note deviations from PRD (with justification), preview next phase, ask to continue or pause.

---

## Progress File Format

Maintain `docs/PROGRESS.md` as the single source of truth for project state.

**Standard format:**
```markdown
# Project Progress

## Current State
**Phase**: {Phase name}
**Status**: In Progress | Paused | Complete
**Last Updated**: {ISO date}
**PRD**: {path to PRD}

## Completed Tasks
- [x] Phase N, Task N.M: {description} (@agent-name) [model: {model | default}]
  - Files: {file list}

## Current Task
- [ ] Phase N, Task N.M: {description} (@agent-name)
  - Status: In progress

## Remaining
- [ ] Phase N+1: {next phase}

## Blockers
- {description or "None"}

## Notes
- {relevant context for resumption}
```

Create at start of orchestration. Update after each task. Include in every commit.

**Feature-Based Build variant:** Add a ## Feature Progress table showing feature-level status and a ## Completed Features section.

---

## Output Format

When presenting execution progress, follow the format matching the current mode. Load `references/output-templates.md` for the full templates:
- **Full Build Output** — phase-based with task breakdown, agent calls, and completion markers
- **Feature Execution Output** — F-prefixed phases, notes which agents are existing vs. new
- **Feature-Based Build Output** — feature dependency order table, per-feature progress

Structure output clearly with sections for phase start, each task (agent, input, output, result), and phase completion summary.

---

## Orchestration Patterns

### Sequential Tasks

```
Phase 1: Foundation
  Task 1: @project-architect → Set up project structure
  Wait for completion, verify structure exists
  Task 2: @framework-specialist → Initialize framework (depends on Task 1)
  Wait for completion, verify framework is configured
```

### Parallel Tasks (independent work)

```
Phase 2: Core Features
  Launch in parallel:
    - @auth-engineer → Build auth system
    - @api-engineer → Create API endpoints
    - @ui-developer → Build landing page
  Wait for all to complete before proceeding
```

### Multi-Agent Deliverable

```
Task: Create user dashboard
  Step 1: @database-specialist → Create user_metrics table
  Step 2: @api-engineer → Create GET endpoint using the schema
  Step 3: @frontend-engineer → Build dashboard component
  Step 4: @qa-tester → Write integration tests
```

### Iterative Refinement

```
Phase 3: Polish
  Iteration 1: @qa-tester → Run full suite, report failures
  Iteration 2: For each failure, call owning agent → Fix
  Iteration 3: @qa-tester → Re-run tests
  Repeat until all pass
```

---

## Error Handling

| Situation | Response |
|---|---|
| Missing prerequisites | Call prerequisite agent first, then retry |
| Agent failure | Re-call with corrected input |
| Ambiguous requirements | Escalate to user with specific question and blocked tasks |

---

## Gotchas

- **Never re-execute completed phases.** When executing a Feature PRD, the original PRD phases are already complete. Reference existing work.
- **Check agent collaboration sections** before calling an agent — they declare what they need from other agents.
- **Verify output before proceeding.** Don't assume an agent's work is correct — check files exist, builds pass, tests pass.
- **Feature phases use F-prefixed IDs** (Phase F1, F2) to distinguish from original phases.
- **Rollback tracking.** In feature execution, keep a running list of modified existing files so the feature could be reverted.
- **Pause between features** in feature-based builds. Ask for approval before starting the next feature.
- **Update PROGRESS.md after every task.** Include it in the commit so cross-machine resume works.

---

## Validation

Before reporting a phase complete:
- [ ] All task-level deliverables exist at the correct file paths
- [ ] Build/lint/test commands pass for the task's changes
- [ ] PROGRESS.md is updated with completed tasks and current state
- [ ] Phase acceptance criteria from the PRD are met
- [ ] All deliverables are committed with descriptive messages
- [ ] (Feature mode) Rollback list of modified existing files is preserved
- [ ] (Feature-based mode) Feature dependency graph is respected — no unlocked features started
