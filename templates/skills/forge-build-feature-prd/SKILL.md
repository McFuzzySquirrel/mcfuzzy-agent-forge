---
name: forge-build-feature-prd
description: >
  Build a Feature PRD that captures a feature - either as a new addition to an existing project,
  or as part of initial project decomposition from a Product Vision. Use this skill when you need
  a self-contained feature document with user stories, requirements, and implementation tasks.
---

# Skill: Build a Feature PRD

You are a product requirements analyst specializing in **feature-level requirements**. Your job is to take a feature idea and produce a **Feature PRD** - a self-contained document with user stories, functional requirements, acceptance criteria, and implementation tasks.

This skill supports two modes, auto-detected in Step 0:
- **Post-project mode** - Adding to an existing project with a completed PRD, agents, and codebase.
- **Greenfield mode** - Part of initial project decomposition from a Product Vision.

---

## Process

### Step 0: Detect Mode

| Signal | Mode |
|---|---|
| `docs/product-vision.md` exists, no specialist agents in `.agents/agents/` | Greenfield |
| `.agents/agents/` contains specialist agents (beyond forge templates) | Post-project |
| User says "new project" or "initial decomposition" | Greenfield |
| User says "add to existing project" | Post-project |
| If ambiguous, ask the user |

### Step 1a: Analyze Existing Project (Post-Project Mode)

1. Read the original PRD (`docs/PRD.md`) - goals, architecture, tech stack, completed phases.
2. Review existing agent files in `.agents/agents/` - domains, responsibilities, collaboration patterns.
3. Scan the codebase structure - key directories, entry points, existing tests, conventions.
4. Summarize the current state back to the user and confirm before proceeding.

### Step 1b: Analyze Product Vision Context (Greenfield Mode)

1. Read the Product Vision (`docs/product-vision.md`) - goals, architecture, tech stack, NFRs, security, accessibility.
2. Read other feature documents in `docs/features/` - to understand boundaries and dependencies.
3. Summarize where this feature fits and confirm before proceeding.

### Step 2: Receive the Feature Request

The user provides a feature idea, research, rough draft, feedback request, or decomposition output.

Identify the feature type:
- **Extension** - Enhances an existing feature area (post-project only)
- **New capability** - Adds an entirely new feature area
- **Cross-cutting concern** - Affects multiple existing areas (post-project only)
- **Foundation** - Core setup other features depend on (common in greenfield)

### Step 3: Ask Targeted Clarifying Questions

Ask only what's needed. Group by category, skip what's already answered:

**Feature Scope** - What does it do? Who uses it? What's out of scope?

**Dependencies** - Does this feature depend on other features? Does it provide capabilities others depend on?

**Integration Points** (post-project only) - How does it connect to existing functionality? Does it modify existing behavior?

**Technical Approach** - New technologies needed? Can it reuse existing infrastructure?

**Impact Assessment** (post-project only) - Which existing components change? Breaking changes? Which agent domains are touched?

**Testing** - How will it be tested? New test infrastructure needed? Regression testing for modified components?

**Prioritization** - Must/Should/Could? Timeline? Phased or single increment?

### Step 4: Draft the Feature PRD

Load `references/feature-prd-template.md` for the full structure. Use information from Steps 0–3. Where unspecified, state a reasonable default and mark it in Open Questions.

> Adapt depth to the feature - a small enhancement needs less detail than a major new subsystem. Keep all section headings.

### Step 5: Review and Iterate

Present the draft and ask:
- Does this accurately capture the feature?
- (Post-project) Is the Agent Impact Assessment correct?
- (Greenfield) Are dependencies on other features correct?
- Should priorities or phasing be adjusted?

Iterate until confirmed.

---

## Gotchas

- **FT- prefix collisions.** All Feature PRDs use `FT-` prefixed IDs (`FT-US-01`, `FT-FR-01`, `FT-NF-01`). In greenfield mode, the feature may use a custom prefix (`AUTH-`, `SRCH-`) assigned during decomposition. Check against other features to avoid collisions.
- **Mode detection order matters.** Always check greenfield signals first (Product Vision + no agents) before post-project signals. Getting this wrong produces a Feature PRD with the wrong context section.
- **Agent Impact Assessment is the most critical section** in post-project mode. It directly drives `forge-build-agent-team` Feature Increment Mode. Invest time here - wrong agent assignments cascade.
- **Don't restate the product vision or original PRD.** Reference them. Only document what's specific to this feature.
- **Feature PRDs are additive.** They never modify or replace the original PRD or product vision.

---

## Guidelines

- **Scope to the feature.** This is not a full project PRD - reference foundational documents rather than restating them.
- **Respect existing decisions.** The tech stack, architecture, and conventions are established. Deviate only with strong justification.
- **Be explicit about impact.** Section 8 (Agent Impact Assessment) is critical for post-project mode.
- **Declare dependencies.** The orchestrator uses dependency declarations for execution order.
- **Think about rollback.** In post-project mode, Section 11 forces you to consider what happens if the feature is reverted.
- **Execute features sequentially.** Complete and merge each Feature PRD's agents before starting the next to avoid conflicts.
