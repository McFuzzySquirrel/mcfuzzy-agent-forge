#!/usr/bin/env bash
# forge-engine-run.sh -Run the forge-workflow-engine as a standalone process,
# from outside any interactive CLI session (second terminal, CI, nohup).
#
# This is the "execution" half of Agent Forge's author/execute split:
# authoring (PRD -> team -> manifest) happens in a chat session; execution
# happens here, with the engine driving every task through a harness adapter.
#
# Usage:
#   ./scripts/forge-engine-run.sh [--repo <path>] [--harness opencode|copilot|openai|stub|flowforge-kernel]
#                                 [--concurrency <n>] [--task-timeout-ms <ms>] [--yes] [--dry-run]
#
# Options:
#   --repo <path>     Repo root (default: detected by walking up for .git)
#   --harness <h>     Per-task harness (default: $FORGE_ENGINE_HARNESS or "opencode")
#   --concurrency <n> Max ready tasks to run in parallel (default: $FORGE_ENGINE_CONCURRENCY or "1").
#                     Only harnesses that declare supportsConcurrency parallelize (see ADR-021).
#   --task-timeout-ms <ms> Per-task timeout (default: $FORGE_ENGINE_TASK_TIMEOUT_MS or 600000).
#                          Per-task timeoutMs in the manifest overrides this.
#   --yes             Skip the engine's pre-run gate (same as FORGE_ENGINE_YES=1)
#   --dry-run         Print the commands without executing them
#
# Environment:
#   FORGE_ENGINE_HARNESS       Default harness when --harness is not passed
#   FORGE_ENGINE_CONCURRENCY   Default concurrency when --concurrency is not passed
#   FORGE_ENGINE_TASK_TIMEOUT_MS  Default per-task timeout in ms when --task-timeout-ms is not passed
#   FORGE_ENGINE_YES           Skip the pre-run gate (same as --yes)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

REPO=""
HARNESS="${FORGE_ENGINE_HARNESS:-opencode}"
CONCURRENCY="${FORGE_ENGINE_CONCURRENCY:-}"
TASK_TIMEOUT_MS="${FORGE_ENGINE_TASK_TIMEOUT_MS:-}"
YES=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --harness) HARNESS="$2"; shift 2 ;;
    --concurrency) CONCURRENCY="$2"; shift 2 ;;
    --task-timeout-ms) TASK_TIMEOUT_MS="$2"; shift 2 ;;
    --yes) YES=true; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Resolve repo root: --repo, or walk up from cwd looking for .git.
detect_repo_root() {
  local current="$(pwd)"
  for _ in $(seq 1 12); do
    if [[ -d "$current/.git" ]]; then
      echo "$current"
      return 0
    fi
    local parent
    parent="$(dirname "$current")"
    [[ "$parent" == "$current" ]] && break
    current="$parent"
  done
  echo "$current"
}

[[ -n "$REPO" ]] || REPO="$(detect_repo_root)"
REPO="$(realpath -m "$REPO")"
if [[ ! -d "$REPO/.git" ]]; then
  echo "Error: not a git repository: $REPO" >&2
  exit 1
fi

# Locate the bootstrapped skill packages under the harness directory.
ENGINE_DIR=""
ADAPTER_DIR=""
for root in ".agents" ".opencode" ".claude" ".github"; do
  [[ -d "$REPO/$root/skills/forge-workflow-engine" ]] && ENGINE_DIR="$REPO/$root/skills/forge-workflow-engine"
  [[ -d "$REPO/$root/skills/forge-execution-adapter" ]] && ADAPTER_DIR="$REPO/$root/skills/forge-execution-adapter"
  [[ -n "$ENGINE_DIR" && -n "$ADAPTER_DIR" ]] && break
done

if [[ -z "$ENGINE_DIR" ]]; then
  echo "Error: forge-workflow-engine not found under $REPO (looked in .agents/.opencode/.claude/.github skills dirs)." >&2
  exit 1
fi

MANIFEST="$REPO/docs/EXECUTION-MANIFEST.json"

echo "forge-engine-run: repo=$REPO harness=$HARNESS${CONCURRENCY:+ concurrency=$CONCURRENCY}${TASK_TIMEOUT_MS:+ task-timeout=$TASK_TIMEOUT_MS}"
echo "  engine : $ENGINE_DIR"
echo "  adapter: ${ADAPTER_DIR:-<not bootstrapped; manifest must already exist>}"

run() {
  if [[ "$DRY_RUN" == true ]]; then
    echo "  [dry-run] $*"
    return 0
  fi
  eval "$@"
}

# 1. Prepare: install the execution adapter (if present) and compile the manifest.
if [[ -n "$ADAPTER_DIR" && ! -f "$MANIFEST" ]]; then
  run "(cd '$ADAPTER_DIR' && npm install && npm run forge-execution-adapter -- compile)"
elif [[ -n "$ADAPTER_DIR" ]]; then
  run "(cd '$ADAPTER_DIR' && npm install)"
fi

if [[ -f "$MANIFEST" ]]; then
  echo "  manifest: $MANIFEST (exists)"
else
  if [[ "$DRY_RUN" == true ]]; then
    echo "  manifest: $MANIFEST (will be compiled by the adapter step above)"
  else
    echo "Error: $MANIFEST not found. Compile it via forge-execution-adapter (or bootstrapped adapter + run again)." >&2
    exit 1
  fi
fi

# 2. Install engine dependencies (node module bootstrap happens here, not at bootstrap.sh time).
run "(cd '$ENGINE_DIR' && npm install)"

# 3. Run the engine as a foreground, standalone process.
YES_FLAG=""
[[ "$YES" == true || "${FORGE_ENGINE_YES:-0}" == "1" ]] && YES_FLAG="--yes"

ENGINE_FLAGS=(--harness "$HARNESS")
[[ -n "$CONCURRENCY" ]] && ENGINE_FLAGS+=(--concurrency "$CONCURRENCY")
[[ -n "$TASK_TIMEOUT_MS" ]] && ENGINE_FLAGS+=(--task-timeout-ms "$TASK_TIMEOUT_MS")
[[ -n "$YES_FLAG" ]] && ENGINE_FLAGS+=("$YES_FLAG")

if [[ "$DRY_RUN" == true ]]; then
  echo "  [dry-run] (cd '$ENGINE_DIR' && npm run workflow-engine -- run ${ENGINE_FLAGS[*]})"
else
  (cd "$ENGINE_DIR" && npm run workflow-engine -- run "${ENGINE_FLAGS[@]}")
fi
