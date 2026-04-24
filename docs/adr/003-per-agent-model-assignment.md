# ADR-003: Per-Agent Model Assignment via `forge-assign-models`

**Date:** 2026-04-24
**Status:** Accepted

---

## Context

The McFuzzy Agent Forge framework generates agent teams where every agent defaults to
whatever model the user has set globally (the VS Code model picker selection or the
`COPILOT_MODEL` environment variable for Copilot CLI BYOK). This is convenient but
suboptimal:

1. **Over-provisioning** — Lightweight agents (docs writers, lint fixers, release-notes
   authors) run on the strongest and most expensive model by default, even though they
   need only a fast, light-weight model.

2. **Under-provisioning risk** — Heavyweight agents (orchestrators, security engineers,
   architects) share a pool with lightweight agents and may be swapped to a cheaper
   model if the user adjusts their global setting.

3. **Local model blindness** — Users who have Ollama installed with capable local models
   (e.g. `qwen3.5:9b`, `mistral-nemo`) have no structured way to direct lower-stakes
   agents to those models, reducing cost and keeping sensitive code local.

4. **No capability gating** — Not all models support tool calling. An agent that relies
   on file/edit/build tools will silently fail or degrade if assigned a model without
   tool-calling support.

5. **No auditability** — There is no artifact recording which model was chosen for which
   agent, or why, making the assignment opaque and hard to reproduce across team members
   or CI environments.

---

## Decision

We introduce a new **`forge-assign-models` skill** that discovers available models,
classifies each agent's workload, and recommends (and optionally applies) a per-agent
model assignment. Two associated clarifications are also recorded here:

### 1. New `forge-assign-models` Skill

The skill operates in four modes:

| Mode | What it does | Writes files? |
|------|--------------|---------------|
| **Discover** | Enumerate available models from all sources and cache the inventory. | Only `docs/research/model-inventory.json`. |
| **Recommend** | Produce `docs/MODEL-PLAN.md` with a proposed model per agent + rationale. | Only `docs/MODEL-PLAN.md`. |
| **Apply** | Write `model:` and `modelFallback:` into each agent's YAML frontmatter and refresh `docs/MODEL-PLAN.md`. Optionally emit per-agent CLI launch wrappers. | Agent files + `docs/MODEL-PLAN.md` + optional wrappers. |
| **Re-tune** | Re-evaluate only agents whose role changed after a `forge-team-builder` Feature Increment. | Only changed agent files + `docs/MODEL-PLAN.md`. |

Default mode (when not specified) is **Recommend**, so no agent files are modified
without the user's explicit approval.

### 2. Three-Source Model Inventory

The skill builds an inventory from sources tried in priority order:

- **Local Ollama** (`http://localhost:11434` or `OLLAMA_HOST`) — cheapest, most private,
  highest priority. Models are filtered by declared tool-calling support; excluded models
  are recorded with a reason.
- **BYOK provider** (`COPILOT_PROVIDER_BASE_URL`) — OpenAI-compatible endpoints.
- **Copilot subscription** — Not enumerable from inside a skill; the user confirms which
  models their plan exposes, using a maintained catalog grouped by tier as a hint.

The inventory is cached as `docs/research/model-inventory.json` and reused for 7 days
unless the user requests a refresh.

### 3. Six-Axis Workload Scoring and Three-Tier Classification

Each agent is scored 1–3 on six axes:

| Axis | High (3) | Low (1) |
|------|----------|---------|
| Reasoning depth | Architecture, security review, debugging | Doc writing, lint fixes |
| Code-gen volume | Many files, full subsystems | Small edits, prose |
| Context window need | Many files, full PRD | One or two files |
| Tool-calling reliance | Heavy file/edit/build/test workflows | Mostly text output |
| Latency sensitivity | Interactive pairing, fast feedback | Long-running phase work |
| Determinism / safety | Security, auth, migrations, payments | Cosmetic changes, drafts |

Scores map to three tiers:
- **Tier S (Strong)** — Reasoning depth = 3, or safety = 3, or (context = 3 and reasoning ≥ 2).
- **Tier M (Balanced)** — Typical domain/feature engineers.
- **Tier L (Light)** — Reasoning ≤ 2, code-gen ≤ 2, context = 1.

Tier S agents are assigned the strongest available reasoning model; Tier M get a balanced
model; Tier L get a fast/light model. All assignments are recorded with per-axis scores
in `docs/MODEL-PLAN.md` for auditability.

### 4. Capability Gating

The skill enforces two hard gates before emitting a model recommendation:

- **Tool-calling gate** — If an agent's tool-calling axis is 2 or higher, both primary
  and fallback models must support tool calling. `copilot_subscription` inventory entries
  are treated as tool-calling-capable by default (every model in the maintained catalog
  supports it); this gate actively filters only local Ollama models, where support varies.
  A cloud entry can be opted out by setting `tool_calling: false` on its inventory record.
- **No fabricated models** — The skill never recommends a model not present in
  `docs/research/model-inventory.json`.

### 5. Optional Frontmatter Fields

The `model:` and `modelFallback:` keys written by Apply mode are **optional** in the
agent frontmatter schema. Agent files that lack them continue to work exactly as before —
Copilot uses the user's current default model. This preserves full backward compatibility.

### 6. Honest Enforcement Boundary

The plan document always includes a note that the `model:` frontmatter field is honored
by VS Code custom agents but is advisory in Copilot CLI BYOK today (the active model is
process-wide via `COPILOT_MODEL`). Apply mode can optionally emit per-agent shell and
PowerShell launch wrappers for CLI users.

---

## Consequences

### Positive

- **Cost efficiency** — Lightweight agents are directed to cheaper or local models;
  expensive reasoning models are reserved for agents that genuinely need them.
- **Privacy** — Users with local Ollama models can direct lower-stakes agents to
  `localhost`, keeping code off cloud services.
- **Capability safety** — The tool-calling gate prevents assigning a model that would
  silently break an agent's tool-dependent workflow.
- **Auditability** — `docs/MODEL-PLAN.md` records the inventory snapshot, per-axis
  scores, tier rationale, and assignment for every agent. The plan is committed to git
  and reproducible.
- **Opt-in, non-breaking** — Default mode is Recommend; Apply requires explicit
  confirmation. The `model:` field is optional; existing teams are unaffected until they
  run Apply.
- **Local-first option** — A "local" / "offline" flag or `COPILOT_OFFLINE=true` causes
  all tiers to prefer Ollama models, even for Tier S agents.
- **Re-tune integration** — Re-tune mode mirrors `forge-team-builder`'s minimal-change
  philosophy, re-evaluating only agents that changed.

### Negative

- **Manual inventory for cloud models** — Copilot's model surface is not enumerable from
  inside a skill; the user must confirm their available models once. The inventory is
  cached and reused, minimizing repeat effort.
- **Inventory staleness** — The 7-day cache window means model availability changes
  (e.g. a new model appearing in the picker) are not reflected automatically. Users must
  run Discover mode to refresh.
- **CLI advisory only** — The `model:` frontmatter field has no enforcement mechanism in
  Copilot CLI BYOK today. CLI users must use the launch wrappers or set `COPILOT_MODEL`
  manually. This limitation is surfaced in the plan document.

### Neutral

- **Backward compatible** — All changes are additive. Agent files without `model:` keep
  working. The forge meta-agents (`project-orchestrator`, `forge-team-builder`) are not
  modified by the skill unless the user explicitly requests it.
- **No bootstrap script changes** — The skill is auto-discovered via the existing glob
  pattern; no script updates are needed.
- **Re-verify at runtime** — The skill's constraints explicitly require re-checking
  official Copilot documentation at runtime because model availability and frontmatter
  behavior change frequently.

---

## References

- Skill: [forge-assign-models](../../templates/skills/forge-assign-models/SKILL.md)
- Docs: [Running with Local Models](../running-with-local-models.md)
- Skill: [forge-build-agent-team](../../templates/skills/forge-build-agent-team/SKILL.md)
- Agent: [project-orchestrator](../../templates/agents/project-orchestrator.md)
- ADR: [ADR-001 Agent/Skill Separation](001-agent-skill-separation-and-progress-reporting.md)
- ADR: [ADR-002 PRD Decomposition into Features](002-prd-decomposition-into-features.md)
