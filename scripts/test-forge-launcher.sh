#!/usr/bin/env bash
# test-forge-launcher.sh
# Functional non-interactive tests for forge-launcher.sh.
#
# Runs the launcher in --non-interactive mode for each harness, then asserts
# that the expected directory layout is created in a temporary repo directory.
#
# Usage:
#   ./scripts/test-forge-launcher.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHER="$ROOT_DIR/scripts/forge-launcher.sh"

pass_count=0
fail_count=0

# ---------------------------------------------------------------------------
# Ensure git identity is set (needed for the commit step in CI environments)
# ---------------------------------------------------------------------------
if [[ -z "$(git config --global user.email 2>/dev/null || true)" ]]; then
  git config --global user.email "forge-launcher-test@example.com"
fi
if [[ -z "$(git config --global user.name 2>/dev/null || true)" ]]; then
  git config --global user.name "Forge Launcher Test"
fi

pass() { echo "PASS: $1"; pass_count=$((pass_count + 1)); }
fail() { echo "FAIL: $1"; fail_count=$((fail_count + 1)); }

assert_dir()  { [[ -d "$1" ]] && pass "$2" || fail "$2 (missing dir: $1)"; }
assert_file() { [[ -f "$1" ]] && pass "$2" || fail "$2 (missing file: $1)"; }
assert_contains() {
  local file="$1" pattern="$2" label="$3"
  if grep -q "$pattern" "$file" 2>/dev/null; then
    pass "$label"
  else
    fail "$label (pattern '$pattern' not found in $file)"
  fi
}

# ---------------------------------------------------------------------------
# Test: static launcher exists and has required content
# ---------------------------------------------------------------------------
echo ""
echo "=== Static content checks ==="

assert_file "$LAUNCHER" "forge-launcher.sh exists"

# opencode harness should now map to --harness opencode, not --harness agents
assert_contains "$LAUNCHER" 'HARNESS="opencode"' \
  'forge-launcher.sh maps opencode choice to HARNESS=opencode'

assert_contains "$LAUNCHER" 'opencode)' \
  'forge-launcher.sh has a dedicated opencode case in launch_autobuild'

assert_contains "$LAUNCHER" '\.opencode' \
  'forge-launcher.sh references .opencode in completion summary'

# ---------------------------------------------------------------------------
# Test: non-interactive run for each harness
# ---------------------------------------------------------------------------
echo ""
echo "=== Non-interactive functional tests ==="

# --- opencode harness (choice 2) ---
echo ""
echo "--- opencode harness ---"

REPO_DIR=""
ROOT_LABEL=""

# In non-interactive mode `prompt` reads from the existing env var, but the
# step-2 harness selection reads from stdin (it uses `prompt choice`).
# We provide a heredoc-style stdin: line 1 = harness choice, remaining = step-3 values.

REPO_PARENT="$(mktemp -d)"
REPO_NAME="test-opencode-$$"
export FORGE_IDEA="Test project for opencode harness"
export FORGE_YN_DEFAULT="n"
export FORGE_HARNESS_CHOICE="2"
export FORGE_REPO_NAME="$REPO_NAME"
export FORGE_REPO_DESCRIPTION=""
export FORGE_REPO_VISIBILITY="private"
export FORGE_REPO_PARENT_DIR="$REPO_PARENT"

EXIT_CODE=0
bash "$LAUNCHER" --non-interactive \
  >/tmp/forge-launcher-test-opencode.txt 2>&1 || EXIT_CODE=$?
unset FORGE_HARNESS_CHOICE FORGE_REPO_NAME FORGE_REPO_DESCRIPTION FORGE_REPO_VISIBILITY FORGE_REPO_PARENT_DIR

if [[ $EXIT_CODE -ne 0 ]]; then
  fail "opencode harness: launcher exited with code $EXIT_CODE"
  cat /tmp/forge-launcher-test-opencode.txt >&2 || true
else
  REPO_DIR="$REPO_PARENT/$REPO_NAME"
  pass "opencode harness: launcher completed successfully"
  assert_dir  "$REPO_DIR"                             "opencode harness: repo directory created"
  assert_dir  "$REPO_DIR/.opencode"                   "opencode harness: .opencode root created"
  assert_dir  "$REPO_DIR/.opencode/agents"            "opencode harness: .opencode/agents created"
  assert_dir  "$REPO_DIR/.opencode/skills"            "opencode harness: .opencode/skills created"
  assert_file "$REPO_DIR/docs/IDEA.md"                "opencode harness: docs/IDEA.md created"
  assert_file "$REPO_DIR/IDEA.md"                     "opencode harness: IDEA.md (root copy) created"
  assert_contains "$REPO_DIR/docs/IDEA.md" "opencode" "opencode harness: IDEA.md contains idea text"
  # Verify agents were NOT placed in the old .agents directory
  if [[ -d "$REPO_DIR/.agents/agents" ]]; then
    fail "opencode harness: agents should not be in .agents/agents (wrong harness dir)"
  else
    pass "opencode harness: .agents/agents not present (correct)"
  fi
fi

rm -rf "$REPO_PARENT" 2>/dev/null || true

# --- generic agents harness (choice 4) ---
echo ""
echo "--- generic agents harness ---"

REPO_PARENT="$(mktemp -d)"
REPO_NAME="test-agents-$$"
export FORGE_IDEA="Test project for generic agents harness"
export FORGE_YN_DEFAULT="n"
export FORGE_HARNESS_CHOICE="4"
export FORGE_REPO_NAME="$REPO_NAME"
export FORGE_REPO_DESCRIPTION=""
export FORGE_REPO_VISIBILITY="private"
export FORGE_REPO_PARENT_DIR="$REPO_PARENT"

EXIT_CODE=0
bash "$LAUNCHER" --non-interactive \
  >/tmp/forge-launcher-test-agents.txt 2>&1 || EXIT_CODE=$?
unset FORGE_HARNESS_CHOICE FORGE_REPO_NAME FORGE_REPO_DESCRIPTION FORGE_REPO_VISIBILITY FORGE_REPO_PARENT_DIR

if [[ $EXIT_CODE -ne 0 ]]; then
  fail "agents harness: launcher exited with code $EXIT_CODE"
  cat /tmp/forge-launcher-test-agents.txt >&2 || true
else
  REPO_DIR="$REPO_PARENT/$REPO_NAME"
  pass "agents harness: launcher completed successfully"
  assert_dir  "$REPO_DIR"                   "agents harness: repo directory created"
  assert_dir  "$REPO_DIR/.agents"           "agents harness: .agents root created"
  assert_dir  "$REPO_DIR/.agents/agents"    "agents harness: .agents/agents created"
  assert_dir  "$REPO_DIR/.agents/skills"    "agents harness: .agents/skills created"
  assert_file "$REPO_DIR/docs/IDEA.md"      "agents harness: docs/IDEA.md created"
  assert_file "$REPO_DIR/IDEA.md"           "agents harness: IDEA.md (root copy) created"
fi

rm -rf "$REPO_PARENT" 2>/dev/null || true

# --- claude harness (choice 3) ---
echo ""
echo "--- claude harness ---"

REPO_PARENT="$(mktemp -d)"
REPO_NAME="test-claude-$$"
export FORGE_IDEA="Test project for claude harness"
export FORGE_YN_DEFAULT="n"
export FORGE_HARNESS_CHOICE="3"
export FORGE_REPO_NAME="$REPO_NAME"
export FORGE_REPO_DESCRIPTION=""
export FORGE_REPO_VISIBILITY="private"
export FORGE_REPO_PARENT_DIR="$REPO_PARENT"

EXIT_CODE=0
bash "$LAUNCHER" --non-interactive \
  >/tmp/forge-launcher-test-claude.txt 2>&1 || EXIT_CODE=$?
unset FORGE_HARNESS_CHOICE FORGE_REPO_NAME FORGE_REPO_DESCRIPTION FORGE_REPO_VISIBILITY FORGE_REPO_PARENT_DIR

if [[ $EXIT_CODE -ne 0 ]]; then
  fail "claude harness: launcher exited with code $EXIT_CODE"
  cat /tmp/forge-launcher-test-claude.txt >&2 || true
else
  REPO_DIR="$REPO_PARENT/$REPO_NAME"
  pass "claude harness: launcher completed successfully"
  assert_dir  "$REPO_DIR"                  "claude harness: repo directory created"
  assert_dir  "$REPO_DIR/.claude"          "claude harness: .claude root created"
  assert_dir  "$REPO_DIR/.claude/agents"   "claude harness: .claude/agents created"
  assert_dir  "$REPO_DIR/.claude/skills"   "claude harness: .claude/skills created"
  assert_file "$REPO_DIR/docs/IDEA.md"     "claude harness: docs/IDEA.md created"
fi

rm -rf "$REPO_PARENT" 2>/dev/null || true

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "Summary: $pass_count passed, $fail_count failed"
if [[ $fail_count -gt 0 ]]; then
  exit 1
fi
