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
  if grep -q -- "$pattern" "$file" 2>/dev/null; then
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

# The launcher must queue forge-auto-build when a PRD exists and
# forge-auto-build-prd when it does not (CR-001 lifecycle).
assert_contains "$LAUNCHER" 'forge-auto-build-prd' \
  'forge-launcher.sh queues forge-auto-build-prd when no PRD is captured'
assert_contains "$LAUNCHER" '/forge-auto-build Use docs/PRD.md as the project PRD' \
  'forge-launcher.sh queues forge-auto-build against an existing PRD'

# Headless (terminal-driven) mode must be wired up with the right CLI invocations.
assert_contains "$LAUNCHER" -- '--headless' \
  'forge-launcher.sh accepts --headless/--run'
assert_contains "$LAUNCHER" 'HEADLESS=true' \
  'forge-launcher.sh enables headless mode'
assert_contains "$LAUNCHER" 'headless_build_command' \
  'forge-launcher.sh has a headless_build_command helper'
assert_contains "$LAUNCHER" 'opencode run --auto' \
  'forge-launcher.sh headless mode uses opencode run --auto'
assert_contains "$LAUNCHER" 'copilot -p' \
  'forge-launcher.sh headless mode uses copilot -p --yolo'

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
  assert_contains "/tmp/forge-launcher-test-agents.txt" "forge-auto-build-prd Use docs/IDEA.md as the project idea" \
    "agents harness: queues forge-auto-build-prd when no PRD is captured"
  assert_contains "/tmp/forge-launcher-test-agents.txt" "will be built from docs/IDEA.md by forge-auto-build-prd" \
    "agents harness: summary notes PRD will be built by forge-auto-build-prd"
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

# --- generic agents harness with an existing PRD captured in Step 6 ---
echo ""
echo "--- generic agents harness with PRD ---"

REPO_PARENT="$(mktemp -d)"
REPO_NAME="test-agents-prd-$$"
PRD_FILE="$REPO_PARENT/seed-prd.md"
printf '# PRD\n\n## Functional Requirements\n\n- FR-01 Foo\n- FR-02 Bar\n\n## Implementation Phases\n\n1. Foundation\n' > "$PRD_FILE"

export FORGE_IDEA="Test project for generic agents harness with PRD"
export FORGE_YN_DEFAULT="n"
export FORGE_HARNESS_CHOICE="4"
export FORGE_REPO_NAME="$REPO_NAME"
export FORGE_REPO_DESCRIPTION=""
export FORGE_REPO_VISIBILITY="private"
export FORGE_REPO_PARENT_DIR="$REPO_PARENT"
export FORGE_PRD_FILE="$PRD_FILE"

EXIT_CODE=0
bash "$LAUNCHER" --non-interactive \
  >/tmp/forge-launcher-test-agents-prd.txt 2>&1 || EXIT_CODE=$?
unset FORGE_HARNESS_CHOICE FORGE_REPO_NAME FORGE_REPO_DESCRIPTION FORGE_REPO_VISIBILITY FORGE_REPO_PARENT_DIR FORGE_PRD_FILE

if [[ $EXIT_CODE -ne 0 ]]; then
  fail "agents harness (with PRD): launcher exited with code $EXIT_CODE"
  cat /tmp/forge-launcher-test-agents-prd.txt >&2 || true
else
  REPO_DIR="$REPO_PARENT/$REPO_NAME"
  pass "agents harness (with PRD): launcher completed successfully"
  assert_file "$REPO_DIR/docs/PRD.md"       "agents harness (with PRD): docs/PRD.md copied"
  assert_contains "/tmp/forge-launcher-test-agents-prd.txt" "/forge-auto-build Use docs/PRD.md as the project PRD" \
    "agents harness (with PRD): queues forge-auto-build against the captured PRD"
  assert_contains "/tmp/forge-launcher-test-agents-prd.txt" "ready for forge-auto-build" \
    "agents harness (with PRD): Step 8 announces forge-auto-build"
  if grep -q "forge-auto-build-prd Use docs/IDEA.md as the project idea" /tmp/forge-launcher-test-agents-prd.txt; then
    fail "agents harness (with PRD): must not queue forge-auto-build-prd when a PRD exists"
  else
    pass "agents harness (with PRD): does not queue forge-auto-build-prd when a PRD exists"
  fi
fi

rm -rf "$REPO_PARENT" 2>/dev/null || true

# --- headless dry-run with PRD + workflow-engine ---
echo ""
echo "--- headless dry-run (PRD + workflow-engine, opencode runner) ---"

REPO_PARENT="$(mktemp -d)"
REPO_NAME="test-headless-prd-$$"
PRD_FILE="$REPO_PARENT/seed-prd.md"
printf '# PRD\n\n## Functional Requirements\n\n- FR-01 Foo\n\n## Implementation Phases\n\n1. Foundation\n' > "$PRD_FILE"

export FORGE_IDEA="Headless test project"
export FORGE_YN_DEFAULT="n"
export FORGE_HARNESS_CHOICE="4"
export FORGE_REPO_NAME="$REPO_NAME"
export FORGE_REPO_DESCRIPTION=""
export FORGE_REPO_VISIBILITY="private"
export FORGE_REPO_PARENT_DIR="$REPO_PARENT"
export FORGE_PRD_FILE="$PRD_FILE"
export FORGE_WORKFLOW_ENGINE="1"

EXIT_CODE=0
bash "$LAUNCHER" --non-interactive --headless --dry-run \
  >/tmp/forge-launcher-test-headless.txt 2>&1 || EXIT_CODE=$?
unset FORGE_HARNESS_CHOICE FORGE_REPO_NAME FORGE_REPO_DESCRIPTION FORGE_REPO_VISIBILITY FORGE_REPO_PARENT_DIR FORGE_PRD_FILE FORGE_WORKFLOW_ENGINE

if [[ $EXIT_CODE -ne 0 ]]; then
  fail "headless (PRD): launcher exited with code $EXIT_CODE"
  cat /tmp/forge-launcher-test-headless.txt >&2 || true
else
  pass "headless (PRD): launcher completed successfully"
  assert_contains "/tmp/forge-launcher-test-headless.txt" 'opencode run --auto' \
    "headless (PRD): uses opencode run --auto"
  assert_contains "/tmp/forge-launcher-test-headless.txt" '/forge-auto-build Use docs/PRD.md as the project PRD. GO --workflow-engine' \
    "headless (PRD): embeds GO --workflow-engine for the engine path"
  assert_contains "/tmp/forge-launcher-test-headless.txt" "Dry-run: command printed, not executed" \
    "headless (PRD): --dry-run prints without executing"
  assert_contains "/tmp/forge-launcher-test-headless.txt" "Mode        : headless" \
    "headless (PRD): summary notes headless mode"
fi

rm -rf "$REPO_PARENT" 2>/dev/null || true

# --- headless dry-run without PRD (queues forge-auto-build-prd, copilot runner) ---
echo ""
echo "--- headless dry-run (no PRD, copilot runner) ---"

REPO_PARENT="$(mktemp -d)"
REPO_NAME="test-headless-noprd-$$"
export FORGE_IDEA="Headless no-PRD test project"
export FORGE_YN_DEFAULT="n"
export FORGE_HARNESS_CHOICE="4"
export FORGE_REPO_NAME="$REPO_NAME"
export FORGE_REPO_DESCRIPTION=""
export FORGE_REPO_VISIBILITY="private"
export FORGE_REPO_PARENT_DIR="$REPO_PARENT"
export FORGE_RUN_WITH="copilot"

EXIT_CODE=0
bash "$LAUNCHER" --non-interactive --headless --dry-run \
  >/tmp/forge-launcher-test-headless-noprd.txt 2>&1 || EXIT_CODE=$?
unset FORGE_HARNESS_CHOICE FORGE_REPO_NAME FORGE_REPO_DESCRIPTION FORGE_REPO_VISIBILITY FORGE_REPO_PARENT_DIR FORGE_RUN_WITH

if [[ $EXIT_CODE -ne 0 ]]; then
  fail "headless (no PRD): launcher exited with code $EXIT_CODE"
  cat /tmp/forge-launcher-test-headless-noprd.txt >&2 || true
else
  pass "headless (no PRD): launcher completed successfully"
  assert_contains "/tmp/forge-launcher-test-headless-noprd.txt" 'copilot -p' \
    "headless (no PRD): uses copilot -p --yolo"
  assert_contains "/tmp/forge-launcher-test-headless-noprd.txt" 'forge-auto-build-prd Use docs/IDEA.md as the project idea' \
    "headless (no PRD): queues forge-auto-build-prd"
  assert_contains "/tmp/forge-launcher-test-headless-noprd.txt" 'Headless mode: auto-proceed' \
    "headless (no PRD): embeds the headless auto-proceed instruction"
  assert_contains "/tmp/forge-launcher-test-headless-noprd.txt" '--yolo' \
    "headless (no PRD): copilot runner uses --yolo"
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
