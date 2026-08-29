# ADR-029: Output Verification Gate for the Workflow Engine

**Date:** 2026-08-28
**Status:** Accepted
**Relates to:** ADR-014 (workflow engine), ADR-017 (artifact store), ADR-022 (task granularity / timeout)

---

## Context

The workflow engine marked a task **complete** whenever the harness call exited
0. Every harness adapter (`opencode`, `copilot`, `openai`, `stub`,
`flowforge-kernel`) returned `success: true` on a zero exit code regardless of
whether the agent produced anything, and `executeTask` accepted that
unconditionally:

- A model could reply "Ready for the task." (an acknowledgment, not work), the
  process exited 0, and the engine synthesized an artifact with
  `filesChanged: []` and reported the task complete.
- This was surfaced by real usage: a run on `main` (GitHub Copilot harness, and
  reproduced on opencode) produced a working-tree full of near-empty artifacts,
  zero code, and a final status of `complete`.

Compounding factors:

- `expectedOutputs` are regex-extracted file paths (`extractPaths`). Meta and
  delegation tasks ("DELEGATED-AGENT-CONTROL-2.1") name no file paths, so they
  compile with `expectedOutputs: []` - the empty-output case is common.
- `buildPrompt` produced a thin prompt (`Task: <title>` + optional description)
  for such tasks, which invites an acknowledgment-only reply.
- Manifest `validationCommands` were only *shown* in the prompt, never executed.

A comparison against `~/Projects/repo-garden` (a project built successfully by
the engine with real code) confirmed the engine core, the Copilot adapter, and
the compiler are byte-identical to the current templates - repo-garden's tasks
were substantive (rich descriptions + file paths), so its agents did real work.
The defect is the engine's missing output verification, not a specific harness.

## Decision

Add an **output-verification gate** to the engine, applied after a successful
harness call and before the task is marked complete:

1. **Expected-output gate.** If a task declares `expectedOutputs`, every one must
   exist (relative to the repo root) after the call. Missing outputs are treated
   as a failed attempt - retried up to `--max-retries`, then the task is marked
   `failed` with the missing list as the error.
2. **No-op detection.** Tasks that declare no `expectedOutputs` must show
   evidence of work: file changes in the git working tree (a
   `git status --porcelain -z --untracked-files=all` snapshot diffed before/after
   the call, with engine-owned `docs/` files excluded), **or** a substantive
   agent response (non-trivial length / content line). A task with no changes and
   only trivial output is a failed attempt, not a completion.
3. **Escape hatch.** `--allow-noop` / `FORGE_ENGINE_ALLOW_NOOP=1` skips only the
   no-op heuristic; the expected-output check always applies.
4. **Validation commands (opt-in).** `--run-validation` /
   `FORGE_ENGINE_RUN_VALIDATION=1` executes each task's manifest
   `validationCommands` (cwd = repo root) and requires them all to exit 0 before
   completion. Tasks that declare validation are gated on it rather than the
   no-op heuristic. Opt-in because some commands are phase-level build/lint/test
   and may be slow or not per-task safe.
5. **Prompt hardening (mitigation).** Both the opencode and copilot `buildPrompt`
   append an explicit execution directive ("Perform the task now - do not merely
   acknowledge it - create or modify the required files, then list what you
   changed"). The opencode adapter also honors `FORGE_ENGINE_NATIVE_AGENT=0` to
   force the pre-v3.21 inline-persona prompt instead of `--agent <name>`.
6. **Hollow-run visibility.** The final run summary and `workflow-engine status`
   flag tasks completed with no recorded output files; `forge-launcher resume`
   reports them too.

Implementation lives in `scripts/verify.ts` (gate + git-diff snapshot + validation
runner), called from `executeTask`; the git baseline is captured after the task is
marked running and immediately before the harness call.

## Consequences

Positive:

- A run can no longer report `complete` with zero evidence. The reported failure
  mode (all artifacts, no code) is converted into retries then explicit `failed`
  tasks with a reason.
- The gate is deterministic for tasks with `expectedOutputs` and heuristic-but-
  conservative for the rest; `--allow-noop` preserves the old behavior explicitly.
- Validation commands finally become executable, not just prompt hints.
- The prompt directive reduces acknowledgment-only responses at the source.

Negative:

- Tasks whose legitimate output is not a file change (pure analysis / review) and
  whose response is short could be falsely failed; `--allow-noop` (or adding
  `expectedOutputs`/`validationCommands` to the manifest) recovers them. The
  substantive-response rule keeps most such tasks passing.
- The git-diff heuristic adds two `git status` calls per task and requires a git
  repo; without git it falls back to the output-substance check alone.
- Running `validationCommands` (opt-in) can be slow when a command is phase-level.

Trade-offs considered:

- **Require the harness adapters to gate** (each adapter checks its own outputs):
  rejected - policy should be centralized, and the engine owns retries/failure.
- **Always run `validationCommands`** instead of opt-in: rejected - some manifest
  commands are phase-level build/test and would slow or wrongly fail single tasks.
- **Revert the opencode `--agent` change (v3.21)** entirely: rejected - it is not
  the root cause (Copilot reproduces without it); the env fallback covers the
  opencode-specific prompt-delivery difference.

## References

- ADR-014: workflow engine / dark orchestration; ADR-017: artifact store.
- Implementation: `templates/skills/forge-workflow-engine/scripts/verify.ts`,
  `engine.ts`, `harness/opencode-adapter.ts`, `harness/copilot-adapter.ts`,
  `scripts/cli.ts`, and `scripts/forge-launcher/scripts/engine-run.ts`.
