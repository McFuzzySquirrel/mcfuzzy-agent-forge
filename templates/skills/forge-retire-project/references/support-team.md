# Support Team Contract

Load this file before rewriting any agent, project skill, or `docs/SUPPORT.md`.
The team must describe this repository as it exists today.

## Principles

1. **Repository evidence beats old responsibilities.** A scope line is valid only
   when the path or glob matches real files.
2. **One owner per area.** Multiple agents may collaborate, but exactly one owns
   changes to a path.
3. **No build vocabulary.** Remove PRD, feature, requirement ID, phase, task
   contract, manifest, engine, and "implementation" language unless the
   repository itself contains a product feature by that name.
4. **Support work is continuous.** Responsibilities are maintenance: defects,
   regressions, dependencies, security, performance, docs, reviews, releases.
5. **Do not invent process.** Use the commands and conventions already in the
   repository. If the repository has no test command, say so rather than
   inventing one.

## Role mapping

Start from the existing agents and map each to one of these support shapes. Do
not create a role that has no code to own.

| Support shape | Owns | Typical responsibilities |
|---|---|---|
| Support lead | triage, routing, release | intake, assignment, cross-module coordination, release checklist, ADRs, escalation |
| Domain maintainer | one source area | fixes, regression tests, dependency updates, docs, review |
| Quality maintainer | test infrastructure | flaky tests, CI signal, coverage gaps, test tooling |
| Infrastructure maintainer | build, CI, packaging | pipelines, releases, security patches, runtime configuration |
| Documentation maintainer | user and developer docs | onboarding, troubleshooting, architecture notes |

A small repository may need only a support lead and one or two domain
maintainers. Merge roles rather than keeping empty ones.

## Agent template

```markdown
---
name: <filename without .md>
description: "<one line, double-quoted, no build vocabulary>"
mode: all
---

You are the **<role>** for this repository. You maintain <area> and keep it
working after the original build.

## Scope

- `src/<area>/**`
- `tests/<area>/**`
- `docs/<area>.md`

## Support Responsibilities

- Diagnose and fix defects in the owned area.
- Add a regression test for every fixed defect.
- Keep dependencies used by the owned area current and secure.
- Review changes that touch the owned paths.
- Keep the owned documentation accurate.

## Triage and Escalation

1. Reproduce the report with the repository's documented command.
2. Isolate the smallest failing path in the owned area.
3. Fix the cause, not the symptom, and add the regression test.
4. Run the owned checks from `## Quality Bar`.
5. Hand cross-module or product-level decisions to the support lead.

## Quality Bar

- Build: `<real command>`
- Test: `<real command>`
- Lint: `<real command or "not configured">`

## Collaboration

- **support-lead** — routing, priority, release coordination.
- **<related-agent>** — shared boundary at `<path>`.
```

## Scope syntax

- Use backticks around every path or glob. The verifier reads only the
  `## Scope` section.
- Prefer directory roots: `src/api`, `src/api/**`, `tests/api`.
- A bare directory matches itself and everything below it.
- Do not list a path that does not exist. If a path is planned but absent,
  leave it out.
- Every top-level source area from the inventory must appear in at least one
  agent's scope.

## `docs/SUPPORT.md` template

```markdown
# Support

This repository is maintained by the agent team below. The original build
requirements and execution tooling have been retired.

## Team

| Agent | Scope | Invoke when |
|---|---|---|
| support-lead | triage, release, cross-module | priority, routing, release, architecture |
| <agent> | `src/<area>/**` | defects and changes in <area> |

## Ownership

| Area | Owner | Checks |
|---|---|---|
| `src/<area>` | <agent> | `<test command>` |

## Intake

1. Capture the report with reproduction steps and expected behavior.
2. Route to the owning agent from the ownership table.
3. The owner reproduces, fixes, adds a regression test, and runs the owned
   checks.
4. Cross-module or product decisions go to the support lead.
5. The support lead records the release evidence.

## Release checklist

- [ ] Owned checks pass.
- [ ] Changelog or release notes updated.
- [ ] Version bumped when the project publishes one.
- [ ] No open blocker or accepted-risk item without an owner.

## Escalation

- Unclear ownership: support lead.
- Cross-module change: support lead coordinates the owners.
- Product or scope decision: the human maintainer.
```

## Project skill rewrite

A surviving project skill should read like an operational runbook:

```markdown
## When to use
## Inputs
## Procedure
## Verification
## Failure modes
```

Remove references to requirement IDs, phase numbers, `docs/PRD.md`,
`docs/features/`, `docs/PROGRESS.md`, and Forge commands. Keep the skill's name
and valid frontmatter.

Delete a project skill only when every step exists to author requirements or
drive the Forge build. If it contains one useful maintenance procedure, rewrite
that procedure instead.
