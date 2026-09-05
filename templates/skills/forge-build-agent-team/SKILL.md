---
name: forge-build-agent-team
description: "Analyze a Product Requirements Document (PRD), Product Vision with Feature documents, or Feature PRD and generate a complete team of custom agents plus a persisted skill-candidate handoff. Use this skill when asked to create, scaffold, or design a development team from requirements documents."
---

# Skill: Build a Custom Agent Team from a PRD

Build specialist agent files from a PRD, product vision, or feature PRD. This
stage writes agents and `docs/SKILL-CANDIDATES.json`; it does not create skill
packages or an execution manifest.

## Process

### Step 0: Detect mode

Load `references/detect-harness.md` and resolve
`HARNESS_AGENTS_DIR`/`HARNESS_SKILLS_DIR`. Select:

- **Full build:** a complete PRD and no existing project team.
- **Vision + features:** `docs/product-vision.md` plus `docs/features/`.
- **Feature increment:** a Feature PRD plus an existing team.

Treat `.github/agents`, `.github/skills`, `.agents`, `.opencode`, and `.claude`
as supported layouts. Never assume `.agents` when `.github` is explicit.

### Step 1: Analyze requirements

Read the complete source documents. Extract technology, structure, functional
requirements, non-functional requirements, phases, testing, deployment, and
cross-cutting concerns. In feature mode, read all affected existing agents and
preserve unaffected files byte-for-byte.

### Step 2: Define non-overlapping agents

Map every requirement to exactly one owner. Required coverage includes
architecture/build and QA; add domain agents only when the source requires
them. For each agent define expertise, references, responsibilities by path or
requirement, constraints, output standards, validation, gotchas, and
collaboration. Agent `name` must match its filename and every description must
be single-line, double-quoted YAML.

### Step 3: Write the team

Write only new or affected files under the resolved harness agents directory.
Do not create a permanent persona for skill generation. Generated agents must
use stable names and qualified ownership references. Preserve existing
manifest IDs and downstream artifacts in incremental work.

### Step 4: Identify skill candidates

Record a candidate only when a reusable process repeats or has fragile,
project-specific steps. Choose `reuse`, `extend`, `create`, or `omit`; one-off
work remains an agent responsibility. The team stage must not write
`SKILL.md` packages.

The independent `forge-build-project-skills` stage reuses `skill-creator` for
interview/template/preflight work and `skill-review` for the six-axis review.
Record planned responsibilities and references, not generated package content.

### Step 5: Persist the handoff

Write `docs/SKILL-CANDIDATES.json` atomically using
[`references/skill-candidates.md`](./references/skill-candidates.md).

The handoff must contain exactly `version: 1` and `candidates`. Each candidate
must contain exactly `name`, `description`, `consumers`, `action`, and `reason`.
`action` is one of `reuse`, `extend`, `create`, or `omit`. Missing or empty
`candidates` explicitly completes the stage with no skills required.

### Step 6: Validate the team

Run the standalone validator from this package:

```bash
node scripts/validate-frontmatter.mjs --repo <repo-root>
node scripts/validate-team.mjs --repo <repo-root> --fail-structural \
  --agents-only --min-axis 2 --fail-axis-below
```

The team-stage gate validates agents and the candidate handoff without
requiring project skill packages that do not exist until the next stage. The
independent `forge-build-project-skills` stage runs the same validator with
`--skills-only --fail-structural --min-axis 2 --fail-axis-below` against only
the affected non-omit candidate files. Both gates reject invalid structure and
block any failing axis rather than relying on an average.

## Handoff ownership

- **Team stage:** agents, ownership, candidate IDs, references, and handoff.
- **Skills stage:** package creation, reuse/extension decisions, review, and
  candidate outcome.
- **Manifest/compiler:** execution artifacts and task IDs; this skill never
  creates or replaces them.

## Gotchas

- **Team/package boundary.** Creating a skill package here bypasses the
  independent skills model and makes retries regenerate valid teams.
- **Candidate names are stable.** Preserve the existing candidate name and
  action when reconciling; do not derive a new name from generated package
  paths.
- **No-skills is success.** Missing or empty candidates are explicit completion;
  do not treat them as failed discovery.
- **`.github` is active.** Discovery must include `.github/skills` and
  `.github/agents`, not only `.agents`.
- **Whole Markdown is not YAML.** Parse only the initial fenced frontmatter
  block; headings, lists, and code samples after the closing delimiter are
  Markdown and must not be interpreted as metadata.

## Validation

- [ ] Every requirement maps to exactly one agent.
- [ ] No agent ownership overlaps or orphan required roles exist.
- [ ] Existing unaffected files and manifest IDs are unchanged.
- [ ] `docs/SKILL-CANDIDATES.json` validates against the versioned handoff.
- [ ] Every non-omit candidate consumer resolves to a generated agent name.
- [ ] `validate-frontmatter.mjs` and `validate-team.mjs` pass with structural
      and per-axis blocking enabled.
- [ ] No skill package or execution manifest was created by this stage.
