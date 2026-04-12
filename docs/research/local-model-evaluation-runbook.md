# Research: Local Model Evaluation Runbook

**Date:** 2026-04-12  
**Status:** Ready to run

---

## Goal

Validate which local Ollama model is most reliable for Agent Forge skill execution on your hardware.

Priority order used in this runbook:

1. Tool-calling reliability
2. Structured output reliability
3. CPU latency

---

## Prerequisites

- Ollama running locally (`http://localhost:11434`)
- `curl` and `jq` installed
- Candidate models pulled, for example:

```bash
ollama pull qwen3:7b
ollama pull gemma4:e4b
ollama pull gemma4:26b
```

---

## Run Evaluation

From the repository root:

```bash
chmod +x scripts/evaluate-ollama-models.sh
./scripts/evaluate-ollama-models.sh \
  --models "qwen3:7b gemma4:e4b gemma4:26b" \
  --runs 5
```

Artifacts are written to:

- `docs/research/model-evals/summary.md`
- `docs/research/model-evals/results.csv`

---

## How to Decide

Use this decision sequence:

1. Highest `tool_call` pass rate wins.
2. If tied, highest `structured_json` pass rate wins.
3. If still tied, lowest average duration wins.

Recommended acceptance threshold for production default:

- `tool_call` pass rate >= 95%
- `structured_json` pass rate >= 90%

If no model reaches thresholds, choose the best pass rates and reduce agent complexity until a stable model is available.

---

## Suggested Default for CPU-Only 32GB

Start with `qwen3:7b` as default for reliability/resource balance.

Promote to `gemma4:e4b` only if:

- Tool-calling reliability remains at or above threshold, and
- You need better quality than `qwen3:7b`, and
- Latency is still acceptable in your workflow.

Treat `gemma4:26b` as optional for CPU-only systems unless latency is acceptable in real usage.

---

## Manual Spot Check in Copilot CLI

After selecting a winner with this script, run 3 real tasks in Copilot CLI using your local test repo and confirm:

1. Tool calls are emitted when required.
2. The model follows multi-step skill instructions without skipping required outputs.
3. Output remains consistent across repeated runs.

This keeps final validation aligned to your actual skill workflow, not only raw API behavior.