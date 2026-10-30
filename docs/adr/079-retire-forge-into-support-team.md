# ADR-079: Retire Forge scaffolding into a repository-derived support team

- **Status:** Accepted
- **Date:** October 2026
- **Related:** [ADR-069](069-skill-consolidation-and-namespacing.md), [ADR-078](078-task-and-phase-testing-strategy.md)

## Context

Forge is a lifecycle, not a permanent dependency. A completed project still
carries `docs/PRD.md`, `docs/features/`, authoring state, an execution manifest,
engine state, and the Forge skills that produced the build. Those files are
correct during the build and misleading afterwards: they describe requirements
that are already implemented and a process that will not run again.

Deleting the Forge directories alone is not enough. The generated specialist
agents point at `docs/PRD.md` and feature documents, own requirement IDs, and
frame their work as implementation phases. Removing the files would leave dead
links and roles with no repository surface.

The repository itself is the only durable source for what the team should own
after the build: source directories, tests, CI, manifests, and project docs.

## Decision

1. **Ship a one-shot retirement skill.** `forge-retire-project` inventories a
   completed repository, removes classified Forge artifacts and skills, rewrites
   the surviving agents and project skills, and verifies the result before
   deleting itself.
2. **Keep the generated agents and project skills.** The generated specialists
   survive. Their ownership is re-derived from the actual source tree, not from
   the retired requirements. Roles that own no area are merged or removed;
   source areas with no owner are surfaced to the user.
3. **Replace the build orchestrator with a support lead.** `project-orchestrator`
   becomes `support-lead`, owning intake, routing, cross-module coordination,
   release coordination, and escalation. `forge-team-builder` and
   `workflow-orchestrator` are removed because they only exist for the build.
4. **Write `docs/SUPPORT.md`.** The support charter records the roster,
   ownership map, intake and triage flow, release checklist, and escalation
   path, using the repository's real commands.
5. **Make deletion deterministic and bounded.** A Node inventory classifies
   paths as delete, rewrite, or review. The apply step removes only classified
   paths, protects project skills named in `docs/SKILL-CANDIDATES.json`, refuses
   a live engine or a dirty worktree, and supports `--archive` and `--keep`.
6. **Expose the lifecycle through the launcher.** `forge-launcher retire` is a
   read-only inventory by default and `--apply` runs the skill. It installs the
   skill from bundled resources for repositories that predate it and verifies
   from an independent copy after the skill self-deletes.
7. **Verify before self-deletion.** The gate rejects surviving Forge artifacts,
   dangling PRD/feature/task/engine references, invalid agent or skill
   frontmatter, missing scopes, and missing `docs/SUPPORT.md`. Coverage gaps are
   errors under `--strict-coverage`.

## Consequences

- A finished project becomes an ordinary maintained repository with no dead
  build links and no Forge skill inventory.
- The agent team changes meaning: from implementers of a plan to maintainers of
  modules. Their prompts and scopes must be rewritten, not merely retained.
- Historical ADRs, research notes, and changelogs are preserved. Retirement
  changes active documentation, not history.
- The retirement skill is destructive by design. Dry-run is the default, git
  history is the recovery path, and archive mode is available for review
  evidence or audit requirements.
- The launcher keeps a durable way to invoke retirement after the in-repo skill
  has removed itself.

## Alternatives considered

- **Delete the Forge directories only:** rejected because agents would retain
  dead references and build-phase ownership.
- **Keep the Forge skills as maintenance tooling:** rejected because the user
  asked for a clean repository and the maintenance team does not need authoring
  or engine skills.
- **Rewrite agents from their previous responsibility text:** rejected because
  that text describes planned work, not the code that exists. Repository
  evidence is the authority.
- **Keep the retirement skill installed:** rejected because it is one-shot and
  would become another permanent Forge artifact.
- **Archive by default:** rejected because most projects want a clean tree and
  git already preserves history; `--archive` remains available for evidence.

## References

- [Retirement skill](../../templates/skills/forge-retire-project/SKILL.md)
- [Inventory rules](../../templates/skills/forge-retire-project/references/inventory.md)
- [Support-team contract](../../templates/skills/forge-retire-project/references/support-team.md)
- [Retirement safety](../../templates/skills/forge-retire-project/references/safety.md)
- [Launcher guide](../forge-launcher.md)
- [Changelog](../updates.md), v3.119
