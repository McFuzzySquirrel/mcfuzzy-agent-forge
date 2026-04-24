---
name: forge-assign-models
description: >
  Discover which LLM models are available to the user (cloud subscription + local Ollama),
  classify each generated agent's workload, and recommend (and optionally apply) a
  per-agent model assignment so that lightweight agents do not default to the most
  expensive model. Use this skill after `forge-build-agent-team` has produced an
  agent team, or any time the team changes.
---

# Skill: Assign Models to a Generated Agent Team

You are assigning a per-agent LLM model to each agent in `.github/agents/`. The goal is to
match each agent's actual workload (reasoning depth, context size, tool-use, latency
sensitivity, safety) to a model from the **inventory the user actually has access to** —
including local Ollama models — instead of defaulting every agent to the strongest (and
most expensive) cloud model.

This skill is **opt-in and post-hoc**. It runs after the team has been generated. Existing
teams that have never run this skill keep working exactly as before; the `model:` field is
optional and absence means "use the user's current default model".

---

## Modes

This skill has four modes. Always tell the user which mode you are running and confirm
before changing files on disk.

| Mode | What it does | Writes files? |
|------|--------------|---------------|
| **Discover** | Enumerate available models and cache the inventory. | Only `docs/research/model-inventory.json` (cache). |
| **Recommend** | Produce `docs/MODEL-PLAN.md` with a proposed model per agent + rationale. | Only `docs/MODEL-PLAN.md`. |
| **Apply** | Write `model:` (and optional `modelFallback:`) into each agent's YAML frontmatter and refresh `docs/MODEL-PLAN.md`. Optionally emit per-agent launch wrappers for Copilot CLI users. | Agent files + `docs/MODEL-PLAN.md` + optional wrappers. |
| **Re-tune** | Re-run after team changes (e.g. after `forge-team-builder` Feature Increment Mode); only re-evaluate agents whose role changed. | Only changed agent files + `docs/MODEL-PLAN.md`. |

If the user does not specify a mode, default to **Recommend** so nothing is written into
the agent files without their approval.

---

## Process

### Step 0: Detect Mode and Preconditions

1. Confirm `.github/agents/` exists and contains agent files beyond the forge templates
   (`project-orchestrator`, `forge-team-builder`). If not, stop and instruct the user to
   run `forge-build-agent-team` first.
2. Determine which mode to operate in based on the user's prompt:
   - "discover" / "what models do I have" → **Discover**
   - "recommend" / "suggest" / no mode specified → **Recommend**
   - "apply" / "set" / "write" → **Apply** (requires explicit confirmation)
   - "re-tune" / "refresh" / "update after feature" → **Re-tune**
3. Check whether `docs/research/model-inventory.json` exists. If it exists and is less
   than 7 days old, reuse it unless the user asks to refresh.
4. Check whether `docs/MODEL-PLAN.md` already exists. If it does, treat it as the prior
   plan and prefer minimal changes.

---

### Step 1: Discover the Available Model Inventory

Build a single inventory of models the user can actually invoke. Try these sources in
order; record only what succeeds. Never invent models the user does not have.

#### 1a. Local Ollama (highest priority — always cheap, always private)

If `OLLAMA_HOST` is set, use it; otherwise default to `http://localhost:11434`.

1. List installed models: `GET /api/tags`. For each model, capture `name`, `size`, and
   `modified_at`.
2. For each model, capture capability metadata via `ollama show <name>` (or
   `POST /api/show`): `parameter_size`, `context_length`, `quantization_level`, and
   whether the model declares **tool / function calling** support.
3. **Filter out models that do not support tool calling.** Forge agents rely on Copilot's
   tool surface; a model without tool calling will silently break those agents. Mark
   filtered-out models as `excluded: "no tool calling"` in the inventory so the user can
   see why.
4. Cross-reference `docs/research/model-evals/summary.md` and `results.csv` (produced by
   `scripts/evaluate-ollama-models.sh`) if they exist, and attach `eval_score` and
   `eval_notes` to each local model. Do not re-benchmark from this skill.

If Ollama is unreachable, record `{ "ollama": { "available": false, "reason": "..." } }`
in the inventory and continue — local discovery is optional.

#### 1b. Copilot CLI BYOK provider

If `COPILOT_PROVIDER_BASE_URL` is set in the user's environment:

1. Attempt `GET {base_url}/v1/models` (the OpenAI-compatible endpoint shape).
2. If it returns a model list, capture `id` and any declared `context_length`.
3. If it returns 401/403/404, record the reason in the inventory and skip — do not prompt
   the user for credentials.

#### 1c. VS Code / Copilot subscription

The set of models Copilot exposes in VS Code depends on the user's plan (Free / Pro /
Business / Enterprise) and any admin allowlist, and is **not enumerable from inside a
skill**. Handle this explicitly:

1. Look for an existing `docs/research/model-inventory.json`. If it has a
   `copilot_subscription` array, reuse it (and show its `last_verified` date so the user
   knows whether to refresh).
2. Otherwise, present the user with a small **maintained catalog** of models Copilot has
   commonly exposed across plans, grouped by family. Ask them to confirm which ones their
   plan currently shows in the model picker:

   - **Reasoning / strongest tier** — e.g. `gpt-5` family, `claude-opus-4.x`,
     `gemini-2.5-pro`, `o`-series reasoning models
   - **Balanced tier** — e.g. `gpt-5-codex`, `claude-sonnet-4.x`, `gpt-4.1`
   - **Fast / light tier** — e.g. `claude-haiku-4.x`, `gpt-5-mini`, `gpt-4.1-mini`

   Treat this list as a hint, not a source of truth. Do not assume model availability;
   always have the user confirm. Note that names and tiers change frequently — encourage
   the user to verify against the current model picker.

3. Save whatever the user confirms to `docs/research/model-inventory.json`.

#### 1d. Persist the inventory

Write `docs/research/model-inventory.json` with this shape (illustrative — adapt to what
was actually discovered, omit empty sections):

```json
{
  "schema_version": 1,
  "last_verified": "YYYY-MM-DDTHH:MM:SSZ",
  "ollama": {
    "available": true,
    "endpoint": "http://localhost:11434",
    "models": [
      {
        "name": "qwen3.5:4b",
        "parameter_size": "4B",
        "context_length": 262144,
        "quantization": "Q4_K_M",
        "size_bytes": 3400000000,
        "tool_calling": true,
        "eval_score": 0.82,
        "eval_notes": "Reliable on simple tool use; weaker on long reasoning chains."
      }
    ]
  },
  "byok_provider": {
    "endpoint": "http://localhost:11434",
    "models": []
  },
  "copilot_subscription": {
    "plan": "user-confirmed",
    "models": [
      { "id": "claude-sonnet-4.x", "tier_hint": "balanced" },
      { "id": "claude-haiku-4.x", "tier_hint": "fast" },
      { "id": "gpt-5", "tier_hint": "reasoning" }
    ]
  }
}
```

If running in **Discover** mode, stop here and present a human-readable summary of the
inventory.

---

### Step 2: Read and Classify Each Agent's Workload

For each file in `.github/agents/*.md` (excluding the forge meta-templates
`forge-team-builder.md` unless the user asks to include them):

1. Parse the YAML frontmatter (`name`, `description`, optional existing `model`,
   `modelFallback`).
2. Read the body and any `## Skills` / `## Collaboration` sections to find skills the
   agent invokes. Open those skill files at `.github/skills/{skill}/SKILL.md` and skim
   them — they often reveal the real workload (e.g. a "create-data-model" skill implies
   substantial code generation).

Score the agent on this rubric. Each axis is **1 (low) / 2 (medium) / 3 (high)**:

| Axis | High (3) signals | Low (1) signals |
|------|------------------|-----------------|
| **Reasoning depth** | Architecture, refactor, security review, debugging, conflict resolution, multi-file design | Doc writing, formatting, lint fixes, commit messages, single-file edits |
| **Code-gen volume** | Generates many files, scaffolds entire subsystems, large templates | Small targeted edits, mostly prose |
| **Context window need** | Reads many files (orchestrators, reviewers, integrators), references full PRD + multiple feature docs | Operates on one or two files at a time |
| **Tool-calling reliance** | Heavy file/edit/build/test tool use, multi-step workflows | Mostly chat/text output |
| **Latency sensitivity** | Interactive pairing, fast feedback loops, watch-mode helpers | Long-running phase work where latency does not matter |
| **Determinism / safety** | Security, auth, migrations, payments, anything with rollback risk | Cosmetic changes, drafts, brainstorming |

Map the scored axes to a tier:

- **Tier S (Strong)** — Reasoning depth = 3 OR determinism/safety = 3 OR (context = 3 AND
  reasoning ≥ 2). Examples: `project-orchestrator`, `project-architect`,
  `security-engineer`, `qa-tester` when running integration design.
- **Tier M (Balanced)** — Most domain/feature engineers (typical scores: reasoning 2,
  code-gen 2–3, context 2, tool-use 3).
- **Tier L (Light)** — Reasoning ≤ 2, code-gen ≤ 2, context = 1. Examples:
  `docs-writer`, `release-notes-author`, `lint-fixer`.

Always record the per-axis scores in the plan so the recommendation is auditable.

---

### Step 3: Map Tiers to Concrete Models

For each agent, pick a **primary** and a **fallback** model from the inventory. Never
emit a model name that is not in `docs/research/model-inventory.json`.

Mapping rules:

1. **Honor tool-calling capability.** If the agent's tool-calling axis is 3, primary and
   fallback must both support tool calling. Discard inventory entries that don't.
   Entries under `copilot_subscription` are treated as tool-calling-capable by default
   (every model in the maintained catalog supports it); the explicit capability gate in
   Step 1a only filters local Ollama models, where tool-calling support varies. If a
   user-confirmed cloud entry is known not to support tool calling, mark it
   `tool_calling: false` in the inventory and it will be filtered here too.
2. **Honor context window need.** If the agent's context axis is 3, prefer models with
   the largest declared `context_length` in the inventory.
3. **Local-first override.** If the user passed "local" / "BYOK" / "offline" in their
   prompt, OR if `COPILOT_OFFLINE=true` is in the environment, OR if the inventory has
   no `copilot_subscription` entries, prefer Ollama models even for Tier S — fall back to
   the strongest local model that still meets capability gates.
4. **Tier mapping (default, when both cloud and local are available):**
   - Tier S → strongest reasoning model from `copilot_subscription`; fallback = strongest
     local Ollama model that supports tool calling.
   - Tier M → balanced cloud model; fallback = balanced local model (e.g. `qwen3.5:9b` or
     similar from inventory).
   - Tier L → fast/light cloud model (Haiku-class, mini-class); fallback = smallest local
     model that still passes tool-calling capability gate.
5. **Stable selection.** If multiple models tie, prefer the one that already appears in
   the prior `docs/MODEL-PLAN.md` (if any) so re-runs are deterministic.
6. **Always emit a fallback.** If no second model exists in the inventory, set
   `modelFallback: <same as primary>` and note it in the rationale.

---

### Step 4: Produce `docs/MODEL-PLAN.md`

Write `docs/MODEL-PLAN.md` with this structure. This file is the source of truth and
should be reviewable in git.

````markdown
# Model Assignment Plan

**Generated by:** `forge-assign-models` skill
**Mode:** {Discover | Recommend | Apply | Re-tune}
**Inventory snapshot:** `docs/research/model-inventory.json` (last verified: YYYY-MM-DD)
**Status:** {Proposed — not yet applied | Applied to agent files on YYYY-MM-DD}

> Per-agent model assignment is **honored by VS Code custom agents** that read the
> `model:` frontmatter field. Copilot CLI BYOK currently uses a single global model
> (`COPILOT_MODEL`); on the CLI the assignments below are advisory. See the
> "Launching with the assigned model" section below for CLI wrappers.

## Inventory Used

### Local (Ollama)
| Model | Params | Context | Tool calls | Eval score |
|-------|--------|---------|-----------|-----------|
| ... | ... | ... | ... | ... |

### Copilot subscription (user-confirmed)
| Model | Tier hint |
|-------|-----------|
| ... | ... |

## Per-Agent Assignment

| Agent | Tier | Primary model | Fallback model | Rationale |
|-------|------|---------------|----------------|-----------|
| `project-orchestrator` | S | `gpt-5` | `qwen3.5:9b` | Reads many files, coordinates handoffs, high reasoning. |
| `docs-writer` | L | `claude-haiku-4.x` | `qwen3.5:4b` | Short prose generation, single-file edits. |

## Per-Agent Scores

| Agent | Reasoning | Code-gen | Context | Tool use | Latency | Safety | Tier |
|-------|-----------|----------|---------|----------|---------|--------|------|
| `project-orchestrator` | 3 | 1 | 3 | 3 | 2 | 2 | S |
| `docs-writer` | 1 | 1 | 1 | 2 | 1 | 1 | L |

## Launching with the Assigned Model (Copilot CLI)

For each agent, you can launch Copilot CLI with the matching model:

```bash
COPILOT_MODEL="<primary>" copilot
```

Or use the wrappers under `.github/agents/_model-launch.sh` (Bash) or
`.github/agents/_model-launch.ps1` (PowerShell), if generated by Apply mode.

## Notes

- Tiers and rubric are defined in `forge-assign-models` SKILL.md.
- To regenerate this plan after team changes, run the skill again in Re-tune mode.
````

---

### Step 5 (Apply mode only): Write `model:` into Agent Frontmatter

Only proceed if the user explicitly confirmed Apply mode.

For each agent file under `.github/agents/`:

1. Parse the YAML frontmatter.
2. Add or update **only** these two keys, preserving all other keys and ordering as much
   as possible:
   - `model: <primary model name>`
   - `modelFallback: <fallback model name>`
3. Do not modify the agent body. Do not reformat the file.
4. If `model:` was already set to the same value, leave the file untouched (no churn).
5. After all writes, regenerate `docs/MODEL-PLAN.md` with `Status: Applied on <date>`.

#### Optional: emit launch wrappers for CLI users

If the user opts in, generate two wrapper files that map agent names to env-var-prefixed
`copilot` invocations:

- `.github/agents/_model-launch.sh` (Bash)
- `.github/agents/_model-launch.ps1` (PowerShell)

Each wrapper takes an agent name as its first argument, looks up the matching `model:`
from the agent file's frontmatter, exports `COPILOT_MODEL`, and execs `copilot`. Keep
these wrappers small and dependency-free (POSIX `awk`/`sed` for Bash, native cmdlets for
PowerShell). Do not embed the model list in the script — read it live from the agent
files so the wrapper stays in sync with the frontmatter.

#### Constraints when writing files

- Never delete or rename existing keys.
- Never touch agents whose tier and selected model would not change (Re-tune mode).
- Never write a model name that is not in `docs/research/model-inventory.json`.
- Always present a diff summary ("3 agents changed, 5 unchanged") and ask for
  confirmation before committing.

---

### Step 6 (Re-tune mode): Targeted Refresh After Team Changes

When the team has been modified by `forge-team-builder` (typically Feature Increment
Mode):

1. Read the prior `docs/MODEL-PLAN.md` and the prior `docs/research/model-inventory.json`.
2. Diff the current `.github/agents/*.md` against the prior plan:
   - **New agents** → score and assign as in Steps 2–3.
   - **Agents whose Responsibilities or Skills changed** → re-score and only update the
     plan if the tier changes.
   - **Unchanged agents** → leave their `model:` untouched.
3. Refresh the inventory only if it is older than 7 days or the user asks for it.
4. Update `docs/MODEL-PLAN.md` and (if Apply was previously confirmed) the affected agent
   files only. Mirror `forge-team-builder`'s minimal-change philosophy.

---

## Constraints

- **Privacy:** never transmit agent contents, the inventory, or the plan to any external
  service. All discovery and classification happens inside the user's existing Copilot
  session and against `localhost` services they already run.
- **Capability gating:** never recommend a model that does not support tool calling for
  an agent whose tool-use axis is 2 or higher.
- **No fabricated models:** never recommend a model that is not present in
  `docs/research/model-inventory.json`. If the inventory is empty, stop and tell the user
  to run Discover first.
- **No price tables:** do not embed cost numbers in `MODEL-PLAN.md`. Use relative tiers
  (S / M / L). If the user supplies a `docs/research/model-cost-table.yml`, you may
  surface the numbers in the plan but do not invent them.
- **Determinism:** two runs against the same team and the same inventory must produce
  the same plan. Pin the inventory snapshot referenced in `MODEL-PLAN.md`.
- **Backwards compatibility:** the `model:` and `modelFallback:` frontmatter fields are
  optional. Agent files without them must continue to work — Copilot will use the user's
  current default model.
- **Honest about enforcement:** always include the note in `MODEL-PLAN.md` that
  per-agent `model:` is honored by VS Code custom agents but is advisory in Copilot CLI
  BYOK today (the active model is process-wide via `COPILOT_MODEL`).
- **Do not modify the forge meta-agents** (`project-orchestrator.md`,
  `forge-team-builder.md`) unless the user explicitly asks. They are tooling, not
  domain agents.
- **Re-verify Copilot's surface at runtime.** Model availability and the `model:`
  frontmatter behavior change frequently; if uncertain, search the latest official
  Copilot custom-agent and BYOK documentation rather than relying on training data.

---

## Output Standards

- Inventory cache → `docs/research/model-inventory.json`
- Plan document → `docs/MODEL-PLAN.md`
- Per-agent assignment → `model:` and `modelFallback:` keys in the YAML frontmatter of
  `.github/agents/*.md` (Apply mode only)
- Optional launch wrappers → `.github/agents/_model-launch.sh` and
  `.github/agents/_model-launch.ps1` (Apply mode only, opt-in)

---

## Reference

- [docs/running-with-local-models.md](../../../docs/running-with-local-models.md) — Ollama
  setup, recommended local models, and the model evaluator.
- [docs/research/model-evals/summary.md](../../../docs/research/model-evals/summary.md) —
  Tool-calling reliability scores for local models, when present.
- [forge-build-agent-team SKILL.md](../forge-build-agent-team/SKILL.md) — The team-build
  process this skill runs after.
