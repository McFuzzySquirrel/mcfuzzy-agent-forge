---
name: forge-assign-models
description: "Discover the user's available OpenCode, Copilot, BYOK, and local Ollama models, enrich their capabilities with BenchLM evidence, classify generated agents, and recommend or apply per-agent model assignments. Use after `forge-build-agent-team` or whenever the team changes."
---

# Skill: Assign Models to a Generated Agent Team

You are assigning a per-agent LLM model to each agent in `HARNESS_AGENTS_DIR`. Load `forge-build-agent-team/references/detect-harness.md` to determine `HARNESS_AGENTS_DIR` for this repository before proceeding. Explicitly inspect `.opencode/agents/**/*.md` and `.opencode/skills/**/SKILL.md` when the repository uses OpenCode. Match each agent's actual workload to a model from the **inventory the user actually has access to**, rather than defaulting every agent to the strongest cloud model.

This skill is **opt-in and post-hoc**. The `model:` field is optional; absence means "use
the user's current default model".

---

## Modes

| Mode | What it does | Writes files? |
|------|--------------|---------------|
| **Discover** | Enumerate available models and cache the inventory. | Only `docs/research/model-inventory.json`. |
| **Recommend** | Produce `docs/MODEL-PLAN.md` with a proposed model per agent + rationale. | Only `docs/MODEL-PLAN.md`. |
| **Apply** | Write `model:` and `modelFallback:` into each agent's YAML frontmatter; refresh `docs/MODEL-PLAN.md`. | Agent files + `docs/MODEL-PLAN.md`. |
| **Re-tune** | Re-run after team changes; only re-evaluate agents whose role changed. | Only changed agent files + `docs/MODEL-PLAN.md`. |

Default to **Recommend** if no mode is specified.

---

## Process

### Step 0: Detect Mode and Preconditions

1. Confirm `HARNESS_AGENTS_DIR` exists and contains agent files beyond the forge templates
   (`project-orchestrator`, `forge-team-builder`). If not, stop and instruct the user to
   run `forge-build-agent-team` first.
2. Determine mode from the user's prompt:
   - "discover" / "what models do I have" → **Discover**
   - "recommend" / "suggest" / no mode → **Recommend**
   - "apply" / "set" / "write" → **Apply** (requires explicit confirmation)
   - "re-tune" / "refresh" / "update after feature" → **Re-tune**
3. If `docs/research/model-inventory.json` exists and is < 7 days old, reuse it.
4. If `docs/MODEL-PLAN.md` exists, treat it as the prior plan; prefer minimal changes.

---

### Step 1: Discover the Available Model Inventory

Build a single inventory of models the user can invoke. Never invent models.
The OpenCode and Copilot CLI probes below are mandatory discovery actions, not
optional suggestions. Execute both commands before inspecting Ollama or
producing a recommendation. If a command is unavailable or exits non-zero,
record that result and continue with the other sources.

#### 1a. OpenCode CLI

Run this command exactly when the `opencode` executable is available:

```bash
opencode models
```

Capture its exit status, stdout, and stderr under `opencode_cli.diagnostics`.
Parse stdout and stderr only after the command has completed. The resulting
`opencode_cli.models` list must contain normalized model IDs, never the whole
command response.

#### 1b. Copilot CLI

Run this command exactly when the `copilot` executable is available:

```bash
copilot -p "/model list"
```

Capture its exit status, stdout, and stderr under `copilot_cli.diagnostics`.
Parse the command output into normalized IDs and store them under
`copilot_cli.models`. Do not replace this step with the static catalog in the
schema reference and do not ask the user to manually transcribe the model
picker unless the command is unavailable or fails.

#### 1c. Local Ollama

Default to `http://localhost:11434` (honor `OLLAMA_HOST` if set).
1. `GET /api/tags` - capture `name`, `size`, `modified_at`.
2. `ollama show <name>` or `POST /api/show` - capture `parameter_size`, `context_length`, `quantization_level`, tool/function calling support.
3. **Filter out models without tool calling.** Mark them as `excluded: "no tool calling"`.
4. Cross-reference `docs/research/model-evals/` if present; attach `eval_score` and `eval_notes`. Do not re-benchmark.

If Ollama is unreachable, record `{ "ollama": { "available": false, "reason": "..." } }` and continue.

#### 1d. Normalize CLI model output

Parse output line-by-line and strip headings, bullets, numbering, table borders, quotes, backticks, provider labels, and trailing annotations such as `(recommended)` or `[available]`. Preserve provider-qualified IDs when they are part of the actual identifier, such as `openai/gpt-5`. Reject empty or clearly non-model lines, deduplicate case-insensitively, and retain the canonical spelling from the source. Store raw output only under diagnostics; use normalized IDs everywhere else. If a line is ambiguous, mark it unverified rather than guessing.

Examples: `OpenAI: gpt-5` becomes `gpt-5`; `Anthropic - claude-sonnet-4 (recommended)` becomes `claude-sonnet-4`; `openai/gpt-5` remains `openai/gpt-5`.

#### 1e. BYOK Provider

If `COPILOT_PROVIDER_BASE_URL` is set: `GET {base_url}/v1/models`. Capture `id` and `context_length`. On 401/403/404, record the reason and skip.

#### 1f. BenchLM capability enrichment

For each normalized model, query BenchLM's public model/leaderboard data when available and attach the model URL, overall score, agentic/tool-use score, coding score, reasoning score, context length, evidence status, and retrieval timestamp. BenchLM is capability evidence only: a model is assignable only if OpenCode, Copilot, BYOK, or Ollama discovered it. Unmatched models remain usable with `capabilities: "unverified"`; an unavailable BenchLM response must not discard a discovered model.

#### 1g. Persist the Inventory

Write `docs/research/model-inventory.json`. Load `references/model-inventory-schema.md` for the canonical JSON shape. Adapt to what was actually discovered; omit empty sections.

If in **Discover** mode, stop here and present a human-readable summary.

---

### Step 2: Read and Classify Each Agent's Workload

For each file matching `HARNESS_AGENTS_DIR/**/*.md` (including `.opencode/agents`):
1. Parse YAML frontmatter (`name`, `description`, `model`, `modelFallback`).
2. Read skills referenced in `## Collaboration` / `## Skills` sections and discover `.opencode/skills/**/SKILL.md`; they often reveal the real workload.

Score each agent on this rubric (1 = low, 2 = medium, 3 = high):

| Axis | High (3) signals | Low (1) signals |
|------|------------------|-----------------|
| **Reasoning depth** | Architecture, refactor, security review, debugging, multi-file design | Doc writing, formatting, lint fixes, single-file edits |
| **Code-gen volume** | Generates many files, scaffolds subsystems | Small targeted edits, mostly prose |
| **Context window need** | Reads many files, references full PRD + feature docs | Operates on 1–2 files |
| **Tool-calling reliance** | Heavy file/edit/build/test tool use | Mostly chat/text output |
| **Latency sensitivity** | Interactive pairing, fast feedback loops | Long-running phase work |
| **Determinism / safety** | Security, auth, migrations, payments | Cosmetic changes, drafts |

Map scores to tiers:
- **Tier S (Strong)** - Reasoning depth = 3 OR determinism/safety = 3 OR (context = 3 AND reasoning ≥ 2)
- **Tier M (Balanced)** - Most domain/feature engineers (reasoning 2, code-gen 2–3, context 2, tool-use 3)
- **Tier L (Light)** - Reasoning ≤ 2, code-gen ≤ 2, context = 1

Always record per-axis scores so the recommendation is auditable.

---

### Step 3: Map Tiers to Concrete Models

Pick a **primary** and **fallback** for each agent from the inventory. Rules:
1. **Tool-calling gate.** If tool-calling axis ≥ 2, both primary and fallback must support tool calling.
2. **Context window.** If context axis = 3, prefer largest `context_length`.
3. **Local-first override.** If user requested "local"/"BYOK"/"offline" or `COPILOT_OFFLINE=true`, prefer Ollama even for Tier S.
4. **Default tier mapping:** Tier S → strongest reasoning cloud; Tier M → balanced cloud; Tier L → fast/light cloud. Fallback = strongest local model at each tier.
5. **Stable selection.** Prefer models already in prior `docs/MODEL-PLAN.md`.
6. **Always emit a fallback.** If no second model exists, set `modelFallback: <same as primary>` and note it.

---

### Step 4: Produce `docs/MODEL-PLAN.md`

Write with this structure:

````markdown
# Model Assignment Plan

**Generated by:** `forge-assign-models` skill
**Mode:** {Discover | Recommend | Apply | Re-tune}
**Inventory snapshot:** `docs/research/model-inventory.json` (last verified: YYYY-MM-DD)
**Status:** {Proposed | Applied on YYYY-MM-DD}

> Per-agent model assignment is honored by VS Code custom agents via the `model:` field.
> In Copilot CLI, assignments are advisory - the model is process-wide via `COPILOT_MODEL`.

## Inventory Used

### Local (Ollama)
| Model | Params | Context | Tool calls | Eval score |
|-------|--------|---------|-----------|-----------|

### Copilot subscription
| Model | Tier hint |
|-------|-----------|

## Per-Agent Assignment

| Agent | Tier | Primary model | Fallback model | Rationale |
|-------|------|---------------|----------------|-----------|

## Manual Agent Overrides

Manual overrides are stored in `docs/model-overrides.json` and shown here for review. They apply to every task owned by the agent and take precedence over generated recommendations. The console may edit these overrides without changing agent files; Apply mode can explicitly copy them into agent frontmatter.

## Per-Agent Scores

| Agent | Reasoning | Code-gen | Context | Tool use | Latency | Safety | Tier |
|-------|-----------|----------|---------|----------|---------|--------|------|

## Notes

- Tiers and rubric defined in `forge-assign-models` SKILL.md.
- Regenerate via Re-tune mode after team changes.
````

---

### Step 5 (Apply mode only): Write `model:` into Agent Frontmatter

For each `HARNESS_AGENTS_DIR/*.md`:
1. Parse YAML frontmatter.
2. Add/update only `model:` and `modelFallback:`. Preserve all other keys and ordering.
3. Do not modify the body. Do not reformat.
4. If `model:` already matches, leave untouched.
5. After writes, regenerate `docs/MODEL-PLAN.md` with `Status: Applied on <date>`.

**Constraints:** Never delete/rename keys. Never touch agents whose tier wouldn't change. Never write un-inventoried models. Always present a diff summary first.

---

### Step 6 (Re-tune mode): Targeted Refresh After Team Changes

1. Read prior `docs/MODEL-PLAN.md` and inventory.
2. Diff `HARNESS_AGENTS_DIR/*.md` against prior plan. New agents → score. Changed agents → re-score, update only if tier changes. Unchanged → leave alone.
3. Refresh inventory only if > 7 days old or user requests.
4. Update `docs/MODEL-PLAN.md` and affected agent files only.

---

## Gotchas

- **`ollama show` failures.** Some models (especially quantized or custom) don't return metadata reliably. If `ollama show` fails, check capability via `ollama run <model> "list your tools"` as a fallback, and mark `tool_calling: "unverified"` in the inventory.
- **Copilot model names change frequently.** Treat the current `copilot -p "/model list"` result as authoritative for availability; BenchLM data is only capability evidence and may lag or omit a model.
- **CLI output is presentation text.** Never write a whole `opencode models` or Copilot response into `model:`; only write normalized IDs from the inventory.
- **Empty inventory is a hard stop.** If no models are discoverable (Ollama unreachable, no subscription confirmation), stop and tell the user. Never fabricate.
- **Don't touch the forge meta-agents.** `project-orchestrator` and `forge-team-builder` are tooling, not domain agents. Skip them unless explicitly asked.
- **Re-tune mirrors the team builder's minimal-change philosophy.** Only modify what changed.

---

## Constraints

- **Privacy:** never transmit inventory or agent contents externally.
- **Capability gating:** no tool-calling-capable model assignments for agents with tool-use axis ≥ 2.
- **No fabricated models.** Only models in `docs/research/model-inventory.json`.
- **No price tables.** Use relative tiers (S/M/L).
- **Determinism.** Same team + same inventory → same plan every run.
- **Backwards compatibility.** `model:` and `modelFallback:` are optional.

---

## Output Standards

- Inventory cache → `docs/research/model-inventory.json`
- Plan document → `docs/MODEL-PLAN.md`
- Per-agent assignment → `model:` and `modelFallback:` in `HARNESS_AGENTS_DIR/*.md` (Apply mode only)

---

## Reference

- [docs/running-with-local-models.md](../../../docs/running-with-local-models.md) - Ollama setup and model recommendations.
- [docs/research/model-evals/summary.md](../../../docs/research/model-evals/summary.md) - Tool-calling reliability scores for local models.
- [forge-build-agent-team SKILL.md](../forge-build-agent-team/SKILL.md) - The team-build process this skill runs after.
