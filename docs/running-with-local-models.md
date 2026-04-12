# Running with Local Models (BYOK)

GitHub Copilot CLI supports [Bring Your Own Key (BYOK)](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models), letting you point it at a local Ollama instance. Since Copilot CLI picks up `.github/agents/` and `.github/skills/` from your repo, your entire Agent Forge team can run against a local model.

## Setup

1. Install and start [Ollama](https://ollama.com/) and pull a current model tag that supports tool calling and streaming:

```bash
ollama pull qwen3.5:4b
```

2. Set BYOK environment variables:

```bash
export COPILOT_PROVIDER_BASE_URL=http://localhost:11434
export COPILOT_MODEL=qwen3.5:4b
```

3. Start Copilot CLI:

```bash
copilot
```

> [!TIP]
> For fully air-gapped environments, also set `export COPILOT_OFFLINE=true`.

## Recommended Local Models

| Model | Size | Context | Best for |
|-------|------|---------|----------|
| `gemma4:e4b` | 9.6GB | 128K | General-purpose quality/performance balance |
| `gemma4:26b` | 18GB | 256K | Higher reasoning quality on stronger hardware |
| `qwen3.5:4b` | 3.4GB | 256K | CPU-first baseline for local skill/tool workflows |
| `qwen3.5:9b` | 6.6GB | 256K | Better quality than 4B with moderate CPU cost |
| `granite4:3b` | 2.1GB | 128K | Lightweight IBM option with tool-calling focus |
| `granite4:tiny-h` | 4.2GB | 1M | Long-context IBM option for agentic workflows |
| `granite4:1b` | 3.3GB | 128K | Speed-focused fallback when CPU resources are tight |

> [!NOTE]
> Models must support tool calling (function calling) and streaming. Some older tags may no longer be published in the Ollama registry.

## GPU Notes (NVIDIA 4GB VRAM)

If your machine has a discrete NVIDIA GPU with around 4GB VRAM (for example Quadro M2200 class), you can still benefit from GPU acceleration, but you should size expectations correctly.

- Best fit: 1B to 4B models for smoother acceleration.
- Usually workable: some 7B to 9B models with mixed CPU/GPU execution.
- Often impractical for interactive use: larger models that require heavy CPU fallback.

Practical recommendations:

1. Start with `qwen3.5:4b` or `granite4:3b`.
2. Add a larger comparison model only after baseline reliability is confirmed.
3. Keep only one active model workload during testing to reduce VRAM churn.

To verify GPU participation during inference:

```bash
watch -n 1 nvidia-smi
```

Run a model request in another terminal. If GPU utilization and memory usage increase, the model is offloading work to the GPU.

## Validate Model Reliability Before Adopting

Use the evaluator to compare candidate models on tool-calling reliability, structured output quality, and latency:

```bash
chmod +x scripts/evaluate-ollama-models.sh
./scripts/evaluate-ollama-models.sh --models "qwen3.5:4b granite4:3b granite4:tiny-h" --runs 5
```

Review output:

- `docs/research/model-evals/summary.md`
- `docs/research/model-evals/results.csv`

Detailed decision criteria are in:

- `docs/research/local-model-evaluation-runbook.md`

## Prevent Overheating During Local Inference

Use these safeguards for sustained local model runs on laptops or CPU-only systems.

### 1) Enable thermal management

```bash
sudo apt update
sudo apt install -y lm-sensors thermald tlp
sudo sensors-detect --auto
sudo systemctl enable --now thermald tlp
```

### 2) Monitor temperature live while running models

```bash
watch -n 2 sensors
```

### 3) Use conservative power profile for long sessions

```bash
powerprofilesctl set balanced
# or
powerprofilesctl set power-saver
```

### 4) Limit Ollama concurrency

```bash
export OLLAMA_NUM_PARALLEL=1
export OLLAMA_MAX_LOADED_MODELS=1
```

### 5) Practical thermal thresholds

- Target sustained CPU temperature under 85-90C.
- If repeated spikes exceed 95C, stop workload and reduce model size/concurrency.

### 6) Physical cooling best practices

- Keep vents clear and elevate the rear of the laptop.
- Avoid running pull/download, inference, and heavy builds concurrently.
- Clean dust from fans and heatsinks on a regular schedule.