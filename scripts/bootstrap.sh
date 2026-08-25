#!/usr/bin/env bash
# bootstrap.sh -Deploy mcfuzzy-agent-forge templates into a target repository.
#
# Usage:
#   ./scripts/bootstrap.sh [TARGET_DIR] [--harness HARNESS] [--force]
#
# Arguments:
#   TARGET_DIR   Path to the target repository root (default: prompted)
#   --harness    Target harness: agents (default), github, claude
#   --force      Overwrite existing files without prompting
#
# What it does:
#   Copies templates/agents/*.md       → TARGET_DIR/<root>/agents/*.md
#   Copies templates/skills/<skill>/*   → TARGET_DIR/<root>/skills/<skill>/** (recursively)
#   Copies docs/prompt-playbook.md     → TARGET_DIR/docs/prompt-playbook.md
#   Adapts internal path references when a non-default harness is selected.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES_DIR="$(cd "$SCRIPT_DIR/../templates" && pwd)"
DOCS_DIR="$(cd "$SCRIPT_DIR/../docs" && pwd)"
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
  agents)   ROOT=".agents" ;;
  github)   ROOT=".github" ;;
  claude)   ROOT=".claude" ;;
  opencode) ROOT=".opencode" ;;
  *)      echo "Error: Unknown harness '$HARNESS'. Valid: agents, github, claude, opencode" >&2; exit 1 ;;
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
# Helpers
# ---------------------------------------------------------------------------

# Ensure the target repo's .gitignore excludes engine dependencies (node_modules
# installed at engine-prep time) and the detached engine log.
ensure_gitignore() {
  local gi="$TARGET_DIR/.gitignore"
  local -a entries=("node_modules/" "docs/engine-run.log")
  local added=false

  if [[ -f "$gi" ]] && [[ -s "$gi" ]] && [[ "$(tail -c1 "$gi")" != "" ]]; then
    printf "\n" >> "$gi"
  fi
  for e in "${entries[@]}"; do
    if ! grep -qF "$e" "$gi" 2>/dev/null; then
      printf "%s\n" "$e" >> "$gi"
      added=true
    fi
  done
  if [[ "$added" == true ]]; then
    echo "  Updated:  $gi (node_modules/, docs/engine-run.log)"
  else
    echo "  OK:       $gi already ignores node_modules/ and engine-run.log"
  fi
}

# Prompt before overwrite unless --force is set
confirm_overwrite() {
  local path="$1"
  if [[ -e "$path" ]] && [[ "$FORCE" != true ]]; then
    read -rp "  Overwrite existing $(basename "$path")? [y/N]: " answer
    [[ "${answer,,}" == "y" ]] || return 1
  fi
  return 0
}

# Copy a single file, respecting --force
copy_file() {
  local src="$1"
  local dest="$2"
  confirm_overwrite "$dest" || return
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  echo "  Copied:  $dest"
}

# Copy an entire directory tree, respecting --force
copy_skill_dir() {
  local src_dir="$1"
  local dest_dir="$2"
  local name="$3"

  if [[ -d "$dest_dir" ]] && [[ "$FORCE" != true ]]; then
    read -rp "  Overwrite existing skill directory '$name'? [y/N]: " answer
    if [[ "${answer,,}" != "y" ]]; then
      echo "  Skipped: $name/"
      return
    fi
  fi

  # Remove existing so the copy doesn't merge
  [[ -d "$dest_dir" ]] && rm -rf "$dest_dir"
  mkdir -p "$dest_dir"

  # Copy the skill tree, excluding build/dependency artifacts (installed on
  # demand at engine-prep time via `npm install`), so bootstrapped repos never
  # receive node_modules/ or dist/.
  ( cd "$src_dir" && tar --exclude='node_modules' --exclude='dist' -cf - . ) \
    | ( cd "$dest_dir" && tar -xf - )

  # Apply harness path rewrite to all .md files in the copied skill
  if [[ "$HARNESS" != "agents" ]]; then
    find "$dest_dir" -name '*.md' -exec sed -i "s|\.agents/|${ROOT}/|g" {} +
  fi

  echo "  Copied:  $name/"
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
DOCS_TARGET="$TARGET_DIR/docs"

# --- Agents ---
echo "Agents ($AGENTS_DIR):"
for agent in "$TEMPLATES_DIR/agents/"*.md; do
  [[ -f "$agent" ]] || continue
  dest="$AGENTS_DIR/$(basename "$agent")"
  copy_file "$agent" "$dest"
done

# --- Skills (full directory) ---
echo ""
echo "Skills ($SKILLS_DIR):"
for skill_dir in "$TEMPLATES_DIR/skills/"*/; do
  [[ -d "$skill_dir" ]] || continue
  skill_name="$(basename "$skill_dir")"
  copy_skill_dir "$skill_dir" "$SKILLS_DIR/$skill_name" "$skill_name"
done

# --- Prompt playbook ---
echo ""
echo "Docs ($DOCS_TARGET):"
if [[ -f "$DOCS_DIR/prompt-playbook.md" ]]; then
  copy_file "$DOCS_DIR/prompt-playbook.md" "$DOCS_TARGET/prompt-playbook.md"
fi

# --- Apply harness path rewrite to copied agent files ---
if [[ "$HARNESS" != "agents" ]]; then
  find "$AGENTS_DIR" -name '*.md' -exec sed -i "s|\.agents/|${ROOT}/|g" {} +
fi

# --- Gitignore hygiene (engine node_modules + detached run log) ---
echo ""
echo "Gitignore ($TARGET_DIR/.gitignore):"
ensure_gitignore

echo ""
echo "Bootstrap complete."
echo "Commit $ROOT/agents/ (.md), $ROOT/skills/, and docs/ to your repository."
