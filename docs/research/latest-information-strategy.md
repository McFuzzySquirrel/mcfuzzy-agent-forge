# Research: Ensuring Agents Use Latest Information

**Date:** 2026-03-16
**Status:** Research Complete — Ready for Implementation

---

## Question

How does the current solution ensure that when a user runs this on their PRD, the agents it builds always have the latest information for whatever tooling and tech stacks will be used? Should we include something like "always ensure you search for latest," or do agents already do this?

---

## Current State Analysis

### What Exists Today

The framework currently relies on a **static PRD as the single source of truth**. All generated agents are instructed to consult the PRD for requirements, tech stack, and architecture decisions. The relevant instructions across the templates are:

| File | Instruction | What It Does |
|------|------------|--------------|
| `forge-build-agent-team/SKILL.md` (line 132) | "Always consult [{PRD path}] for the **authoritative project requirements**." | Tells agents to reference PRD, not external sources |
| `forge-build-prd/SKILL.md` (line 11) | "produce a comprehensive PRD that can serve as the **authoritative reference**" | Positions the PRD as the definitive source |
| `project-orchestrator.md` (line 27) | "Always consult the project's PRD for..." | Routes all decisions through PRD |
| `forge-build-agent-team/SKILL.md` (line 263) | "Don't copy entire requirement tables into agent files — **they'll go stale**." | Acknowledges staleness risk, but solution is reference-based |

### What Does NOT Exist

The framework currently has **no mechanism** for agents to:

1. **Search for latest documentation** — No instruction to look up current framework docs, API references, or migration guides
2. **Verify dependency versions** — No instruction to check if specified versions are current or have known vulnerabilities
3. **Research current best practices** — No instruction to verify that patterns in the PRD reflect current framework conventions
4. **Check for breaking changes** — No instruction to verify compatibility between specified stack components

---

## Do Agents Already Do This?

**Short answer: Sometimes, but inconsistently and unreliably.**

GitHub Copilot agents (powered by LLMs) have these relevant behaviors:

| Behavior | Reliability | Notes |
|----------|-------------|-------|
| **Training data knowledge** | Medium | LLMs know about frameworks up to their training cutoff, but this can be months old |
| **Web search capability** | High (when available) | GitHub Copilot coding agent has `web_fetch` and can search, but agents don't always proactively use it |
| **Pattern matching from context** | High | Agents will follow existing code patterns in the repo, which may or may not be current |
| **Proactive version checking** | Low | Without explicit instruction, agents rarely volunteer to verify version currency |
| **Best practice verification** | Low | Agents tend to use patterns from training data, not actively research current recommendations |

**Key insight:** LLM-powered agents follow instructions faithfully. If we tell them to verify latest versions and best practices, they will. If we don't, they'll use whatever knowledge they have from training data, which may be outdated.

---

## Risk Assessment

### What Can Go Wrong Without This

| Risk | Likelihood | Impact | Example |
|------|-----------|--------|---------|
| **Outdated API usage** | High | Medium | Agent generates Next.js Pages Router code when App Router is now standard |
| **Deprecated dependencies** | High | Medium | Agent installs a library version with known CVEs |
| **Wrong framework patterns** | Medium | High | Agent uses class components in React when hooks are standard |
| **Incompatible versions** | Medium | High | Agent specifies library versions that don't work together |
| **Missing security patches** | Medium | High | Agent uses a version with known vulnerabilities |
| **Outdated build tooling** | Medium | Low | Agent configures Webpack when Vite is now recommended for the framework |

### What Already Mitigates This

1. **PRD creation step** — The PRD builder skill asks users about their tech stack, so users can specify current versions
2. **Human review** — Users review the PRD before agent generation, and can catch outdated choices
3. **LLM knowledge** — The underlying LLM has broad (if sometimes dated) knowledge of frameworks
4. **Copilot coding agent tools** — When agents execute code, GitHub Copilot has access to `web_fetch`, package registries, and can verify versions at implementation time

---

## Recommendation

**Yes, we should add explicit "verify latest" instructions, but strategically placed and proportionate.**

Adding a blanket "always search for latest everything" would be:
- ❌ Too noisy — agents would spend excessive time searching before every action
- ❌ Potentially harmful — could cause agents to second-guess the PRD's deliberate tech choices
- ❌ Impractical — not every tool or library needs version verification

Instead, we should add **targeted freshness checks at key decision points** where outdated information has the highest impact.

---

## Implementation Plan

### Change 1: Add a "Verify Tech Stack Currency" step to the PRD Builder Skill

**File:** `templates/skills/forge-build-prd/SKILL.md`
**Where:** In Step 2 (Ask Clarifying Questions), under "Technical Constraints"
**What:** Add guidance for the PRD builder to research and verify that specified tech stack components are current.

**Proposed addition:**
```markdown
**Technology Currency**
- For each major technology in the stack, verify it is a current, actively maintained version.
- Search for the latest stable release of key frameworks and libraries before finalizing the tech stack section.
- Flag any specified technology that has a newer major version available, has been deprecated, or has reached end-of-life.
- Note any recent breaking changes or migration requirements in the Research Findings section.
```

**Rationale:** The PRD is the earliest decision point. Catching outdated tech choices here prevents all downstream agents from building on stale foundations.

---

### Change 2: Add a freshness guideline to the Agent Template

**File:** `templates/skills/forge-build-agent-team/SKILL.md`
**Where:** In the agent file template (Step 5), add to the Constraints section template
**What:** Include a standard constraint in every generated agent that instructs it to verify current best practices.

**Proposed addition to the agent template's Constraints section:**
```markdown
- When implementing features, verify that you are using current stable APIs, conventions, and best practices for the project's tech stack. If you are uncertain whether a pattern or API is current, search for the latest official documentation before proceeding.
```

**Rationale:** This is lightweight — it doesn't force agents to search for everything, but creates a habit of verification when uncertainty exists. It's a single line added to each agent's constraints, so the overhead is minimal.

---

### Change 3: Add a "Verify Stack" step to the Project Orchestrator

**File:** `templates/agents/project-orchestrator.md`
**Where:** In Process section, Step 1 (Analyze the PRD and Agent Team), add a sub-step
**What:** Instruct the orchestrator to verify tech stack currency before starting implementation.

**Proposed addition:**
```markdown
4. **Verify tech stack currency**:
   - For each major technology in the PRD's tech stack, confirm the specified version is current and stable
   - Search for latest stable versions of key frameworks and libraries
   - Flag any technologies that have newer major versions, known deprecations, or security advisories
   - Report findings to the user before proceeding with Phase 1
```

**Rationale:** The orchestrator is the gateway to all implementation work. A single verification step here catches issues before any code is written, without burdening individual specialist agents.

---

### Change 4: Add a guideline to the Team Builder

**File:** `templates/agents/forge-team-builder.md` and `templates/skills/forge-build-agent-team/SKILL.md`
**Where:** In the Guidelines section
**What:** Add a guideline about including freshness instructions in generated agents.

**Proposed addition:**
```markdown
- **Encourage currency verification.** Generated agents should include a constraint reminding them to verify they are using current, stable APIs and best practices for their tech stack. Agents should search for latest official documentation when uncertain rather than relying solely on training data.
```

**Rationale:** This ensures the team builder consistently includes freshness instructions in every agent it generates, making it a systemic property of the framework rather than something that might be forgotten.

---

## Summary

| Change | File | Effort | Impact |
|--------|------|--------|--------|
| Verify tech stack in PRD | `forge-build-prd/SKILL.md` | Small | High — catches issues at source |
| Agent template constraint | `forge-build-agent-team/SKILL.md` | Small | High — every agent gets the instruction |
| Orchestrator verify step | `project-orchestrator.md` | Small | Medium — runtime check before implementation |
| Team builder guideline | `forge-team-builder.md` + skill | Small | Medium — ensures consistency |

**Total scope:** ~4 small additions across 4 files. No structural changes. No breaking changes. Fully backward compatible.

**Key principle:** We're not adding "always search for everything" — we're adding targeted verification at the moments where outdated information would cause the most damage: tech stack selection (PRD), team generation (agent template), and implementation start (orchestrator).
