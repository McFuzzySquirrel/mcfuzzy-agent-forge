# Retirement Safety

Load this file before applying deletions, before archiving, and before
self-deletion.

## Preflight gates

Stop when any of these is true:

- the directory is not a git worktree
- no harness root exists
- `docs/engine.pid` points at a live process
- `docs/WORKFLOW-STATE.json` reports `running` or `paused`
- the working tree has uncommitted changes and `--allow-dirty` was not passed

Warnings are not gates. A stale pid file, a missing optional artifact, or an
uncovered source area is a warning to surface to the user.

## Deletion rules

- Delete only paths returned by the inventory as `delete`.
- Never delete a path outside the repository.
- Never delete a project skill protected by the candidate handoff.
- Never delete source, tests, CI, manifests, or historical documentation.
- Never delete `forge-retire-project` during `apply`; self-deletion is a separate
  final step.
- The default is delete. `--archive` moves each path to
  `.forge-archive/<timestamp>/` and writes a retirement manifest beside it.
- `--keep <glob>` is applied before anything is removed.

## Archive mode

Use `--archive` when:

- the repository contains human-review evidence under `docs/reviews/`
- the user wants an audit trail of what the build produced
- the project is subject to a retention policy

Archived files are untracked. Do not add `.forge-archive/` to `.gitignore`
automatically; the user decides whether to commit, retain, or discard the
archive.

## Git hygiene

- Prefer a clean tree so `git diff` and `git restore` remain meaningful.
- Do not commit inside this skill. Report the suggested commit instead.
- If the caller passes `--commit`, commit once with a message such as
  `chore: retire forge scaffolding and publish support team`.
- Never rewrite history or force-push.

## Headless contract

When `FORGE_HEADLESS=1`:

- no prompts
- proceed only when the invocation contains `apply`
- make conservative choices for review items and report them
- stop on a blocking preflight failure
- run verification before self-deletion

## Self-deletion

The final step removes the installed skill directory so the repository is clean.
The script copies itself to a temporary directory and respawns there before
deleting the original, which avoids Windows file locks.

Refuse to self-delete when:

- verification has not passed in this run
- the directory name is not `forge-retire-project`
- the parent directory is not `skills`
- the directory is outside the repository

If self-deletion fails, leave the directory intact and print the exact command
for the user. A leftover skill is recoverable; a half-deleted one is not.
