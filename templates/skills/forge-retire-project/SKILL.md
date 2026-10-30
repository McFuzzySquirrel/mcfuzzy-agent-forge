---
name: forge-retire-project
description: "Retire Forge authoring and execution scaffolding from a completed project, then rewrite the generated agents and skills into a repository-derived support team with no PRD, feature, or task dependencies."
---

# Skill: Retire a Forge Project

You are converting a completed Forge project into an ordinary maintained
repository. The build is over. Requirements, feature documents, execution
manifests, engine state, and the Forge skills that produced them must go. The
specialist agents stay, but their ownership must be re-derived from the code that
actually exists — not from the retired PRD.

This is a destructive migration with a dry run. Never delete a path that the
inventory did not classify, and never rewrite an agent to claim a module that is
not in the repository.

---

## When to use this skill

- The project's implementation is complete and accepted.
- The user wants a clean repository that no longer carries Forge lifecycle files.
- The user wants the generated specialists to continue as maintainers.

Do **not** use this skill to start a new feature, to author requirements, or on a
repository whose engine is still running. Stop the engine first.

---

## Process

### Step 0: Resolve the repository and load the safety contract

Load [`references/safety.md`](./references/safety.md) now. It defines the
preflight gates, archive mode, tracked-path rules, and self-deletion contract.

1. Resolve the repository root from the prompt, `--repo`, or the current
   directory.
2. Detect the harness root: `.agents`, `.opencode`, `.claude`, or `.github`.
3. Confirm the repository is a git worktree. If it is not, stop and ask the user
   to initialize or restore git history before running this skill.
4. Confirm the Forge engine is not running. A live `docs/engine.pid` or a
   `docs/WORKFLOW-STATE.json` status of `running` or `paused` blocks the
   migration. Tell the user to run `forge-launcher engine-run --stop`.
5. Confirm the working tree is clean. If it is dirty, ask the user to commit or
   stash; only continue on an explicit `--allow-dirty`.

If any gate fails, stop. Do not delete anything to "make room".

### Step 1: Build the inventory

Run the read-only inventory from the installed skill directory:

```bash
node .agents/skills/forge-retire-project/scripts/inventory.mjs --repo . --json
```

Use `.opencode`, `.claude`, or `.github` instead of `.agents` when that is the
detected harness. The command writes nothing. It classifies paths as:

- **delete** — requirements, authoring state, execution state, engine files,
  Forge template agents, and Forge skills.
- **rewrite** — the support lead, specialist agents, project skills, active
  docs, and configuration that still references the retired lifecycle.
- **review** — Forge-specific guides that may be project documentation or may be
  leftover build material.

Load [`references/inventory.md`](./references/inventory.md) when a path is
ambiguous or when the user asks why something is in a category.

### Step 2: Present the plan and confirm

Show the user, in this order:

1. Blocking preflight failures, if any.
2. The delete list grouped by purpose.
3. The rewrite list.
4. The review list and your recommendation for each item.
5. The surviving source areas and which agent will own them.

In interactive mode, wait for explicit approval before applying. In headless
mode (`FORGE_HEADLESS=1`), continue only when the invocation includes `apply`;
otherwise print the plan and stop.

### Step 3: Apply the deletions

```bash
node .agents/skills/forge-retire-project/scripts/apply.mjs --repo . --apply
```

Add `--archive` to move removals to `.forge-archive/<timestamp>/` instead of
deleting them. Add `--allow-dirty` only when the user explicitly accepted it.
Add `--keep <glob>` for any path the user wants preserved.

The script deletes only classified paths, cleans the two Forge entries from
`.gitignore`, and never removes `forge-retire-project` itself. If it reports a
preflight failure, stop and resolve it.

### Step 4: Re-derive the support team from the repository

Load [`references/support-team.md`](./references/support-team.md) before writing
any agent. It contains the role contract, section templates, and the
`docs/SUPPORT.md` structure.

Build the ownership map from evidence, not memory:

1. Read the source directories, manifests, tests, CI files, and package scripts
   reported by the inventory.
2. For each surviving specialist, identify the paths it actually understands.
   Use its previous responsibilities only as a hint; confirm against the files.
3. Check coverage in both directions:
   - Every source area belongs to at least one agent.
   - Every agent owns at least one real area.
4. If an area is unowned, either broaden the closest specialist or add a new
   specialist. Ask the user before inventing a role.
5. If an agent owns nothing, recommend merging it into a related agent or
   removing it. Do not keep a role that has no repository surface.

### Step 5: Rewrite the support lead

Rename `project-orchestrator.md` to `support-lead.md` and rewrite it. The
support lead owns:

- intake, triage, and routing to the owning specialist
- cross-module coordination and escalation to the user
- release coordination: version, changelog, tag, and verification evidence
- architecture decisions recorded as ADRs after the build

It does not implement specialist work. Preserve `mode: all`, `model`, and any
valid skill associations; remove associations to deleted Forge skills.

### Step 6: Rewrite every specialist agent

For each agent in the rewrite list:

1. Keep the filename and `name`.
2. Rewrite `description` as one double-quoted line with no PRD, feature, or task
   language.
3. Write `## Scope` with backticked paths and globs that the verify script can
   resolve against the repository.
4. Write `## Support Responsibilities` covering bug fixes, regression tests,
   dependency and security updates, performance, docs for the owned area, and
   review of changes in that area.
5. Write `## Triage and Escalation` with the reproduce → isolate → fix → verify
   → release path and the handoff to the support lead.
6. Write `## Quality Bar` with the repository's real commands from the
   manifests and CI.
7. Write `## Collaboration` naming the support roles it works with.
8. Remove every requirement ID, feature reference, task contract, phase, and
   Forge artifact link.

Do not preserve headings that only made sense during the build. A support agent
is not a smaller version of a build agent; it is a maintainer of a specific part
of this repository.

### Step 7: Rewrite project skills and active documentation

Project skills (non-`forge-` directories, or names protected by
`docs/SKILL-CANDIDATES.json`):

- Keep the name and frontmatter valid.
- Convert build steps into maintenance runbooks: reproduce, inspect, change,
  test, release.
- Delete a skill only when its entire purpose was authoring requirements or
  driving the build.

Active documentation:

- Create `docs/SUPPORT.md` from the ownership map.
- Update `README.md`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, and
  `ARCHITECTURE.md` when they mention the retired lifecycle.
- Update CI workflows and package scripts that call `forge-launcher`, the
  engine, PRD validation, or `docs/PROGRESS.md`.
- Leave historical ADRs, research notes, and changelogs intact. If they describe
  Forge, mark them as historical rather than rewriting history.

### Step 8: Verify and remove the retirement skill

Run the gate:

```bash
node .agents/skills/forge-retire-project/scripts/verify.mjs --repo . --strict-coverage
```

Pass the same `--keep` globs that were used for the apply step. Fix every error
and rerun. Warnings about uncovered source areas or ownerless agents must be
resolved or explicitly accepted by the user.

Only after the gate passes:

```bash
node .agents/skills/forge-retire-project/scripts/self-delete.mjs --repo .
```

If self-deletion is unavailable on the platform, print the final command for the
user and stop; do not leave a half-deleted directory.

### Step 9: Report the handoff

Tell the user:

- what was removed and what was archived
- the support roster and each agent's scope
- any accepted warnings or open ownership decisions
- the exact verification command that passed
- that the changes are uncommitted unless the caller asked for a commit

Do not commit unless the invocation explicitly includes `--commit`.

---

## Gotchas

- **Deleting Forge skills without rewriting agents leaves dead links.** An agent
  that says "read `docs/PRD.md`" is broken even if the file is gone. Rewrite the
  body in the same migration.
- **Project skills are not Forge skills.** Read `docs/SKILL-CANDIDATES.json`
  before it is deleted; protect every `create` and `extend` name, and every
  `reuse` name that is not itself a `forge-` skill. The prefix alone is not
  enough when a project deliberately uses it.
- **Ownership must come from files.** A previous responsibility list is a hint,
  not evidence. If an agent claims `src/api/` but that directory no longer
  exists, the new scope must say so.
- **Historical documents are not active documentation.** Do not rewrite ADRs,
  research notes, or changelog entries. Scan only active docs, agents, and
  skills.
- **A dirty worktree destroys the recovery story.** Git history is the only
  undo for a default delete. Refuse to run until the tree is clean or the user
  passes `--allow-dirty` deliberately.
- **A running engine will rewrite files under you.** Stop it before applying
  deletions, even if the manifest looks finished.
- **Self-deletion is last.** Verify first. If the skill removes itself early,
  the remaining migration cannot be validated or retried.

---

## Validation

- [ ] Preflight had no blocking failures and the tree was clean or explicitly
      allowed.
- [ ] The delete list contained only classified Forge artifacts and skills.
- [ ] Project skills named in `SKILL-CANDIDATES.json` survived.
- [ ] Every surviving agent has a valid single-line description and `mode: all`.
- [ ] Every surviving agent has a `## Scope` with real repository paths.
- [ ] Every source area is owned and every agent owns a real area.
- [ ] `docs/SUPPORT.md` exists and names every surviving agent.
- [ ] No active doc, agent, or skill references `docs/PRD.md`,
      `docs/features/`, `docs/PROGRESS.md`, `EXECUTION-MANIFEST.json`,
      `WORKFLOW-STATE.json`, `SKILL-CANDIDATES.json`, `forge-task`,
      `forge-result`, or a `forge-*` skill.
- [ ] `verify.mjs --strict-coverage` exits 0.
- [ ] `self-delete.mjs` ran only after verification passed.
- [ ] Changes are uncommitted unless `--commit` was explicitly requested.
