# ADR-069: Consolidate and namespace the Forge skill set

**Date:** 2026-10-26
**Status:** Accepted
**Relates to:** ADR-007 (skill best-practices adoption), ADR-008 (skill-forge integration), ADR-060 (interactive requirements authoring)

## Context

The Forge skill set grew in layers: requirements authoring, team generation,
project-skill generation, execution, and skill-quality tooling. That left two
overlapping pairs and an inconsistent namespace.

- `forge-optimize-skills` re-implemented the same six-axis, agentskills.io audit
  that the `skill-review` package already performed with runnable Node tooling.
  Its own instructions deferred to `skill-review` when available, so it only
  survived as a manual fallback that duplicated the rubric and report format.
- `forge-auto-build-prd` was a thin wrapper whose entire body redirected to
  `forge-build-prd`. `forge-build-prd` already stops after saving the PRD, so the
  wrapper added the misleading "auto" label to the one skill that is always
  interactive.
- Three meta-skills (`skill-review`, `skill-creator`, `skill-review-updater`)
  lacked the `forge-` prefix while the other meta-skills had it. The exclusion
  rule "don't audit `forge-*` meta-skills" therefore did not match reality, and
  the launcher bootstrapped every skill — including maintainer-only tooling —
  into each target project.

## Decision

1. **Delete `forge-optimize-skills`.** `forge-skill-review` (formerly
   `skill-review`) is the single audit skill, covering the automated Node path
   and the manual agent-driven path. Its exclusion rule now names the meta-skills
   explicitly rather than inferring them from a prefix.
2. **Delete `forge-auto-build-prd`.** `forge-build-prd` is the single
   requirements-authoring entry point; the launcher, Console, agents, and docs
   queue `/forge-build-prd` directly.
3. **Prefix all meta-skills with `forge-`.** `skill-review` →
   `forge-skill-review`, `skill-creator` → `forge-skill-creator`,
   `skill-review-updater` → `forge-skill-review-updater`.
4. **Exclude maintenance-only skills from bootstrap.** The launcher keeps
   `forge-skill-review-updater` in its published resources but does not copy it
   into a bootstrapped target repository.

The build/execution split is unchanged: `forge-auto-build` remains the
terminal/headless full-pipeline conductor, `project-orchestrator` →
`forge-orchestrate-build` remains the interactive path, and `workflow-orchestrator`
→ `forge-workflow-engine` remains the autonomous path.

## Consequences

- The template set drops from 16 to 14 skills, removing two maintenance
  surfaces and one duplicated rubric.
- One authoring entry point and one audit entry point replace the former
  wrapper/duplicate pairs.
- The `forge-*` namespace is consistent, so the meta-skill exclusion rule is
  accurate and project audits no longer accidentally score Forge tooling.
- Target repositories no longer carry a rubric-maintenance skill they never use.
- Every reference to the removed or renamed skills had to be migrated in one
  change: skill `SKILL.md` files and references, agent personas, launcher
  commands and tests, the Console authoring targets, the prompt playbook,
  `docs/testing-guide.md`, `docs/REPOSITORY_SUMMARY.md`, and the CI matrix.

## References

- Templates: `templates/skills/forge-skill-review/`,
  `templates/skills/forge-skill-creator/`,
  `templates/skills/forge-skill-review-updater/`,
  `templates/skills/forge-build-prd/`.
- Bootstrap allowlist: `scripts/forge-launcher/scripts/bootstrap.ts`.
- Launcher routing: `scripts/forge-launcher/scripts/launcher.ts`.
- CI matrix: `.github/workflows/validation.yml`.
- Changelog: [updates.md](../updates.md), v3.105.
