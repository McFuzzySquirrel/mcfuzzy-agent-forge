# ADR-033: Brand Rename from "Agent Forge" to "MyForge"

**Date:** 2026-08-29
**Status:** Accepted
**Relates to:** ADR-008 (skill-forge integration), ADR-016 (workforce compiler and FlowForge kernel)

---

## Context

The project has grown beyond its original identity. The brand "McFuzzy Agent
Forge" was coined early and appears throughout the README, documentation, agent
templates, and skill templates. The working name has settled on **MyForge** -
shorter and no longer tied to the author's handle. A rename was requested.

Two technical naming surfaces already exist and are intentionally **not**
branding:

1. **`forge-*` technical identifiers** - package/CLI/skill names
   (`forge-launcher`, `forge-workflow-engine`, `forge-execution-adapter`,
   `forge-workforce-compiler`), `FORGE_*` environment variables, and skill
   directory names. These are wired into the launcher's skill dispatch, docs'
   example commands, and user environments.
2. **FlowForge** - the packaged kernel artifact produced by
   `forge-workforce-compiler`. It is a distinct sub-brand with its own
   constant names (`flowforge`/`FlowForge`/`FLOWFORGE`) across the compiler and
   kernel adapter.

## Decision

- Rebrand all **human-facing prose** from "McFuzzy Agent Forge", "Agent Forge",
  "agent forge", and "agent-forge" to **MyForge** (kebab/package-ID contexts use
  `myforge`).
- **Do not rename** the `forge-*` technical identifiers, `FORGE_*` env vars, or
  skill directory/agent names - they remain shorter and are heavily referenced.
- **Do not rename** the FlowForge kernel sub-brand.
- The workforce compiler's default package ID root changes from
  `dev.agent-forge.*` to `dev.myforge.*` so newly compiled workforce packages
  carry the new branding; the tests asserting the default follow suit.
- Repo URLs and local-directory references (`mcfuzzy-agent-forge`, the GitHub
  repo location) are left unchanged unless the repository itself is renamed
  later.

## Consequences

Positive:

- Consistent user-facing identity across README, docs, templates, and
  generated artifacts, with no churn to stable technical names.
- No breaking changes for downstream users of the `forge-*` CLIs, env vars, or
  the FlowForge kernel format.

Negative:

- Default workforce package IDs change for new compiles
  (`dev.agent-forge.*` → `dev.myforge.*`); any code that hardcoded the old
  default must be updated (only the compiler's own test asserted it).
- Historical records (this repo's ADRs and research notes) were rewritten in
  place rather than preserved verbatim, trading archive fidelity for a single
  consistent brand.
- The repo/directory name still says `mcfuzzy-agent-forge`; renaming that is a
  separate follow-up (requires a GitHub repo rename + doc URL updates).

Trade-offs considered:

- **Rename everything, including `forge-*` names** - rejected: broad churn
  across packages, CLIs, env vars, skill dispatch, and tests for no functional
  gain, plus a breaking change for existing users.
- **Keep FlowForge** - accepted as a deliberate decision; it identifies the
  packaged kernel artifact, not the toolchain brand.

## References

- Implementation: README, `docs/`, `plan.md`, `AGENTS.md`,
  `templates/agents/*`, `templates/skills/*/SKILL.md` and package descriptions,
  launcher branding strings (`scripts/forge-launcher/scripts/format.ts`,
  `launcher.ts`, `launcher.test.ts`), workforce compiler branding strings and
  default package ID (`scripts/compiler.ts`, `scripts/compiler.test.ts`).
- Changelog: `docs/updates.md` v3.30.
