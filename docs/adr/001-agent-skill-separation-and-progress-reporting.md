# ADR-001: Agent/Skill Separation and Specialist Progress Reporting

**Date:** 2026-03-25
**Status:** Accepted

---

## Context

The McFuzzy Agent Forge framework uses two complementary constructs — **agents** and **skills** — to provide GitHub Copilot with structured capabilities. The forge-team-builder agent and the forge-build-agent-team skill had significant content overlap: the agent's Process section (steps 1–6) repeated much of the skill's detailed step-by-step procedures (steps 1–8). This duplication made maintenance harder and risked the two drifting out of sync.

Separately, the project-orchestrator was recently enhanced with progress tracking capabilities (incremental commits, `docs/PROGRESS.md` maintenance, resume-from-checkpoint support), but the agent template used by forge-build-agent-team to generate specialist agents had not been updated to match. Generated specialist agents had no guidance on:
- When and how to commit work
- How to verify changes (build, test, lint)
- How to report completion status
- How to coordinate with the orchestrator's progress tracking

This created a workflow gap where the orchestrator expected consistent practices that specialists were not guided to follow.

---

## Decision

### 1. Clarify the Agent/Skill Separation

We define the architectural boundary as:

- **Agents** provide the **identity, framing, and constraints** — they are user-facing entry points with expertise declarations, output standards, collaboration awareness, and platform constraints. They define *who* and *why*.
- **Skills** provide the **detailed operational procedures** — they contain step-by-step processes, templates, decision criteria, and validation checklists. They define *how*.

Applied to the team builder:

- The **forge-team-builder agent** was slimmed to retain only its unique value: frontmatter, identity, expertise, a concise process overview that delegates to the skill, constraints, output standards, and collaboration links. The redundant steps 1–6 were removed.
- The **forge-build-agent-team skill** remains the single source of truth for the team generation process (Steps 1–8 for full builds, Steps 1i–7i for feature increments).

### 2. Add Progress Reporting to the Agent Template

We enhanced the agent template in the forge-build-agent-team skill with three additions:

**a. Process and Workflow section** — A new standard section added to every generated agent, providing a 5-step workflow: understand the task, implement the deliverable, verify changes (lint/build/test), commit work, and report completion.

**b. Progress-aware constraints** — Three new constraints added to the template's Constraints section requiring agents to commit after verification passes, follow orchestrator instructions for progress tracking, and report verification status.

**c. Orchestrator in collaboration** — The project-orchestrator is now listed as a standard collaboration entry in every generated agent, making the coordination pattern explicit.

Additionally:
- Step 5i (Feature Increment Mode) was updated to add the Process and Workflow section to older agents during incremental updates.
- A new guideline was added reinforcing the importance of including process guidance in all generated agents.

---

## Consequences

### Positive

- **Single source of truth** — The team generation process lives in exactly one place (the skill), eliminating duplication drift risk between the agent and skill.
- **Consistent workflow** — All generated specialist agents now follow the same verification and commit practices as the orchestrator expects.
- **Self-sufficient agents** — Agents can work independently (without the orchestrator) and still maintain good practices for verification and commits.
- **Reliable resume** — Since agents commit work appropriately and the orchestrator tracks progress, "Resume from last checkpoint" works reliably across sessions and machines.
- **Quality gates** — Built-in verification steps ensure agents don't commit broken code.
- **Future-proof** — New agent teams generated from this point forward automatically include progress reporting guidance. Incremental mode brings older agents up to current standards.
- **Leaner agent file** — The forge-team-builder agent is now ~64 lines instead of ~144, making it easier to read and maintain.

### Negative

- **Template size increase** — The agent template in the skill grows by ~20–30 lines. This is within acceptable limits given the 30,000-character platform constraint.
- **Existing generated agents** — Agent teams generated before this change lack the Process and Workflow section. They will be updated when Feature Increment Mode touches them (Step 5i), but unchanged agents remain as-is until then.

### Neutral

- **Backward compatible** — All changes are additive. Existing agents continue to work. The slimmed forge-team-builder agent delegates to the same skill it always did.
- **No bootstrap script changes** — The bootstrap scripts auto-discover agents and skills via glob patterns, so no modifications are needed.

---

## References

- Research: [Agent Progress Reporting and Verification Strategy](../research/agent-progress-reporting-strategy.md)
- Research: [Orchestrator Progress Tracking and Bootstrap Fix](../research/orchestrator-progress-strategy.md)
- Agent: [forge-team-builder](../../templates/agents/forge-team-builder.md)
- Skill: [forge-build-agent-team](../../templates/skills/forge-build-agent-team/SKILL.md)
- Agent: [project-orchestrator](../../templates/agents/project-orchestrator.md)
