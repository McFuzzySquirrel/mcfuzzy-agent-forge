#!/usr/bin/env bash
# bootstrap.sh — Deploy mcfuzzy-agent-forge templates into a target repository.
#
# Usage:
#   ./scripts/bootstrap.sh [TARGET_DIR] [--harness HARSH] [--force]
#
# Arguments:
#   TARGET_DIR   Path to the target repository root (default: prompted)
#   --harness    Target harness: agents (default), github, claude
#   --force      Overwrite existing files without prompting
#
# What it does:
#   Copies templates/agents/*.md   → TARGET_DIR/<root>/agents/
#   Copies templates/skills/*/SKILL.md → TARGET_DIR/<root>/skills/{name}/SKILL.md
#   Adapts internal path references when a non-default harness is selected.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES_DIR="$(cd "$SCRIPT_DIR/../templates" && pwd)"
TARGET_DIR=""
HARNESS="agents"
FORCE=false

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)                  FORCE=true; shift ;;
    --harness)
      HARNESS="$2"; shift 2 ;;
    --*)                      echo "Unknown option: $1" >&2; exit 1 ;;
    *)                        [[ -z "$TARGET_DIR" ]] && TARGET_DIR="$1"; shift ;;
  esac
done

# Map harness to root directory
case "$HARNESS" in
  agents) ROOT=".agents" ;;
  github) ROOT=".github" ;;
  claude) ROOT=".claude" ;;
  *)      echo "Error: Unknown harness '$HARNESS'. Valid: agents, github, claude" >&2; exit 1 ;;
esac

# Prompt if no target supplied
if [[ -z "$TARGET_DIR" ]]; then
  read -rp "Target repository path [.]: " TARGET_DIR
  TARGET_DIR="${TARGET_DIR:-.}"
fi

TARGET_DIR="$(realpath -m "$TARGET_DIR")"

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

  # For non-default harnesses, adapt internal path references
  if [[ "$HARNESS" != "agents" ]]; then
    sed -i "s|\.agents/|${ROOT}/|g" "$dest"
  fi

  echo "  Copied:  $dest"
}

# ---------------------------------------------------------------------------
# Bootstrap
# ---------------------------------------------------------------------------
echo ""
echo "Target:  $TARGET_DIR"
echo "Harness: $HARNESS ($ROOT)"
echo ""

AGENTS_DIR="$TARGET_DIR/$ROOT/agents"
SKILLS_DIR="$TARGET_DIR/$ROOT/skills"

echo "Agents ($AGENTS_DIR):"
for agent in "$TEMPLATES_DIR/agents/"*.md; do
  [[ -f "$agent" ]] || continue
  copy_file "$agent" "$AGENTS_DIR/$(basename "$agent")"
done

echo ""
echo "Skills ($SKILLS_DIR):"
for skill_dir in "$TEMPLATES_DIR/skills/"*/; do
  [[ -d "$skill_dir" ]] || continue
  skill_name="$(basename "$skill_dir")"
  src="$skill_dir/SKILL.md"
  [[ -f "$src" ]] || continue
  copy_file "$src" "$SKILLS_DIR/$skill_name/SKILL.md"
done

echo ""
echo "Bootstrap complete."
echo "Commit $ROOT/agents/ and $ROOT/skills/ to your repository to activate the agents and skills."
