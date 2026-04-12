#!/usr/bin/env bash
# evaluate-ollama-models.sh — Evaluate local Ollama models for Copilot CLI readiness.
#
# Focuses on practical prerequisites for skills/agents:
# 1) Basic chat completion succeeds
# 2) Tool calling works reliably (function-call style output)
# 3) Structured orchestration output is valid JSON

set -euo pipefail

BASE_URL="http://localhost:11434"
OUTPUT_DIR="docs/research/model-evals"
RUNS=3
MODELS=()

usage() {
  cat <<'EOF'
Usage:
  ./scripts/evaluate-ollama-models.sh --models "qwen3:7b gemma4:e4b" [options]

Options:
  --models "..."      Space-separated model list (required)
  --runs N             Number of runs per probe (default: 3)
  --base-url URL       Ollama base URL (default: http://localhost:11434)
  --output-dir DIR     Output directory (default: docs/research/model-evals)
  -h, --help           Show this help

Outputs:
  - summary.md         Human-readable score table
  - results.csv        Per-run raw metrics
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --models)
      read -r -a MODELS <<< "${2:-}"
      shift 2
      ;;
    --runs)
      RUNS="${2:-3}"
      shift 2
      ;;
    --base-url)
      BASE_URL="${2:-$BASE_URL}"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="${2:-$OUTPUT_DIR}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ ${#MODELS[@]} -eq 0 ]]; then
  echo "Error: --models is required." >&2
  usage
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "Error: jq is required." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
CSV_FILE="$OUTPUT_DIR/results.csv"
SUMMARY_FILE="$OUTPUT_DIR/summary.md"

echo "model,probe,run,status,duration_ms,eval_count,eval_duration_ns,tokens_per_sec,notes" > "$CSV_FILE"

post_chat() {
  local payload="$1"
  curl -sS --max-time 180 -X POST "$BASE_URL/api/chat" \
    -H "Content-Type: application/json" \
    -d "$payload"
}

run_probe() {
  local model="$1"
  local probe="$2"
  local run_idx="$3"
  local payload="$4"
  local check_jq="$5"

  local start_ms end_ms duration_ms response status eval_count eval_duration tps notes
  start_ms="$(date +%s%3N)"

  if ! response="$(post_chat "$payload")"; then
    end_ms="$(date +%s%3N)"
    duration_ms=$((end_ms - start_ms))
    echo "$model,$probe,$run_idx,fail,$duration_ms,0,0,0,curl_request_failed" >> "$CSV_FILE"
    return 1
  fi

  end_ms="$(date +%s%3N)"
  duration_ms=$((end_ms - start_ms))

  # Guard for malformed responses.
  if ! echo "$response" | jq . >/dev/null 2>&1; then
    echo "$model,$probe,$run_idx,fail,$duration_ms,0,0,0,invalid_json_response" >> "$CSV_FILE"
    return 1
  fi

  if echo "$response" | jq -e "$check_jq" >/dev/null 2>&1; then
    status="pass"
    notes="ok"
  else
    status="fail"
    notes="probe_condition_not_met"
  fi

  eval_count="$(echo "$response" | jq -r '.eval_count // 0')"
  eval_duration="$(echo "$response" | jq -r '.eval_duration // 0')"
  tps="0"
  if [[ "$eval_duration" != "0" ]]; then
    tps="$(jq -nr --arg ec "$eval_count" --arg ed "$eval_duration" 'if ($ed|tonumber) > 0 then (($ec|tonumber) / (($ed|tonumber) / 1000000000)) else 0 end')"
  fi

  echo "$model,$probe,$run_idx,$status,$duration_ms,$eval_count,$eval_duration,$tps,$notes" >> "$CSV_FILE"

  [[ "$status" == "pass" ]]
}

for model in "${MODELS[@]}"; do
  echo "Evaluating model: $model"

  for run_idx in $(seq 1 "$RUNS"); do
    basic_payload="$(jq -cn --arg model "$model" '{model:$model, stream:false, messages:[{role:"user", content:"Reply with exactly: READY"}]}')"
    run_probe "$model" "basic_chat" "$run_idx" "$basic_payload" '.message.content | type == "string" and (contains("READY") or contains("ready"))' || true
  done

  for run_idx in $(seq 1 "$RUNS"); do
    tool_payload="$(jq -cn --arg model "$model" '{
      model:$model,
      stream:false,
      messages:[{role:"user", content:"What time is it in UTC? Use the get_utc_time tool before answering."}],
      tools:[{
        type:"function",
        function:{
          name:"get_utc_time",
          description:"Returns current UTC time in ISO8601",
          parameters:{type:"object",properties:{},required:[]}
        }
      }]
    }')"
    run_probe "$model" "tool_call" "$run_idx" "$tool_payload" '.message.tool_calls | type == "array" and length > 0' || true
  done

  for run_idx in $(seq 1 "$RUNS"); do
    json_payload="$(jq -cn --arg model "$model" '{
      model:$model,
      stream:false,
      format:"json",
      messages:[{role:"user", content:"Return JSON only with keys: phase, steps, tools. phase must be \"F1\". steps must be an array of exactly 3 short strings. tools must include \"Read\" and \"Edit\"."}]
    }')"
    run_probe "$model" "structured_json" "$run_idx" "$json_payload" '.message.content | fromjson | (.phase == "F1" and (.steps|type=="array") and (.steps|length==3) and (.tools|type=="array") and ((.tools|index("Read")) != null) and ((.tools|index("Edit")) != null))' || true
  done
done

{
  echo "# Local Ollama Model Evaluation"
  echo ""
  echo "Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo ""
  echo "| Model | Probe | Pass Rate | Avg Duration (ms) | Avg Tokens/sec |"
  echo "|---|---|---:|---:|---:|"

  tail -n +2 "$CSV_FILE" | awk -F, '
    {
      key=$1"|"$2
      total[key]++
      if ($4=="pass") pass[key]++
      dur[key]+=$5
      tps[key]+=$8
    }
    END {
      for (k in total) {
        split(k, parts, "|")
        model=parts[1]
        probe=parts[2]
        pr=(pass[k] / total[k]) * 100
        ad=dur[k] / total[k]
        at=tps[k] / total[k]
        printf "| %s | %s | %.1f%% | %.0f | %.2f |\n", model, probe, pr, ad, at
      }
    }
  ' | sort
  echo ""
  echo "## Recommendation Rule"
  echo ""
  echo "Pick the model with highest tool_call pass rate first."
  echo "Use structured_json pass rate as a tie-breaker."
  echo "Use Avg Duration as the second tie-breaker for CPU-only setups."
  echo ""
  echo "Raw metrics: $CSV_FILE"
} > "$SUMMARY_FILE"

echo ""
echo "Done."
echo "- Summary: $SUMMARY_FILE"
echo "- Raw data: $CSV_FILE"