#!/usr/bin/env bash
# bootstrap.sh — Deploy mcfuzzy-agent-forge templates into a target repository.
#
# Usage:
#   ./scripts/bootstrap.sh [TARGET_DIR] [--force]
#
# Arguments:
#   TARGET_DIR   Path to the target repository root (default: prompted)
#   --force      Overwrite existing files without prompting
#
# What it does:
#   Copies templates/agents/*.md   → TARGET_DIR/.github/agents/
#   Copies templates/skills/*/SKILL.md → TARGET_DIR/.github/skills/{name}/SKILL.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES_DIR="$(cd "$SCRIPT_DIR/../templates" && pwd)"
TARGET_DIR=""
FORCE=false

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    --*)     echo "Unknown option: $arg" >&2; exit 1 ;;
    *)       [[ -z "$TARGET_DIR" ]] && TARGET_DIR="$arg" ;;
  esac
done

# Prompt if no target supplied
if [[ -z "$TARGET_DIR" ]]; then
  read -rp "Target repository path [.]: " TARGET_DIR
  TARGET_DIR="${TARGET_DIR:-.}"
fi

TARGET_DIR="$(realpath "$TARGET_DIR")"

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "Error: Target directory does not exist: $TARGET_DIR" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Helper: copy a single file, respecting --force / interactive prompt
# ---------------------------------------------------------------------------
copy_file() {
  local src="$1"
  local dest="$2"

  if [[ -f "$dest" ]] && [[ "$FORCE" != true ]]; then
    read -rp "  Overwrite existing $(basename "$dest")? [y/N]: " answer
    if [[ "${answer,,}" != "y" ]]; then
      echo "  Skipped: $dest"
      return
    fi
  fi

  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  echo "  Copied:  $dest"
}

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------
echo ""
echo "Target: $TARGET_DIR"
echo ""

echo "Agents:"
for agent in "$TEMPLATES_DIR/agents/"*.md; do
  [[ -f "$agent" ]] || continue
  copy_file "$agent" "$TARGET_DIR/.github/agents/$(basename "$agent")"
done

echo ""
echo "Skills:"
for skill_dir in "$TEMPLATES_DIR/skills/"*/; do
  [[ -d "$skill_dir" ]] || continue
  skill_name="$(basename "$skill_dir")"
  src="$skill_dir/SKILL.md"
  [[ -f "$src" ]] || continue
  copy_file "$src" "$TARGET_DIR/.github/skills/$skill_name/SKILL.md"
done

echo ""
echo "Bootstrap complete."
echo "Commit .github/agents/ and .github/skills/ to your repository to activate the agents."
