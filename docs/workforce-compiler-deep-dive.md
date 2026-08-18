# How the `forge-workforce-compiler` Works — A Deep-Dive Learning Guide

## What we're exploring

`forge-workforce-compiler` is the packaging boundary between Agent Forge artifacts and FlowForge-style kernel runtimes. It takes Forge outputs that already exist in your repo, compiles them into a `.workforce` package, validates that package shape, and writes bridge metadata so `forge-workflow-engine` can hand off execution through `--harness flowforge-kernel`.

---

## The Big Picture: Contract In, Package Out

At a high level, the compiler does four things:

1. Discovers Forge inputs (`docs/EXECUTION-MANIFEST.json`, generated agents, generated skills).
2. Builds a FlowForge-compatible package under `dist/*.workforce`.
3. Runs a validation gate and fails fast on schema/shape errors.
4. Writes `docs/KERNEL-BRIDGE.json` so runtime handoff has explicit task↔node mapping metadata.

Think of it as **authoring/runtime separation**:

- Agent Forge authoring produces plan + agents + skills.
- Workforce compiler produces runtime package + bridge.
- Workflow engine (kernel harness mode) executes against that package.

---

## Input Discovery and Repo Detection

The CLI supports `inspect`, `compile`, and `validate`.

- `inspect` reports discovered repo root, harness root, manifest path, and counts of agents/skills.
- `compile` performs packaging and then runs validation automatically.
- `validate` re-checks an already-emitted package.

Discovery is repository-aware: it resolves the Forge repo root, finds the active harness root, and reads generated artifacts from there. This keeps the compiler portable across `.agents`, `.github`, `.claude`, and `.opencode` layouts.

---

## Packaging Model

### 1) Agents

Each generated Forge agent becomes:

- `agents/<agent-id>/agent.json`
- `agents/<agent-id>/system-prompt.md`

Compiler behavior to know:

- Agent IDs are normalized to lowercase-hyphen format for schema compatibility.
- Model tier is inferred heuristically (`small` / `medium` / `large`) from model names.
- If manifest tasks lack explicit owners, workflow synthesis can use a fallback agent.

### 2) Skills

Each discovered skill is copied into the package as:

- `skills/<skill-id>/SKILL.md`

IDs are normalized the same way as agents.

### 3) Workflow

The compiler creates one workflow JSON (`workflows/<workflow-id>.json`) from the execution manifest.

v1 behavior is intentionally simple:

- Task order mirrors manifest order.
- Nodes are generated as `task-<normalized-task-id>`.
- Retry policy is attached per node.
- Flow is linear (`node -> next -> ... -> end`).

### 4) Package manifest

`workforce.json` ties agents, skills, and workflows together as the package entrypoint.

---

## The Bridge File: `docs/KERNEL-BRIDGE.json`

After compile, the compiler writes `docs/KERNEL-BRIDGE.json` in the repo root. This file is the handoff contract between compile-time outputs and runtime execution.

It includes:

- mode/source-of-truth metadata
- manifest, state, and audit paths
- compiled workforce path
- workflow id
- `taskNodeMap` entries linking Forge task IDs to workflow node IDs
- compile-time warnings

That map is the key traceability link when correlating runtime behavior back to original Forge tasks.

---

## Validation Gate (Fail Fast)

Validation runs automatically at the end of `compile`, and can be run standalone with `validate`.

Validation checks include:

- required `workforce.json` fields
- referenced file existence (agents/skills/workflows)
- agent shape/model-tier constraints
- workflow node structure constraints

If validation errors exist, compile exits non-zero and prints each error path + message.

---

## How Kernel Handoff Uses This Output

When `forge-workflow-engine` runs with `--harness flowforge-kernel`, the adapter resolves workforce path from either:

1. `FLOWFORGE_WORKFORCE_PATH`, or
2. `docs/KERNEL-BRIDGE.json` (`workforcePath` field)

By default it also runs a pre-dispatch package validation gate (`FLOWFORGE_VALIDATE_WORKFORCE=true`) through the compiler skill before first task dispatch.

So the runtime path is:

manifest + agents + skills -> compile -> validate -> kernel handoff -> workflow-engine state/audit updates.

---

## Common Failure Modes

- **No manifest found**: run `forge-execution-adapter -- compile` first.
- **No agents exported**: generate agent team before compiling.
- **Invalid package shape**: fix reported validation errors and re-run compile.
- **Kernel harness cannot resolve package path**: compile first (to create `KERNEL-BRIDGE.json`) or set `FLOWFORGE_WORKFORCE_PATH` explicitly.

---

## Key Files at a Glance

| File | Role |
|---|---|
| `templates/skills/forge-workforce-compiler/scripts/cli.ts` | CLI entry point (`inspect`, `compile`, `validate`) |
| `templates/skills/forge-workforce-compiler/scripts/discovery.ts` | Repo + artifact discovery |
| `templates/skills/forge-workforce-compiler/scripts/compiler.ts` | Package assembly and bridge generation |
| `templates/skills/forge-workforce-compiler/scripts/validator.ts` | FlowForge-compatible validation checks |
| `dist/<package-id>.workforce/workforce.json` | Package manifest |
| `dist/<package-id>.workforce/workflows/<workflow-id>.json` | Generated workflow definition |
| `docs/KERNEL-BRIDGE.json` | Task↔node mapping and runtime bridge metadata |

---

## A Mental Model to Remember

> `forge-workforce-compiler` is a **contract translator**: it turns Forge's planning/execution contract into a runtime package contract, then seals that boundary with validation and bridge metadata.

If you remember that one idea, the rest is straightforward: Forge authors the plan, compiler packages the plan, kernel executes the package.

---

## Related Reading

- [`templates/skills/forge-workforce-compiler/SKILL.md`](../templates/skills/forge-workforce-compiler/SKILL.md)
- [`docs/adr/016-forge-workforce-compiler-and-kernel-handoff.md`](adr/016-forge-workforce-compiler-and-kernel-handoff.md)
- [`docs/workflow-engine-deep-dive.md`](workflow-engine-deep-dive.md)
- [`templates/skills/forge-workflow-engine/SKILL.md`](../templates/skills/forge-workflow-engine/SKILL.md)
