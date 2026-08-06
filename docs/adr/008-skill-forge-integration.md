# ADR-008: Integrate Skill-Forge and Remove Microsoft Agent Framework Skill

**Date:** 2026-08-03
**Status:** Accepted

---

## Context

Two changes were requested to make McFuzzy Agent Forge more robust and framework-agnostic:

1. **Skill creation and review robustness.** The `forge-build-agent-team` skill generates project-specific skills, but the generation process had no structured quality gate. Skills were written from a template without a validation loop, meaning generated skills could score below 2.0 on the agentskills.io rubric before any agent used them. The companion repository [skill-forge](https://github.com/McFuzzySquirrel/skill-forge) solves this with three purpose-built skills: `skill-creator` (structured creation workflow), `skill-review` (automated six-axis audit with portable TypeScript tooling), and `skill-review-updater` (rubric maintenance).

2. **Microsoft Agent Framework is too platform-specific.** The `forge-build-agent-framework-solution` skill scaffolded .NET or Python projects for Microsoft Agent Framework. This is a narrow, platform-specific concern that doesn't belong in a framework-agnostic forge. Users who need Agent Framework scaffolding can create a project-specific skill using `skill-creator`. Keeping the skill in the forge created misleading scope and the skill needed ongoing maintenance as Agent Framework APIs evolved.

---

## Decision

### 1. Integrate Skill-Forge Skills

Three skills from [skill-forge](https://github.com/McFuzzySquirrel/skill-forge) are added to `templates/skills/`:

#### `skill-creator`
A five-step guided creation workflow:
1. **Interview** (using `references/interview-questions.md`) -structured Q&A gathering name, purpose, trigger phrase, complexity, gotchas, validation needs, calibration guidance
2. **Template Selection** -flat (≤3 steps) vs. modular (≥4 steps, branching, or reference material)
3. **Scaffold** -generates skill files against the six quality axes using `references/quality-axes.md`
4. **Pre-flight Check** (using `references/preflight-checklist.md`) -self-validation against a blocker list before formal audit
5. **Validation** -runs `skill-review` and loops until all axes score ≥2.0

Reference files: `flat-template.md`, `modular-template.md`, `interview-questions.md`, `quality-axes.md`, `preflight-checklist.md`.

#### `skill-review`
Agent-readable skill audit + portable TypeScript CLI:
- Same six-axis rubric as `forge-optimize-skills` (context economy, gotchas coverage, procedural clarity, progressive disclosure, calibration, validation)
- Adds a **reviewer-style proxy score** combining evidence from multiple axes
- Ships with deterministic TypeScript scripts in `scripts/`: `rubric.ts` (scoring engine), `detect.ts` (skill file discovery + git diff integration), `skill-review.ts` (CLI entry point), `providers/` (GitHub, GitLab, Azure DevOps, stdout)
- CI/CD integration: auto-detects changed `SKILL.md` files from git diff, posts audit comments on PRs

Usage after bootstrap:
```bash
cd .agents/skills/skill-review && npm install
npm run skill-review -- --provider stdout --min-score 1.5
npm run skill-review -- --provider github --min-score 2.0 --fail-below
```

#### `skill-review-updater`
A six-step workflow that:
1. Captures the current skill-review baseline from local files
2. Fetches latest guidance from agentskills.io
3. Computes rubric deltas (missing, weak, or outdated checks)
4. Branches by evidence confidence and review impact
5. Produces a prioritized update plan with acceptance criteria
6. Validates traceability and delivers a handoff-ready plan

Reference files: `quality-baseline.md`, `rubric-mapping.md`, `validation-checks.md`, `offline-fallback.md`.

### 2. Update `forge-build-agent-team` to Use `skill-creator`

Step 4 (Identify Reusable Skills) now includes guidance to use `skill-creator` for each project-specific skill, running the structured interview and quality validation workflow. Step 6 (Write the Skill Files) prioritizes `skill-creator` and falls back to the inline template only when `skill-creator` is not available.

A `## Collaboration` section is added listing `skill-creator` and `skill-review`.

### 3. Update `forge-optimize-skills` to Reference `skill-review`

`forge-optimize-skills` remains for environments without Node.js. Its intro now surfaces `skill-review` as the preferred automated approach:

```bash
cd .agents/skills/skill-review && npm install
npm run skill-review -- --provider stdout --min-score 1.5
```

### 4. Remove `forge-build-agent-framework-solution`

The Microsoft Agent Framework scaffolding skill is removed entirely. Rationale:

- **Too platform-specific.** The forge targets any stack. A skill dedicated to one vendor's SDK creates misleading scope.
- **Maintenance burden.** Agent Framework APIs evolve. Every release required checking and updating the skill's package references, layout, and code snippets. This is appropriate for a project-specific skill, not a forge template.
- **Replaced by `skill-creator`.** Users who need Agent Framework scaffolding can use `skill-creator` to build a project-specific skill via the structured interview. The result will be better calibrated to their exact PRD than the generic template was.

---

## Consequences

### Positive

- **Quality from the start.** Every project-specific skill built with `skill-creator` passes a pre-flight check and `skill-review` validation before agents use it. This eliminates the most common source of low-scoring generated skills.
- **Automated quality gates.** `skill-review`'s CI/CD tooling enables teams to enforce minimum scores on every PR that touches a `SKILL.md` file -no manual audit required.
- **Rubric maintenance.** `skill-review-updater` gives a repeatable, evidence-backed process for keeping the rubric aligned with agentskills.io guidance as it evolves.
- **Framework-agnostic forge.** Removing the Agent Framework skill makes clear that the forge works with any stack -not just Microsoft's. Users are guided to create project-specific scaffolding skills instead.

### Negative

- **Node.js dependency.** `skill-review` requires Node.js 18+ and `npm install` before the CLI scripts run. This is an opt-in -the skill itself and manual audit via `forge-optimize-skills` work without it. The `SKILL.md` makes the prerequisite explicit.
- **Removed Agent Framework skill.** Existing users who relied on `forge-build-agent-framework-solution` will need to create a project-specific skill using `skill-creator`. Their existing scaffolds are unaffected.

### Neutral

- **Bootstrap scripts unchanged.** Both `bootstrap.sh` and `bootstrap.ps1` use recursive copy (`cp -r` / `Copy-Item -Recurse`), so `skill-review/scripts/` is included automatically. No script changes needed.
- **`forge-optimize-skills` preserved.** The manual agent-driven audit remains for environments without Node.js or for users who prefer it. Both paths produce the same rubric scores.

---

## References

- Skill-Forge repository: [https://github.com/McFuzzySquirrel/skill-forge](https://github.com/McFuzzySquirrel/skill-forge)
- Skill: [skill-creator](../../templates/skills/skill-creator/SKILL.md)
- Skill: [skill-review](../../templates/skills/skill-review/SKILL.md)
- Skill: [skill-review-updater](../../templates/skills/skill-review-updater/SKILL.md)
- Skill: [forge-build-agent-team](../../templates/skills/forge-build-agent-team/SKILL.md)
- Skill: [forge-optimize-skills](../../templates/skills/forge-optimize-skills/SKILL.md)
- [agentskills.io Best Practices](https://agentskills.io/skill-creation/best-practices)
- ADR-007: Adopt agentskills.io Best Practices for Skill Design
