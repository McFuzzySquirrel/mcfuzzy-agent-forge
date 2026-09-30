# ADR-056: Parallel Task Execution via Per-Task Worktree Sandboxes

**Date:** 2026-09-29
**Status:** Accepted
**Supersedes:** the serialization clause in [ADR-021](021-parallel-task-dispatch.md);
amends [ADR-040](040-native-adapter-contracts.md)

---

## Context

[ADR-021](021-parallel-task-dispatch.md) gave the workflow engine a wave
dispatcher, `mapLimit`, a per-owner guard, and `--concurrency`. It was then
disabled: every task ran one at a time, because output attribution had become
repository-wide.

The engine proves what a task did by snapshotting the worktree before and after
the harness call. Those snapshots back three things that must not lie:

1. the **no-op gate** - a task that changed nothing and said nothing substantive
   is a failed attempt, not a completion;
2. **`outputFiles` enrichment** - a file an agent edited in place, rather than
   created, is still the task's output;
3. **per-task auto-commit** - each commit should contain one task's work.

With two tasks editing one tree, none of those three survive. A snapshot taken
around task A also contains whatever B did in the same window, so the gate and
the attribution both absorb a sibling's edits, and `git add -A` would sweep a
sibling's in-flight files into A's commit.

A second defect sat underneath: `executeTask` returned a whole `WorkflowState`
derived from the snapshot it was handed, and wrote `saveState` itself. Two
concurrent tasks deriving from one snapshot lose each other's updates, and two
concurrent `git add` calls collide on `.git/index.lock`.

Two designs were considered.

**Option A - per-task isolation.** Each concurrent task runs in its own
`git worktree` on a detached HEAD. The files in a sandbox are exactly the files
that task changed, so the existing snapshot logic becomes exact rather than
approximate.

**Option B - declared write scope.** Use each task's `expectedOutputs` as its
attribution window, parallelize only pairwise-disjoint scopes, and restrict
staging to declared paths. Much smaller, but best-effort: it cannot see an
undeclared edit, and it does nothing about the deeper problem that a shared
working tree lets one agent observe a sibling's half-finished work and run
`validationCommands` against a tree that is mid-edit. Scope bookkeeping cannot
fix what the model sees.

### Decision drivers

- The project's stated position: correct attribution matters more than nominal
  parallelism.
- Acceptance criteria require `outputFiles` to be exact and per-task commits to
  be clean. Option B cannot guarantee either under a declaration contract.
- `--concurrency 1` must be unchanged for every existing user.

---

## Decision

Restore configured concurrency as real throughput using **per-task `git worktree`
sandboxes**, and make the engine a single writer.

### 1. A sandbox per concurrent task

`git worktree add --detach <repoRoot>/.forge-sandboxes/<taskId> HEAD`. The task's
harness, output verification, and `validationCommands` all run with that
directory as their root (`TaskAttemptRequest.repoRoot` is the *workspace* root,
not necessarily the engine root). `expectedOutputs`, the no-op gate, and
`outputFiles` therefore resolve against the tree the agent actually edited.

Two supporting rules make a worktree usable:

- **Gitignored top-level entries are symlinked in** (`node_modules/`, `.env`,
  `dist/`, …). A worktree only has tracked files, so without this every
  `validationCommands` that needs installed dependencies would fail. The
  snapshot baseline is taken *after* seeding, and seeded paths are additionally
  filtered out of the change set, so nothing the engine provided can be
  attributed to the task.
- **The working tree's `docs/` delta is copied in** (the compiled manifest, engine
  config, responsibility matrix, authoring state, progress and audit logs,
  human-review evidence, generated artifacts) so the task reads what the operator
  reads, not what was last committed. Only changed paths are copied, so a file
  that already matches `HEAD` is left alone.

### 2. The working tree must be clean where a task would read the difference

A worktree is built from a commit, so it cannot see uncommitted work. The engine
refuses parallel execution and names the exact paths — but the rule is about
**consequence, not tidiness**:

- **Human-authored requirements block the run**: `docs/PRD.md`, `docs/IDEA.md`,
  `docs/features/**`. A dirty copy of one of these is
  exactly what a task is told to read, so silently handing the agent the
  committed copy would be a correctness failure.
- **Everything else under `docs/` is tolerated**, because it is generated state
  the engine has already resolved into the task's prompt, and it is copied into
  the sandbox so the task sees the current version.
- **Anything outside `docs/` blocks the run**: that is the operator's own code and
  configuration, which a sandbox at `HEAD` cannot represent.

This is deliberately a short list of *requirements* rather than a list of managed
files. The forge tooling rewrites a dozen generated `docs/` paths —
`engine-config.json`, `authoring-config.json`, `authoring-state.json`,
`EXECUTION-MANIFEST.json`, `agent-responsibility-matrix.md`,
`AUTHORING-EVENTS.jsonl`, the `SKILL-*` authoring artifacts — and a managed-file
list drifts out of date as soon as authoring gains another. It also matters
operationally: the Console persists a concurrency choice by rewriting
`docs/engine-config.json` in place, so treating a tracked-and-modified `docs/`
file as blocking would make it impossible to enable concurrency, since you would
have to commit the very setting that turns it on before the run would start.

A repository with no commit is refused for the same reason as a dirty tree.

Consequence worth stating plainly: `--concurrency > 1` and `--no-auto-commit`
are not combinable, because an uncommitted tree is exactly what a sandbox
cannot represent.

### 3. Integration by copy-back, not cherry-pick

When a task completes, its changed files are copied into the engine root and the
**existing** `commitTaskWork` runs unchanged. This is deliberately not the
cherry-pick this issue originally proposed:

- attribution is already exact from the sandbox snapshot; a commit inside the
  sandbox adds nothing;
- the engine root is *dirty* during a run (`WORKFLOW-STATE.json`, `PROGRESS.md`),
  so `git cherry-pick` would refuse or conflict on `docs/` paths for no benefit;
- there is no conflict-resolution path to design, and no divergence from the
  one-commit-per-task shape in [ADR-035](035-auto-commit-after-task.md) and the
  exclusions in [ADR-046](046-task-execution-files.md).

Integration is serialized on the engine's single writer queue, so at the moment
`git add -A` runs the engine root holds exactly one task's files plus the
engine's own `docs/` state.

### 4. Overlap is detected, not assumed

The DAG and `ownerUniqueReady` make a shared path unlikely but not impossible,
and a silent lost edit is the worst possible outcome. Each task's change set is
checked against the paths already integrated **in that wave**; a collision fails
that task with `Concurrent write overlap on <paths>` and copies nothing, so the
task can be replayed. A silent race becomes a visible, recoverable failure.

### 5. The engine is a single writer

`executeTask` no longer takes or returns a `WorkflowState` and never calls
`saveState`. It owns one `TaskRecord`, calls an injected `checkpoint(record)`,
and returns a `TaskOutcome`. The engine merges that one record into the
authoritative state, persists, integrates, and commits - all on a promise-chain
queue, so persistence, sandbox integration, and git never interleave.

This is the fix for CR-01 in
[`docs/codebase-review-2026-09-05.md`](../codebase-review-2026-09-05.md). It also
preserves mid-attempt durability: the attempt history is still on disk before the
next attempt starts, so a crash cannot lose it.

### 6. Activation and preconditions

`resolveConcurrency()` is the single source of truth, used by the CLI (pre-run
summary, keep-alive decision) and the engine (dispatch):

```
effectiveConcurrency = harness.supportsConcurrency ? max(1, floor(maxConcurrency)) : 1
sandboxMode          = effectiveConcurrency > 1
```

- **Default `--concurrency 1` keeps today's exact code path.** Sandbox mode
  engages only above 1, which contains the regression risk to opt-in runs.
- A harness without `supportsConcurrency` falls back to 1 with a warning rather
  than failing a persisted config.
- **Per-task project selection in sandbox mode.** Each task runs with `cwd` set to
  its own worktree, which is how OpenCode v2 selects the project (ADR-058). The
  keep-alive interaction originally recorded here — one warm `opencode serve`
  serves a single project directory, so keep-alive was downgraded to a cold start
  per task — is moot: v2 retired the engine-managed warm server along with
  `--attach`. See [ADR-058](058-opencode-v2-project-resolution.md).
- Review records are operator input for the engine, not something a task builds
  from, so `docs/reviews/**` is tolerated rather than treated as a requirement.
  A human-review task reads its attestation from the engine root, and the
  Console's approve-and-resume action writes that attestation before starting the
  run; blocking on it made the form refuse the run it had just approved. An
  approval recorded outside `docs/` is named as a review record in the refusal
  so "commit your work" is not the wrong instruction for it.
- Human-review tasks are never sandboxed, and an unapproved one does not stop the
  run: it is held pending while other tasks continue, and the run pauses only once
  nothing else is dispatchable. See
  [ADR-057](057-human-review-waits-rather-than-pauses-the-run.md). They do not
  invoke a harness and read
  operator evidence from the engine root.

### 7. Lifecycle

Sandboxes are hidden from git with `.git/info/exclude`, which is repository-local
and never committed, so a run never touches the operator's tracked `.gitignore`.
Stale sandboxes from a killed engine are swept and `git worktree prune`d before
the first wave; each task's worktree is removed in a `finally`; and the sandbox
root is deleted once the dispatcher drains, so a finished run leaves nothing
behind.

---

## Consequences

### Positive

- `--concurrency N` is real throughput: disjoint-owner tasks genuinely overlap
  and wall-clock approaches the critical path.
- `outputFiles` is exact, the no-op gate is uncontaminated, and
  `validationCommands` run against the task's own tree.
- Per-task commits stay clean without a staging rewrite.
- State cannot lose updates: one writer, merged per task, durable per attempt.
- A concurrent write to the same file fails loudly instead of vanishing.
- `--concurrency 1` is byte-for-byte the previous behaviour.

### Negative

- **Disk and setup.** N concurrent worktrees, each a full checkout of HEAD.
  Opt-in, but real for a large repository.
- **The clean-tree requirement is strict for code and requirements.** An operator
  with uncommitted work must commit or stash before running in parallel, and
  cannot combine parallel execution with `--no-auto-commit`. Generated `docs/`
  state is exempt and seeded, so routine tooling churn does not block a run.
- **Cold start per task in parallel mode.** The warm-server optimisation is
  unavailable exactly when a run is longest.
- **A sandbox sees HEAD for everything except `docs/`.** Uncommitted source and
  requirement edits are invisible to the task; the preflight turns that from a
  silent divergence into a refusal.
- **A failing task's sandbox work is discarded.** It is not integrated, so a
  failed task must be replayed to recover its partial work. This matches the
  pre-existing behaviour of a failed task, which never auto-committed.
- Adapters are unchanged, but an adapter that hardcodes the engine root would
  misbehave; all shipped adapters use `request.repoRoot`.

### Neutral

- The pre-existing same-owner guard still applies, and a wave still re-checks
  readiness after it drains.
- `PROGRESS.md` now lists every in-flight task rather than the first match.
- Bootstrap and packaging are unaffected: the launcher stages
  `templates/` at `prepack`, and `.forge-sandboxes/` is git-ignored at the
  repository level.

---

## References

- Implementation plan: [`docs/parallel-execution-plan.md`](../parallel-execution-plan.md)
- [Workflow engine](../workflow-engine.md)
- [Workflow engine deep dive](../workflow-engine-deep-dive.md)
- [ADR-021: Parallel task dispatch](021-parallel-task-dispatch.md)
- [ADR-035: Auto-commit after task](035-auto-commit-after-task.md)
- [ADR-040: Native adapter contracts](040-native-adapter-contracts.md)
- [ADR-046: Task execution files](046-task-execution-files.md)
