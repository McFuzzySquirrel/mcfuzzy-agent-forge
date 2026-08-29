# ADR-010: Forge Launcher -Interactive CLI for the Full MyForge Lifecycle

**Date:** 2026-08-05
**Status:** Superseded (implementation layer) by [ADR-023](023-forge-launcher-npm-package.md)

> **Update (2026-08-26):** The implementation decision in §1 - a pair of pure
> shell scripts with zero new dependencies - is superseded. The launcher is now
> a Node npm package (`forge-launcher`) with a `@clack/prompts` TUI, replacing
> the `.sh` / `.ps1` pair (which remain as delegating wrappers during the
> transition). The flow decisions in this ADR (harness selection order,
> `IDEA.md` hand-off, delegated bootstrap) still apply. See
> [ADR-023](023-forge-launcher-npm-package.md).

---

## Context

MyForge provides a powerful pipeline (forge-auto-build, forge-bootstrap-project, bootstrap scripts) but every step today assumes the user already has:

1. An existing repository with a configured Git remote.
2. MyForge templates already bootstrapped into that repository.
3. Knowledge of which harness to use and how to invoke the skills.

This activation cost is acceptable for experienced users, but it is a barrier for anyone coming to the forge for the first time, or for teams that want to provide a "one command" experience to colleagues who are unfamiliar with the internals.

Three gaps motivate a launcher component:

### Gap 1: No guided repo-creation step

The bootstrap scripts (`bootstrap.sh` / `bootstrap.ps1`) assume a target directory already exists and is already a Git repository. A new user must create the repo, clone/init it, and then run bootstrap manually -three separate operations with no guidance.

### Gap 2: No harness selection UX

`--harness` is a flag on the bootstrap scripts, but nothing prompts the user to choose a harness or explains the consequences of that choice (which directory the templates land in, which CLI to launch). Users who miss this flag end up bootstrapping into `.agents/` and then wondering why their GitHub Copilot agent doesn't see the skills.

### Gap 3: No bridge between bootstrap and auto-build

After `bootstrap.sh` completes, the user must open their agent harness, navigate to the new repo, and remember the correct incantation (`@workspace /forge-auto-build …`). There is no component that hands them a ready-to-paste command or -for CLI-native harnesses like opencode or Claude Code -spawns the session automatically.

---

## Decision

We introduce `forge-launcher`, a pair of interactive scripts (`scripts/forge-launcher.sh` and `scripts/forge-launcher.ps1`) that walk the user through the full MyForge lifecycle in a single terminal session.

### 1. Script-first, zero new dependencies (Tier 1)

The launcher is implemented as pure Bash (Linux/macOS) and pure PowerShell (Windows). It uses only tools already required by the forge ecosystem: `git`, optionally `gh` (GitHub CLI), and optionally the agent harness CLIs (`opencode`, `claude`). No Node.js runtime, no Python, no package installation step is required. This keeps the activation cost at its minimum and ensures the launcher works anywhere the bootstrap scripts already work.

A Tier 2 TUI/web frontend (e.g. built with `inquirer` or `questionary`) is left as a future progressive enhancement and is explicitly out of scope for this ADR.

### 2. Eight-step guided flow

The launcher orchestrates exactly the same operations a user would perform manually, in the same order:

| Step | What happens |
|------|--------------|
| 1 | Pre-flight -verify `git`, `gh`, `opencode`, `claude` availability |
| 2 | Harness selection -numbered menu mapping to `--harness` flag values |
| 3 | Repo creation -`gh repo create --clone` (GitHub) or `git init` + optional remote |
| 4 | Bootstrap -delegates to the existing `bootstrap.sh` / `bootstrap.ps1` |
| 5 | Idea capture -multi-line prompt, saved to `IDEA.md` |
| 6 | Commit + push -`git add . && git commit -m "chore: bootstrap MyForge"` |
| 7 | Auto-build launch -harness-specific instructions or optional CLI spawn |
| 8 | Completion summary -repo path, harness, next steps |

The launcher **never reimplements** bootstrap logic. It calls the bootstrap scripts verbatim (`--force`) so the two scripts remain the single source of truth for what gets copied and where.

### 3. Harness selection is first-class

The harness choice is the second step (before repo creation) because all subsequent decisions depend on it -the bootstrap flag, the directory layout, and the auto-build launch command. This ordering ensures the user cannot reach bootstrap without having made an explicit harness choice.

| Harness | Bootstrap flag | Repo creation | Auto-build launch |
|---------|---------------|----------------|-------------------|
| GitHub Copilot | `--harness github` | `gh repo create` | Manual -printed instructions |
| opencode | `--harness agents` | `git init` | Optional `opencode .` spawn |
| Claude Code | `--harness claude` | `git init` | Optional `claude .` spawn |
| Generic `.agents` | `--harness agents` (default) | `git init` | Printed instructions |

### 4. `IDEA.md` as the hand-off artifact

The launcher saves the user's project idea to `IDEA.md` in the repo root. This file is then referenced in the printed/spawned forge-auto-build invocation. Using a file rather than an inline argument serves two purposes:

- **Multi-line input.** The user can type a detailed, multi-paragraph idea in the terminal without worrying about shell quoting or line-continuation syntax.
- **Reproducibility.** The idea is committed alongside the bootstrapped forge templates. Anyone who checks out the repo later can read `IDEA.md` to understand the original intent, and can re-run forge-auto-build against it without needing to recall the original prompt.

`IDEA.md` is the natural input for `forge-auto-build`: the skill's Step 0 explicitly reads whatever idea or PRD path the user provides; a file reference is a perfectly valid input.

### 5. Non-interactive mode for CI and automation

Both scripts accept a `--non-interactive` / `-NonInteractive` flag. In this mode all prompts are skipped; values are read from environment variables (`FORGE_IDEA`, `FORGE_YN_DEFAULT`, and per-step variables). This lets the launcher be driven by CI pipelines or provisioning scripts without modification.

---

## Consequences

### Positive

- **One command from zero to auto-build.** A user who has never used MyForge can run `./scripts/forge-launcher.sh`, answer a handful of prompts, and arrive at a bootstrapped repository with `forge-auto-build` queued to run -without reading any documentation first.
- **Harness choice is surfaced and explained.** The numbered menu and the directory hint next to each option eliminate the most common onboarding mistake (bootstrapping into the wrong harness directory).
- **No regression for existing users.** The bootstrap scripts, forge skills, and agent templates are unchanged. Power users who prefer the manual flow are unaffected.
- **No new runtime dependencies.** The scripts run anywhere Bash 4+ or PowerShell 5.1+ is available, which is already the existing prerequisite for the bootstrap scripts.
- **IDEA.md creates a permanent record.** The committed `IDEA.md` file gives every forged project a traceable origin, useful for audits and for resuming an interrupted forge-auto-build run.

### Negative

- **Interactive terminal required for Tier 1.** The launcher is a terminal script; it does not provide a graphical UI or a web interface. Users who want a richer experience must wait for a Tier 2 implementation.
- **Thin harness coverage for auto-build launch.** The launcher can spawn `opencode .` or `claude .` for those CLI-native harnesses, but for GitHub Copilot it can only print instructions -there is no `gh copilot chat` sub-command that accepts a skill invocation today.
- **One more file pair to maintain.** If `bootstrap.sh` / `bootstrap.ps1` change their interface (flags, arguments), the launcher must be updated to match.

### Neutral

- **`IDEA.md` is not consumed by any existing skill directly.** `forge-auto-build` accepts either an inline idea or a PRD path. Passing the path `IDEA.md` is straightforward but the connection is by convention, not enforced by the skill itself.
- **Non-interactive mode is a convenience, not a primary use case.** CI-driven repo scaffolding is useful but not the primary motivation. The flag is included because it costs nothing and unlocks legitimate automation scenarios.

---

## References

- Scripts: [scripts/forge-launcher.sh](../../scripts/forge-launcher.sh)
- Scripts: [scripts/forge-launcher.ps1](../../scripts/forge-launcher.ps1)
- Docs: [docs/forge-launcher.md](../forge-launcher.md)
- Skill: [forge-auto-build](../../templates/skills/forge-auto-build/SKILL.md)
- Scripts: [scripts/bootstrap.sh](../../scripts/bootstrap.sh)
- ADR: [ADR-004 Bootstrap Meta-Skill](004-bootstrap-project-meta-skill.md)
- ADR: [ADR-006 Agents Directory Migration](006-agents-directory-migration.md)
- ADR: [ADR-009 Full Auto Build Meta-Skill](009-full-auto-build-meta-skill.md)
