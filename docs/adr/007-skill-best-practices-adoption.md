# ADR-007: Adopt agentskills.io Best Practices for Skill Design

**Date:** 2026-06-17
**Status:** Accepted

---

## Context

The [agentskills.io best practices guide](https://agentskills.io/skill-creation/best-practices) defines a set of patterns for creating effective, well-calibrated skills. These patterns include: starting from real expertise, spending context wisely, progressive disclosure, gotchas sections, calibration of control, validation loops, plan-validate-execute, and bundling reusable scripts.

The McFuzzy Agent Forge both (a) contains its own skills (`forge-build-prd`, `forge-decompose-prd`, etc.) that users invoke directly, and (b) generates skills for user projects via `forge-build-agent-team`. Neither the forge's own skills nor the generation engine consistently followed these best practices:

- **Forge skills** were verbose, with large template blocks inline in `SKILL.md` (e.g., the 220-line PRD output format template in `forge-build-prd`). No skills had `## Gotchas` sections. No skills used progressive disclosure (`references/` directories).
- **Generated skills** from `forge-build-agent-team` used a template that lacked gotchas, validation loops, and progressive disclosure patterns. Agent templates included generic "Process and Workflow" steps identical across every agent - wasting context tokens on instructions the agent already knows.

Meanwhile, the `.agents/` directory migration (ADR-006) made the forge harness-agnostic. This opened the door to adopt the agentskills.io spec's directory conventions (`references/`, `scripts/`, `assets/`) as the standard for skill organization.

---

## Decision

### 1. Refactor All Forge Skills with Progressive Disclosure

Each forge skill that had large inline templates (>50 lines of reference material) was refactored:

| Skill | Content moved to `references/` |
|---|---|
| `forge-build-prd` | `references/prd-template.md` - 220-line PRD output format |
| `forge-decompose-prd` | `references/product-vision-template.md`, `references/feature-document-template.md` |
| `forge-build-feature-prd` | `references/feature-prd-template.md` |
| `forge-assign-models` | `references/model-inventory-schema.md` - JSON schema + Copilot tier catalog |
| `forge-build-agent-framework-solution` | `references/dotnet-layout.md`, `references/python-layout.md`, `references/package-references.md` |
| `forge-build-agent-team` | `references/vision-features-mode.md`, `references/feature-increment-mode.md` |

Each `SKILL.md` now references these files with explicit load triggers (e.g., "Load `references/prd-template.md` now and follow its structure").

### 2. Add Gotchas Sections to All Forge Skills

Every forge skill now has a `## Gotchas` section capturing environment-specific edge cases, common failure modes, and corrections to mistakes agents make without being told. Examples:

- `forge-build-prd`: "Never fabricate version numbers. Search for latest stable release."
- `forge-decompose-prd`: "FT- prefix collision with post-project Feature PRDs."
- `forge-assign-models`: "`ollama show` may fail on some quantized models."
- `forge-build-agent-team`: "Agent `name:` must match filename exactly."
- `forge-build-agent-framework-solution`: "Agent Framework APIs are evolving - verify against official docs."

### 3. Add Validation Loops

Skills that produce artifacts now include a `## Validation` section with a concrete checklist to run before considering the work done. This replaces generic "make sure it works" guidance.

### 4. Trim Generic Content

Sections that explained fundamentals the agent already knows (what a PDF is, what MoSCoW means, what HTTP does) were removed. The guiding principle: "Would the agent get this wrong without this instruction? If no, cut it."

### 5. Update the Generation Engine

`forge-build-agent-team`'s agent and skill templates were updated to include:
- `## Gotchas` section (populated with project-specific edge cases from the PRD)
- `## Validation` section with concrete checks
- Progressive disclosure guidance: when to create `references/`, `scripts/`, and `assets/`
- Trimmed generic "Process and Workflow" steps - replaced with project-specific workflow
- Calibration guidance: match specificity to fragility

### 6. New `forge-optimize-skills` Skill

A new meta-skill audits existing skills in `.agents/skills/` against the best practices rubric, produces `docs/SKILL-AUDIT.md` with scores and specific improvement suggestions, and can optionally apply approved changes.

---

## Consequences

### Positive

- **Leaner skills.** Forge skills are 30–50% shorter in `SKILL.md` body content. Large reference material loads only when needed.
- **Fewer agent mistakes.** `## Gotchas` sections prevent common failure modes before they happen.
- **Self-verifying skills.** `## Validation` sections give agents concrete checks rather than vague "verify it works" instructions.
- **Better generated skills.** Skills produced by `forge-build-agent-team` now follow best practices out of the box - gotchas, validation, progressive disclosure.
- **Auditable quality.** `forge-optimize-skills` provides a structured, repeatable way to measure and improve skill quality.
- **Spec-aligned.** Skill directory structure (with `references/`, `scripts/`, `assets/`) matches the agentskills.io specification.

### Negative

- **More files in templates.** Each forge skill now has 1–3 additional files in `references/`. Total template file count increased by ~10 files.
- **Generation complexity.** `forge-build-agent-team` must now populate gotchas and validation sections during skill generation - this requires deeper PRD analysis.
- **Learning curve.** Users unfamiliar with progressive disclosure may not immediately understand why content was split across files.

### Neutral

- **Existing generated skills are unaffected.** They continue to work. `forge-optimize-skills` can improve them when the user is ready.
- **Bootstrap scripts unchanged.** The template copy mechanism (`glob`-based) handles subdirectories automatically - no script changes were needed for `references/` support.

---

## References

- [agentskills.io Best Practices](https://agentskills.io/skill-creation/best-practices)
- [agentskills.io Specification](https://agentskills.io/specification)
- ADR-001: Agent/Skill Separation and Progress Reporting
- ADR-006: Migrate from `.github/` to `.agents/` Directory
