# ADR-011: Forge Execution Adapter — Contract-Driven Bridge from Agent Forge to External Runners

**Date:** 2026-08-06
**Status:** Accepted

---

## Context

Agent Forge already solves the **authoring** side of the lifecycle well:

1. It creates `docs/PRD.md`
2. It generates specialist `.agent.md` files and `SKILL.md` packages
3. It coordinates implementation through `project-orchestrator` and `forge-orchestrate-build`
4. It persists mutable execution state in `docs/PROGRESS.md`

What it does not provide is a portable, structured contract for handing those artifacts to an **external execution engine**. Existing build execution is still largely prompt/harness-driven.

That creates four gaps for teams that want to execute Agent Forge builds on a backend such as FlowForge or another runtime-controlled runner:

1. **No discovery contract.** There is no single component that resolves the active harness root (`.agents/`, `.github/`, `.claude/`) and loads the forge artifacts consistently.
2. **No compilation contract.** The PRD phases and generated agents exist as markdown, but no structured execution manifest is produced for an engine to consume.
3. **No progress synchronization bridge.** `docs/PROGRESS.md` is the human-readable source of truth, but there is no helper layer for translating runner checkpoints back into that file.
4. **No immutable execution audit.** The mutable progress file is useful for resume, but it is not itself an append-only audit stream.

---

## Decision

We introduce a new **`forge-execution-adapter` skill package** with embedded TypeScript tooling that acts as a thin runtime bridge between Agent Forge outputs and an external runner.

### 1. Scope

The adapter starts **after** Agent Forge authoring is complete enough to execute:

- `docs/PRD.md` exists
- generated agent files exist under the active harness root
- generated skills exist under the active harness root
- `docs/PROGRESS.md` may or may not exist yet

The adapter is responsible for:

- discovering the active harness root and forge artifacts
- compiling a neutral execution manifest
- synchronizing task checkpoints back into `docs/PROGRESS.md`
- appending immutable audit events for manifest compilation and checkpoint mutations

The adapter is **not** responsible for:

- PRD authoring
- team generation
- skill generation
- bootstrap
- replacing `forge-auto-build`
- acting as the execution backend itself

### 2. Four-layer architecture

The embedded tooling is organized around four layers:

1. **Discovery layer** — detect repo root, harness root, agents, skills, PRD, progress path
2. **Compiler layer** — convert the PRD and generated team into `docs/EXECUTION-MANIFEST.json`
3. **Runner adapter layer** — provide a stable handoff surface for external runners through the neutral manifest
4. **Execution services** — synchronize checkpoints into `docs/PROGRESS.md` and append `docs/EXECUTION-AUDIT.jsonl`

### 3. MVP constraints

The first version is intentionally narrow:

- Supports the standard monolithic `docs/PRD.md` flow first
- Detects but does not fully compile feature/decomposition mode
- Compiles sequential phase/task dependencies by default
- Keeps approvals explicit at pre-flight and phase boundaries
- Treats ambiguity as warnings instead of inventing certainty

### 4. New generated artifacts

The adapter writes two new files in addition to the existing `docs/PROGRESS.md`:

- `docs/EXECUTION-MANIFEST.json` — structured contract for external runners
- `docs/EXECUTION-AUDIT.jsonl` — append-only audit events for manifest/checkpoint changes

These files are adapter-specific artifacts. They do not replace PRD or progress files; they bridge them to an execution backend.

---

## Consequences

### Positive

- **Runtime-ready bridge.** External runners now have a stable contract instead of scraping prompts or ad-hoc markdown.
- **Harness normalization.** `.agents/`, `.github/`, and `.claude/` can be consumed through one discovery path.
- **Checkpoint portability.** A runner can mutate structured state while still preserving the repository-native `docs/PROGRESS.md` contract.
- **Auditability.** Mutable progress and immutable audit are separated cleanly.

### Negative

- **Heuristic PRD parsing.** Freeform PRDs are not as rigid as schemas, so the compiler must surface warnings for ambiguity.
- **New Node.js dependency.** The embedded tooling follows the same portable TypeScript pattern as `skill-review`, which requires `npm install` before use.
- **Sequential bias in MVP.** Parallel execution is intentionally deferred until a backend can guarantee dependency-safe scheduling.

### Neutral

- **No bootstrap changes required.** The existing recursive copy of `templates/skills/*/` automatically includes the new skill package.
- **No existing skills are replaced.** `project-orchestrator` and `forge-orchestrate-build` remain the user-facing execution path; the adapter is an optional backend bridge.

---

## References

- Skill: [forge-execution-adapter](../../templates/skills/forge-execution-adapter/SKILL.md)
- Skill: [forge-orchestrate-build](../../templates/skills/forge-orchestrate-build/SKILL.md)
- Agent: [project-orchestrator](../../templates/agents/project-orchestrator.md)
- ADR: [ADR-006 Agents Directory Migration](006-agents-directory-migration.md)
- ADR: [ADR-009 Full Auto Build Meta-Skill](009-full-auto-build-meta-skill.md)
