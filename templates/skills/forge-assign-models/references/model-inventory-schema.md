# Model Inventory Schema

## JSON Schema

The canonical shape for `docs/research/model-inventory.json`:

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

## Copilot Subscription Model Tiers

This catalog represents models commonly exposed across Copilot plans. Always have the user confirm against their current model picker.

- **Reasoning / strongest tier** - e.g. `gpt-5` family, `claude-opus-4.x`, `gemini-2.5-pro`, `o`-series reasoning models
- **Balanced tier** - e.g. `gpt-5-codex`, `claude-sonnet-4.x`, `gpt-4.1`
- **Fast / light tier** - e.g. `claude-haiku-4.x`, `gpt-5-mini`, `gpt-4.1-mini`
