# ADR-002: PRD Decomposition into Features

**Date:** 2026-04-09
**Status:** Accepted

---

## Context

The McFuzzy Agent Forge framework produces a single monolithic Product Requirements Document (PRD) that contains all user stories, functional requirements, non-functional requirements, and implementation phases in one document. While this works well for small-to-medium projects, it has limitations:

1. **No formal traceability** — User stories (Section 4.2) and functional requirements (Section 8) sit in separate tables with no formal link. There's no chain from "this user story drives these requirements which live in this feature which maps to this phase."

2. **Artificial serialization** — Implementation phases cut horizontally across the whole product (Phase 1: Foundation, Phase 2: Core Features). This creates dependencies between unrelated features and prevents parallel or independent delivery.

3. **Scope rigidity** — Adding, removing, or reprioritizing work requires editing the monolithic PRD's requirement tables and phases. There's no way to add or remove a self-contained unit of work.

4. **Feature PRDs are post-project only** — The `forge-build-feature-prd` skill can create feature-level documents, but only after the initial project is complete. The feature document format and incremental agent/orchestrator support already exist but are positioned as additions, not as a first-class approach from day one.

5. **Agent digestibility** — AI agents work best with focused, well-scoped tasks. A feature-scoped brief is more digestible than a 300-line PRD with 20+ requirements.

---

## Decision

We adopt a **hybrid approach** that keeps the monolithic PRD as the default for simple projects while adding first-class support for feature decomposition as an alternative path:

### 1. New `forge-decompose-prd` Skill

A new skill that takes an existing monolithic PRD and decomposes it into:

- A **Product Vision** document — lightweight overview containing goals, personas, technical architecture, tech stack, non-functional requirements, security, accessibility, and glossary (the cross-cutting concerns that span all features)
- Individual **Feature documents** — each containing its own user stories, functional requirements, acceptance criteria, implementation tasks, and testing strategy (self-contained units of work)

Output goes to `docs/product-vision.md` and `docs/features/*.md`.

### 2. Extended `forge-build-feature-prd` Skill

The existing Feature PRD skill is extended to support **greenfield features** (during initial decomposition) in addition to post-project features. Mode detection determines whether "Context: Existing System State" and "Agent Impact Assessment" sections are required or optional.

### 3. Extended `forge-build-agent-team` Skill

A new **Vision + Features Mode** is added alongside the existing Full Build Mode and Feature Increment Mode. This mode reads a product vision document plus all feature documents, aggregates requirements across features, and generates the agent team from the unified view.

### 4. Extended `project-orchestrator` Agent

Feature-based execution is promoted from a secondary mode to a co-equal primary mode. The orchestrator gains:
- Feature dependency ordering (reading dependency declarations from feature docs)
- New commands for feature-based execution (`Execute all features`, `Execute features in order`)
- Feature-level progress tracking in `docs/PROGRESS.md`

### 5. What Stays the Same

- `forge-build-prd` — Completely unchanged. Remains the default for simple projects.
- Bootstrap scripts — Auto-discover skills via glob patterns; no changes needed.
- Existing Feature Increment Mode — Continues to work for post-project features.
- Existing monolithic PRD execution — Continues to work unchanged.

---

## Consequences

### Positive

- **Backward compatible** — All existing workflows continue to work unchanged. The monolithic PRD remains a valid and supported approach.
- **User choice** — Teams choose the approach that fits their project complexity. Small projects use one PRD; larger projects decompose into features.
- **Incremental adoption** — Users can start with a monolithic PRD and decompose later using `forge-decompose-prd`, rather than committing to a decomposition approach upfront.
- **Better traceability** — Feature-level documents create clear chains: user stories → requirements → tasks → acceptance criteria, all within a single self-contained unit.
- **Independent delivery** — Features can be prioritized, reordered, and shipped independently. The orchestrator uses dependency declarations to determine safe execution order.
- **Leverages existing infrastructure** — ~70% of the feature infrastructure already exists (Feature PRD format, agent increment mode, feature execution mode). This decision extends rather than rebuilds.
- **Right-sized agent context** — Agents receive feature-scoped briefs rather than the full PRD, matching how AI agents work best.

### Negative

- **More documents** — The decomposed approach produces N+1 documents (vision + N features) instead of 1. This is more coordination overhead for small projects (mitigated by keeping the monolithic option as default).
- **Cross-cutting concern management** — NFRs, security, and accessibility live in the product vision and must be referenced (not duplicated) by features. This requires discipline.
- **Inter-feature dependencies** — Features may depend on each other (e.g., feature B needs feature A's data model). Explicit dependency declarations add overhead but prevent execution conflicts.
- **Three modes in team builder** — The `forge-build-agent-team` skill now has three modes (Full Build, Feature Increment, Vision + Features). This increases complexity but each mode is self-contained.

### Neutral

- **No bootstrap script changes** — Scripts auto-discover skills via glob patterns, so the new `forge-decompose-prd` skill is picked up automatically.
- **ID scheme compatibility** — Feature IDs use `{PREFIX}-US-01`, `{PREFIX}-FR-01` format, compatible with the existing `FT-` prefix convention for Feature PRDs.
- **Product vision is optional** — The system works with or without a product vision document. When absent, the team builder and orchestrator fall back to the monolithic PRD behavior.

---

## References

- Research: [PRD Decomposition Strategy](../research/prd-decomposition-strategy.md)
- Research: [Feature PRD Strategy](../research/feature-prd-strategy.md) (predecessor — post-project features)
- ADR: [ADR-001 Agent/Skill Separation](001-agent-skill-separation-and-progress-reporting.md)
- Skill: [forge-build-prd](../../templates/skills/forge-build-prd/SKILL.md)
- Skill: [forge-build-feature-prd](../../templates/skills/forge-build-feature-prd/SKILL.md)
- Skill: [forge-build-agent-team](../../templates/skills/forge-build-agent-team/SKILL.md)
- Agent: [project-orchestrator](../../templates/agents/project-orchestrator.md)
- Agent: [forge-team-builder](../../templates/agents/forge-team-builder.md)
