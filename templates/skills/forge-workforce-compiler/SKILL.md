---
name: forge-workforce-compiler
description: >
  Compile Agent Forge execution artifacts into a FlowForge-compatible .workforce package,
  validate package shape against FlowForge-style schema constraints, and emit a kernel bridge
  file for workflow-engine handoff.
---

# Skill: Forge Workforce Compiler

Use this skill after `forge-execution-adapter` has produced `docs/EXECUTION-MANIFEST.json` and the Forge agent team exists. It compiles the current repo into a distributable `.workforce` package for FlowForge-style runtimes.

---

## Prerequisites

- `docs/EXECUTION-MANIFEST.json` exists
- Generated `.md` agent files exist under the active harness root
- Generated `SKILL.md` files exist under the active harness root

---

## Install & Run

```bash
cd .agents/skills/forge-workforce-compiler
npm install
```

### Inspect detected inputs

```bash
npm run forge-workforce-compiler -- inspect
```

### Compile workforce package

```bash
npm run forge-workforce-compiler -- compile
npm run forge-workforce-compiler -- compile --package-id dev.agent-forge.my-product --name "My Product Workforce"
```

### Validate an emitted package

```bash
npm run forge-workforce-compiler -- validate --package dist/dev-agent-forge-my-product.workforce
```

---

## Outputs

- `dist/<package-id>.workforce/`
- `dist/<package-id>.workforce/workforce.json`
- `dist/<package-id>.workforce/workflows/<workflow-id>.json`
- `docs/KERNEL-BRIDGE.json`

---

## Interop Contract (v1)

Compiled package includes:

- **Agents**: one FlowForge-style `agent.json` per generated Forge agent plus `system-prompt.md`
- **Skills**: copied `SKILL.md` files under `skills/`
- **Workflow**: one linear workflow generated from task ordering in `EXECUTION-MANIFEST.json`
- **Bridge metadata**: task-to-workflow-node map and source state/audit file pointers

Deferred in v1:

- persona synthesis
- rubric synthesis
- identity policy synthesis

---

## Validation Gate

Compilation runs a FlowForge-compatible validation pass automatically and fails fast on:

- missing/invalid `workforce.json` required fields
- missing referenced agent/skill/workflow files
- invalid agent ids or model tier declarations
- invalid workflow node structure

---

## Gotchas

- The compiler reads `docs/EXECUTION-MANIFEST.json`; re-run `forge-execution-adapter compile` if PRD/team changes.
- The generated workflow is sequential in v1 and mirrors manifest task order.
- Agent/skill IDs are normalized to lowercase-hyphenated names for schema compatibility.

---

## Validation Checklist

- [ ] `npm run forge-workforce-compiler -- compile` exits successfully
- [ ] `dist/*.workforce/workforce.json` exists
- [ ] `docs/KERNEL-BRIDGE.json` exists with `taskNodeMap`
- [ ] `npm run forge-workforce-compiler -- validate --package <path>` passes
