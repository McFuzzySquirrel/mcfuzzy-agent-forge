# ADR-020: Launcher auto-draft flow and path input handling

**Date:** 2026-08-24
**Status:** Accepted

---

## Context

The forge launcher's Step 8 has historically been a **hand-off** step: it prints
the queued skill command or opens the harness CLI, and the user runs the
authoring/build stages themselves inside a chat session. Two frictions surfaced:

1. **Going from an idea to a reviewable PRD/team required a chat session.**
   Users who wanted "best answers, then review" had no in-launcher path: the
   existing `--headless` flag drives one queued skill end-to-end (idea → build in
   a single shot), which is all-or-nothing and leaves no review boundaries. There
   was no way to generate just the PRD or just the agent team non-interactively,
   review it, and then decide how to run the build.

2. **Typed path input was literal.** PRD, research/seed, and parent-directory
   prompts used plain `read -rp` / `Read-Host`, so there was no Tab completion
   and no shell-style expansion. A user pointing at an "external location" with
   `~/docs/prd.md` or `$HOME/docs/prd.md` got `file not found` because the typed
   text was compared against the filesystem verbatim.

---

## Decision

We add two capabilities to the launcher (Bash and PowerShell in parallel):

### 1. Optional auto-draft flow with review boundaries

At Step 8 (interactive runs), the launcher offers to run the authoring stages
non-interactively through the harness CLI, stopping for review between stages:

- **Idea → PRD.** When no PRD representation exists, ask whether to run
  `forge-auto-build-prd` headless (auto-proceed, every unknown recorded as an
  Open Question with a default assumption). Commit `docs: add auto-drafted PRD`,
  then point the user at `docs/PRD.md` (or the decomposed layout) for review.
- **PRD → team.** When a PRD exists, ask whether to run `forge-build-agent-team`
  headless. Commit `feat: generate auto-drafted agent team`, then point the user
  at the generated agents/skills for review. When a decomposed layout exists
  (`docs/product-vision.md` + `docs/features/*.md`), the skill is explicitly
  pointed at the decomposed representation so it runs in **Vision + Features
  mode** and builds the team from the features; otherwise it uses `docs/PRD.md`.
- **Engine decision.** After the team, offer to run the workflow engine now
  (detached via `forge-engine-run.sh --repo <repo> --harness <h> --yes`), print
  the engine command to run later, or skip and build manually.

The flow is exposed as interactive yes/no prompts (default no), pre-answered by
the `--draft` flag (`-Draft` on PowerShell), or forced headlessly with
`FORGE_AUTO_DRAFT=1`. Each stage commits its own artifacts so the repo stays
reviewable at every boundary. The existing `--headless` single-shot behavior and
`--non-interactive` CI behavior are unchanged when `FORGE_AUTO_DRAFT` is unset.

### 2. Path input: Tab completion, expansion, and distinct diagnostics

- **Tab completion.** Path prompts use bash readline (`read -e`) on Bash and
  PSReadLine (`PSConsoleReadLine::ReadLine`) on PowerShell, so users can
  autocomplete to existing files and directories. Both fall back to plain line
  input when stdin is not a TTY (pipes/CI) or PSReadLine is unavailable.
- **Expansion.** Typed paths expand leading `~`, `~/`, `~user`, and `$VAR` /
  `${VAR}` references (e.g. `$HOME/...`; PowerShell also expands `$env:VAR`).
  Expansion is regex/`${!var}`-based - no `eval` - and unknown variables expand
  to empty, matching shell behaviour.
- **Normalisation + diagnostics.** Resolved paths are normalised with
  `realpath -m` (collapses `..`, resolves relative-to-CWD) before validation,
  and the error message distinguishes *file not found* from *not a regular file*.

### Why this approach

- **Reuses the existing skills.** `forge-auto-build-prd` and
  `forge-build-agent-team` already define their own headless/auto-proceed
  behaviour; the launcher just sequences them and commits their artifacts. No
  skill logic is duplicated.
- **Preserves human gates.** The PRD review and team review are deliberate stops,
  consistent with the project's "automate mechanical gates, preserve human
  gates" principle (ADR-018). Only the *generation* is automated.
- **One runner for all headless paths.** The queued `--headless` run and both
  auto-draft stages share `run_skill_headless` / `Invoke-SkillHeadless`, so every
  mode prints the same `opencode run --auto` / `copilot -p --yolo` shape and
  honours `FORGE_RUN_WITH` and `--dry-run` consistently.
- **Safe, shell-familiar input.** Expansion without `eval` avoids injection; the
  behaviour matches what users already expect from a shell prompt.

---

## Consequences

### Positive

- Users can go idea → reviewed PRD → reviewed team → engine run entirely from the
  launcher, with no chat session required for generation.
- External PRD/seed locations work with `~`/`$VAR` shorthand and Tab completion,
  eliminating the "file not found" confusion for home-dir or env-var paths.
- The decomposed layout is reliably honoured by the team auto-draft (team built
  from the features), removing the ambiguity when both `docs/PRD.md` and
  `docs/product-vision.md` + `docs/features/*.md` exist.
- `--dry-run` makes the whole auto-draft path scriptable and testable without a
  harness CLI.

### Negative

- The auto-draft stages invoke the harness CLI directly, so they require
  `opencode` (or `copilot` via `FORGE_RUN_WITH=copilot`) to actually run, and the
  generation steps take as long as the underlying skills take.
- PSReadLine's `ReadLine` API varies across PSReadLine versions; the launcher
  guards with a `Read-Host` fallback, but very old PSReadLine installs get plain
  (non-completing) prompts.

### Neutral

- `--headless` and `--non-interactive` semantics are unchanged when
  `FORGE_AUTO_DRAFT` is unset; the auto-draft flow is purely additive.
- The launcher remains a thin orchestration layer; the substantive work still
  belongs to the underlying skills.

---

## References

- Scripts: [scripts/forge-launcher.sh](../../scripts/forge-launcher.sh)
- Scripts: [scripts/forge-launcher.ps1](../../scripts/forge-launcher.ps1)
- Scripts: [scripts/forge-engine-run.sh](../../scripts/forge-engine-run.sh)
- Docs: [docs/forge-launcher.md](../forge-launcher.md)
- Updates: [docs/updates.md](../updates.md)
