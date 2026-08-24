---
name: forge-execution-adapter
description: "Discover an Agent Forge repository, compile its PRD and generated agents into a structured execution manifest, and keep runtime checkpoints synchronized with docs/PROGRESS.md for external runners such as FlowForge-style engines."
---

# Skill: Build a Forge Execution Adapter

You are bridging an **Agent Forge-authored repository** to an **execution backend**. Your job is to discover the repo's generated artifacts, compile them into a structured execution contract, and keep that contract synchronized with runtime progress so an external runner can execute the build reliably.

This skill does **not** replace Agent Forge. It starts **after** the forge has already produced:

- `docs/PRD.md`
- `docs/PROGRESS.md` (optional on first run)
- `.agents/agents/*.md` (or the harness-specific equivalent — see `forge-build-agent-team/references/detect-harness.md`)
- `.agents/skills/*/SKILL.md` (or harness-specific equivalent)

## Embedded Tooling (Portable Install)

This skill package is self-contained. If this directory is installed as `.agents/skills/forge-execution-adapter/`, the helper scripts are available at:

- `./scripts/adapter.ts`
- `./scripts/discovery.ts`
- `./scripts/compiler.ts`
- `./scripts/progress.ts`
- `./scripts/types.ts`

When the user asks for a contract-driven execution bridge, run commands from this skill directory:

```bash
npm install
npm run forge-execution-adapter -- inspect
npm run forge-execution-adapter -- compile
npm run forge-execution-adapter -- status
```

The CLI auto-detects the repository root, so it can be run from inside the skill folder.

## Process

### Step 1: Discover the Forge Repo

Resolve the repository root and detect which harness directory is active:

- `.agents/` (canonical)
- `.github/`
- `.claude/`

Load:

- the PRD
- the current `docs/PROGRESS.md` state if it exists
- all generated agent files
- all installed skill files

If multiple harness roots are present, prefer `.agents/` and emit a warning rather than guessing silently.

### Step 2: Compile a Neutral Execution Manifest

Convert the forge outputs into a structured manifest containing:

- phases
- tasks
- owning agent
- sequential dependencies
- expected output files
- validation commands
- approval gates
- compile warnings for anything ambiguous
- **`inputs`** — artifact types consumed as context by the task (optional, used by forge-workflow-engine for context projection)
- **`produces`** — artifact type the task must create on completion (optional)

The manifest is a **contract**, not a prompt. Preserve uncertainty as warnings instead of inventing certainty.

### Step 3: Synchronize Runtime Progress

Keep runtime checkpoints aligned with `docs/PROGRESS.md`:

- mark completed tasks
- set the next current task
- preserve blockers and notes
- append an immutable audit event for each checkpoint mutation

The checkpoint flow should make "resume from last checkpoint" possible even when execution moves to another machine or backend.

### Step 4: Hand Off to the Runner

Once the manifest exists and progress is synchronized, hand the structured contract to the execution backend. For MVP mode, keep execution sequential and phase-ordered. Do not attempt speculative parallelism unless the backend explicitly guarantees dependency-safe execution.

---

## Artifact Directory Convention

When `forge-workflow-engine` runs a build against the compiled manifest, it stores task output artifacts in:

```
docs/artifacts/
  architecture/     ← decision artifacts (solution.architecture)
  implementation/   ← work artifacts (implementation.result)
  testing/          ← evidence artifacts (test.result)
  review/           ← work artifacts (code.review)
```

Each file is a compact JSON document — not the full agent output, but a structured summary with a `payload` field containing details for downstream agents that need them. Downstream agents receive only the projected summary, which is the source of token savings.

The adapter does not create this directory — it is created on demand by the workflow engine. However, if the adapter detects that `inputs`/`produces` fields are absent from manifest tasks, it should emit a warning encouraging the user to annotate the manifest for optimal context projection.

---

## Output Files

By default the embedded tooling writes:

- `docs/EXECUTION-MANIFEST.json` -compiled neutral execution contract
- `docs/EXECUTION-AUDIT.jsonl` -append-only audit trail for checkpoint mutations
- `docs/PROGRESS.md` -synchronized execution status in the existing forge format

---

## Gotchas

- **Do not re-author the PRD.** If the PRD is ambiguous, preserve that ambiguity as manifest warnings. The adapter compiles; it does not redesign.
- **Do not assume `.agents/` only.** Normalize `.github/` and `.claude/` roots the same way bootstrap does.
- **Do not invent ownership when the match is weak.** Leave `ownerAgent` empty and emit a warning rather than assigning the wrong specialist.
- **Do not hide unsupported modes.** This MVP targets monolithic `docs/PRD.md` full-build flows first. If feature or decomposition signals are present, flag them explicitly.
- **Keep checkpoints append-only in the audit log.** `docs/PROGRESS.md` is mutable state; the audit log is the immutable record.

---

## Validation

Before reporting success:

- [ ] Harness root was detected and reported
- [ ] At least one agent file and one skill file were discovered
- [ ] `docs/PRD.md` was parsed into at least one phase
- [ ] `docs/EXECUTION-MANIFEST.json` was written with warnings for ambiguities
- [ ] `docs/PROGRESS.md` stayed consistent with the manifest checkpoint state
- [ ] `docs/EXECUTION-AUDIT.jsonl` contains the latest checkpoint mutation
