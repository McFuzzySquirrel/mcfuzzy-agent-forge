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

# Path prompts (parent dir, PRD, research/seed docs) must support Tab completion
# so users can autocomplete to existing locations (readline on bash,
# PSReadLine on PowerShell).
assert_contains "$LAUNCHER" 'prompt_path()' \
  'forge-launcher.sh defines a prompt_path helper for Tab-completed path input'
assert_contains "$LAUNCHER" 'read -e -r -p' \
  'forge-launcher.sh path prompts use read -e for readline Tab completion'
assert_contains "$LAUNCHER" 'prompt_path prd_src' \
  'forge-launcher.sh PRD path prompt uses prompt_path'
assert_contains "$LAUNCHER" 'prompt_path parent_dir' \
  'forge-launcher.sh parent directory prompt uses prompt_path'

assert_file "$ROOT_DIR/scripts/forge-launcher.ps1" "forge-launcher.ps1 exists"
assert_contains "$ROOT_DIR/scripts/forge-launcher.ps1" 'function Read-PromptTab' \
  'forge-launcher.ps1 defines a Read-PromptTab helper for Tab-completed path input'
assert_contains "$ROOT_DIR/scripts/forge-launcher.ps1" 'PSConsoleReadLine' \
  'forge-launcher.ps1 path prompts use PSReadLine for Tab completion'
assert_contains "$ROOT_DIR/scripts/forge-launcher.ps1" 'Read-PromptTab "Path to your PRD file"' \
  'forge-launcher.ps1 PRD path prompt uses Read-PromptTab'
assert_contains "$ROOT_DIR/scripts/forge-launcher.ps1" 'Read-PromptTab "Parent directory' \
  'forge-launcher.ps1 parent directory prompt uses Read-PromptTab'

# User-typed paths (~, $VAR) must be expanded so external PRD/seed locations
# are found instead of failing with "file not found".
assert_contains "$LAUNCHER" 'expand_path()' \
  'forge-launcher.sh defines expand_path for ~/$VAR path expansion'
assert_contains "$LAUNCHER" 'resolve_input_file()' \
  'forge-launcher.sh defines resolve_input_file for validating typed paths'
assert_contains "$LAUNCHER" 'resolve_input_file "$prd_src"' \
  'forge-launcher.sh PRD path prompt expands ~/$VAR before validating'
assert_contains "$LAUNCHER" 'resolve_input_file "$_f"' \
  'forge-launcher.sh research paths expand ~/$VAR before validating'
assert_contains "$ROOT_DIR/scripts/forge-launcher.ps1" 'function Expand-Path' \
  'forge-launcher.ps1 defines Expand-Path for ~/$VAR path expansion'
assert_contains "$ROOT_DIR/scripts/forge-launcher.ps1" 'function Resolve-InputFile' \
  'forge-launcher.ps1 defines Resolve-InputFile for validating typed paths'
assert_contains "$ROOT_DIR/scripts/forge-launcher.ps1" 'Resolve-InputFile $prdSrc' \
  'forge-launcher.ps1 PRD path prompt expands ~/$VAR before validating'
assert_contains "$ROOT_DIR/scripts/forge-launcher.ps1" 'Resolve-InputFile $resPath' \
  'forge-launcher.ps1 research paths expand ~/$VAR before validating'

# Optional auto-draft flow: generate the PRD and/or agent team non-interactively
# (review boundaries), then decide how to run the workflow engine.
assert_contains "$LAUNCHER" '--draft)' \
  'forge-launcher.sh accepts the --draft flag'
assert_contains "$LAUNCHER" 'FORGE_AUTO_DRAFT' \
  'forge-launcher.sh honours FORGE_AUTO_DRAFT in non-interactive mode'
assert_contains "$LAUNCHER" 'auto_draft_prd()' \
  'forge-launcher.sh defines auto_draft_prd (idea -> PRD)'
assert_contains "$LAUNCHER" 'auto_draft_team()' \
  'forge-launcher.sh defines auto_draft_team (PRD -> agent team)'
assert_contains "$LAUNCHER" 'engine_decision()' \
  'forge-launcher.sh defines engine_decision (run engine now/later)'
assert_contains "$LAUNCHER" 'run_skill_headless()' \
  'forge-launcher.sh defines a reusable run_skill_headless'
assert_contains "$LAUNCHER" 'forge-engine-run.sh' \
  'forge-launcher.sh references forge-engine-run.sh for the engine run'
assert_contains "$LAUNCHER" 'prd_source_for_team()' \
  'forge-launcher.sh prefers the decomposed vision+features for the team auto-draft'
assert_contains "$LAUNCHER" 'auto_draft_menu' \
  'forge-launcher.sh wires the auto-draft menu into Step 8'
assert_contains "$ROOT_DIR/scripts/forge-launcher.ps1" '\[switch]\$Draft' \
  'forge-launcher.ps1 accepts the -Draft switch'
assert_contains "$ROOT_DIR/scripts/forge-launcher.ps1" 'FORGE_AUTO_DRAFT' \
  'forge-launcher.ps1 honours FORGE_AUTO_DRAFT in non-interactive mode'
assert_contains "$ROOT_DIR/scripts/forge-launcher.ps1" 'function Invoke-AutoDraftPrd' \
  'forge-launcher.ps1 defines Invoke-AutoDraftPrd (idea -> PRD)'
assert_contains "$ROOT_DIR/scripts/forge-launcher.ps1" 'function Invoke-AutoDraftTeam' \
  'forge-launcher.ps1 defines Invoke-AutoDraftTeam (PRD -> agent team)'
assert_contains "$ROOT_DIR/scripts/forge-launcher.ps1" 'Invoke-EngineDecision' \
  'forge-launcher.ps1 defines Invoke-EngineDecision (run engine now/later)'
assert_contains "$ROOT_DIR/scripts/forge-launcher.ps1" 'function Invoke-SkillHeadless' \
  'forge-launcher.ps1 defines a reusable Invoke-SkillHeadless'
assert_contains "$ROOT_DIR/scripts/forge-launcher.ps1" 'forge-engine-run.ps1' \
  'forge-launcher.ps1 references forge-engine-run.ps1 for the engine run'
assert_contains "$ROOT_DIR/scripts/forge-launcher.ps1" 'Get-AutoDraftPrdSource' \
  'forge-launcher.ps1 prefers the decomposed vision+features for the team auto-draft'
assert_contains "$ROOT_DIR/scripts/forge-launcher.ps1" 'Invoke-AutoDraftMenu' \
  'forge-launcher.ps1 wires the auto-draft menu into Step 8'

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

# --- generic agents harness with ~/$VAR-expanded PRD and research paths ---
echo ""
echo "--- generic agents harness with tilde/\$VAR PRD and research paths ---"

REPO_PARENT="$(mktemp -d)"
REPO_NAME="test-tilde-paths-$$"
TILDE_PRD="$HOME/forge-tilde-prd-$$.md"
TILDE_RESEARCH="$HOME/forge-tilde-research-$$.md"
printf '# PRD\n\n## Functional Requirements\n\n- FR-01 Tilde\n\n## Implementation Phases\n\n1. Foundation\n' > "$TILDE_PRD"
printf '# Research\n\n- external seed doc\n' > "$TILDE_RESEARCH"

export FORGE_IDEA="Test project for tilde and var path expansion"
export FORGE_YN_DEFAULT="n"
export FORGE_HARNESS_CHOICE="4"
export FORGE_REPO_NAME="$REPO_NAME"
export FORGE_REPO_DESCRIPTION=""
export FORGE_REPO_VISIBILITY="private"
export FORGE_REPO_PARENT_DIR="$REPO_PARENT"
export FORGE_PRD_FILE="~/forge-tilde-prd-$$.md"
export FORGE_RESEARCH_FILES="\$HOME/forge-tilde-research-$$.md"

EXIT_CODE=0
bash "$LAUNCHER" --non-interactive \
  >/tmp/forge-launcher-test-tilde.txt 2>&1 || EXIT_CODE=$?
unset FORGE_HARNESS_CHOICE FORGE_REPO_NAME FORGE_REPO_DESCRIPTION FORGE_REPO_VISIBILITY FORGE_REPO_PARENT_DIR FORGE_PRD_FILE FORGE_RESEARCH_FILES
rm -f "$TILDE_PRD" "$TILDE_RESEARCH"

if [[ $EXIT_CODE -ne 0 ]]; then
  fail "tilde paths: launcher exited with code $EXIT_CODE"
  cat /tmp/forge-launcher-test-tilde.txt >&2 || true
else
  REPO_DIR="$REPO_PARENT/$REPO_NAME"
  pass "tilde paths: launcher completed successfully"
  assert_file "$REPO_DIR/docs/PRD.md" "tilde paths: docs/PRD.md copied from a ~/... path"
  assert_file "$REPO_DIR/docs/research/forge-tilde-research-$$.md" "tilde paths: research doc copied from a \$HOME/... path"
  if grep -q "FORGE_PRD_FILE is set but file not found" /tmp/forge-launcher-test-tilde.txt; then
    fail "tilde paths: ~/ PRD path must be expanded, not reported missing"
  else
    pass "tilde paths: ~/ PRD path was expanded (no file-not-found warning)"
  fi
  if grep -q "FORGE_RESEARCH_FILES: file not found" /tmp/forge-launcher-test-tilde.txt; then
    fail "tilde paths: \$HOME/ research path must be expanded, not reported missing"
  else
    pass "tilde paths: \$HOME/ research path was expanded (no file-not-found warning)"
  fi
fi

rm -rf "$REPO_PARENT" 2>/dev/null || true

# --- auto-draft PRD generation (idea -> PRD, no PRD yet, dry-run) ---
echo ""
echo "--- auto-draft PRD generation (no PRD, dry-run) ---"

REPO_PARENT="$(mktemp -d)"
REPO_NAME="test-autodraft-noprd-$$"

export FORGE_IDEA="Auto-draft test idea"
export FORGE_YN_DEFAULT="n"
export FORGE_HARNESS_CHOICE="4"
export FORGE_REPO_NAME="$REPO_NAME"
export FORGE_REPO_DESCRIPTION=""
export FORGE_REPO_VISIBILITY="private"
export FORGE_REPO_PARENT_DIR="$REPO_PARENT"
export FORGE_AUTO_DRAFT="1"

EXIT_CODE=0
bash "$LAUNCHER" --non-interactive --dry-run \
  >/tmp/forge-launcher-test-autodraft-noprd.txt 2>&1 || EXIT_CODE=$?
unset FORGE_HARNESS_CHOICE FORGE_REPO_NAME FORGE_REPO_DESCRIPTION FORGE_REPO_VISIBILITY FORGE_REPO_PARENT_DIR FORGE_AUTO_DRAFT

if [[ $EXIT_CODE -ne 0 ]]; then
  fail "auto-draft (no PRD): launcher exited with code $EXIT_CODE"
  cat /tmp/forge-launcher-test-autodraft-noprd.txt >&2 || true
else
  pass "auto-draft (no PRD): launcher completed successfully"
  assert_contains "/tmp/forge-launcher-test-autodraft-noprd.txt" 'Auto-drafting the PRD from docs/IDEA.md (headless)' \
    "auto-draft (no PRD): runs the PRD auto-draft stage"
  assert_contains "/tmp/forge-launcher-test-autodraft-noprd.txt" 'opencode run --auto "/forge-auto-build-prd Use docs/IDEA.md as the project idea. Headless mode: auto-proceed with default assumptions and approve the PRD."' \
    "auto-draft (no PRD): queues headless forge-auto-build-prd"
  if grep -q "Auto-drafting the agent team" /tmp/forge-launcher-test-autodraft-noprd.txt; then
    fail "auto-draft (no PRD): must not draft the team without a PRD"
  else
    pass "auto-draft (no PRD): skips team draft when no PRD exists"
  fi
fi

rm -rf "$REPO_PARENT" 2>/dev/null || true

# --- auto-draft team + engine (PRD exists, dry-run) ---
echo ""
echo "--- auto-draft team + engine (with PRD, dry-run) ---"

REPO_PARENT="$(mktemp -d)"
REPO_NAME="test-autodraft-prd-$$"
PRD_FILE="$REPO_PARENT/seed-prd.md"
printf '# PRD\n\n## Functional Requirements\n\n- FR-01 Foo\n\n## Implementation Phases\n\n1. Foundation\n' > "$PRD_FILE"

export FORGE_IDEA="Auto-draft test idea"
export FORGE_YN_DEFAULT="n"
export FORGE_HARNESS_CHOICE="4"
export FORGE_REPO_NAME="$REPO_NAME"
export FORGE_REPO_DESCRIPTION=""
export FORGE_REPO_VISIBILITY="private"
export FORGE_REPO_PARENT_DIR="$REPO_PARENT"
export FORGE_PRD_FILE="$PRD_FILE"
export FORGE_AUTO_DRAFT="1"
export FORGE_ENGINE_HARNESS="opencode"

EXIT_CODE=0
bash "$LAUNCHER" --non-interactive --dry-run \
  >/tmp/forge-launcher-test-autodraft-prd.txt 2>&1 || EXIT_CODE=$?
unset FORGE_HARNESS_CHOICE FORGE_REPO_NAME FORGE_REPO_DESCRIPTION FORGE_REPO_VISIBILITY FORGE_REPO_PARENT_DIR FORGE_PRD_FILE FORGE_AUTO_DRAFT FORGE_ENGINE_HARNESS

if [[ $EXIT_CODE -ne 0 ]]; then
  fail "auto-draft (with PRD): launcher exited with code $EXIT_CODE"
  cat /tmp/forge-launcher-test-autodraft-prd.txt >&2 || true
else
  pass "auto-draft (with PRD): launcher completed successfully"
  if grep -q "Auto-drafting the PRD" /tmp/forge-launcher-test-autodraft-prd.txt; then
    fail "auto-draft (with PRD): must not re-draft the PRD when one exists"
  else
    pass "auto-draft (with PRD): skips PRD draft when a PRD exists"
  fi
  assert_contains "/tmp/forge-launcher-test-autodraft-prd.txt" 'Auto-drafting the agent team from the PRD (headless)' \
    "auto-draft (with PRD): runs the team auto-draft stage"
  assert_contains "/tmp/forge-launcher-test-autodraft-prd.txt" 'opencode run --auto "/forge-build-agent-team Use docs/PRD.md to build the agent team' \
    "auto-draft (with PRD): queues headless forge-build-agent-team against the monolithic PRD"
  assert_contains "/tmp/forge-launcher-test-autodraft-prd.txt" 'forge-engine-run.sh --repo' \
    "auto-draft (with PRD): prints the workflow-engine run command"
fi

rm -rf "$REPO_PARENT" 2>/dev/null || true

# --- auto-draft team PRD-source selection (monolithic vs decomposed) ---
echo ""
echo "--- auto-draft team PRD-source selection ---"

PRD_SRC_FN="$(sed -n '/^prd_source_for_team() {/,/^}/p' "$LAUNCHER")"
REPO_PARENT="$(mktemp -d)"
mkdir -p "$REPO_PARENT/mono/docs" "$REPO_PARENT/decomp/docs/features"
printf '# PRD\n' > "$REPO_PARENT/mono/docs/PRD.md"
printf '# PRD\n' > "$REPO_PARENT/decomp/docs/PRD.md"
printf '# Vision\n' > "$REPO_PARENT/decomp/docs/product-vision.md"
printf '# Feature\n' > "$REPO_PARENT/decomp/docs/features/F-01.md"

MONO_SRC="$(REPO_DIR="$REPO_PARENT/mono" bash -c "$PRD_SRC_FN; prd_source_for_team")"
if [[ "$MONO_SRC" == "docs/PRD.md" ]]; then
  pass "team auto-draft uses docs/PRD.md when not decomposed"
else
  fail "team auto-draft monolithic source mismatch: '$MONO_SRC'"
fi

DECOMP_SRC="$(REPO_DIR="$REPO_PARENT/decomp" bash -c "$PRD_SRC_FN; prd_source_for_team")"
if [[ "$DECOMP_SRC" == *"decomposed PRD representation"* ]]; then
  pass "team auto-draft uses vision+features when decomposed layout exists"
else
  fail "team auto-draft decomposed source mismatch: '$DECOMP_SRC'"
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
# Test: detached engine execution (ADR-019)
# ---------------------------------------------------------------------------
echo ""
echo "=== Detached engine execution (ADR-019) ==="

ENGINE_RUN="$ROOT_DIR/scripts/forge-engine-run.sh"
AUTO_BUILD_SKILL="$ROOT_DIR/templates/skills/forge-auto-build/SKILL.md"
ENGINE_CLI="$ROOT_DIR/templates/skills/forge-workflow-engine/scripts/cli.ts"

assert_file "$ENGINE_RUN" "forge-engine-run.sh exists"

# forge-auto-build Path B must start the engine detached and poll, never block the session.
assert_contains "$AUTO_BUILD_SKILL" 'nohup npm run workflow-engine -- run --harness "\$FORGE_ENGINE_HARNESS"' \
  'forge-auto-build engine path starts the engine detached (nohup + --yes)'
assert_contains "$AUTO_BUILD_SKILL" '>> docs/engine-run.log 2>&1 &' \
  'forge-auto-build engine path logs to docs/engine-run.log and backgrounds the process'
assert_contains "$AUTO_BUILD_SKILL" 'FORGE_ENGINE_HARNESS' \
  'forge-auto-build engine path selects the per-task harness via FORGE_ENGINE_HARNESS'
assert_contains "$AUTO_BUILD_SKILL" '**Step 3c: Poll to completion**' \
  'forge-auto-build engine path polls WORKFLOW-STATE.json to completion'

# The engine CLI registers the GitHub Copilot harness.
assert_contains "$ENGINE_CLI" 'case "copilot": return new CopilotAdapter();' \
  'workflow-engine CLI registers the copilot harness'
assert_file "$ROOT_DIR/templates/skills/forge-workflow-engine/scripts/harness/copilot-adapter.ts" \
  'copilot-adapter.ts exists'

# Bootstrap ensures the target repo's .gitignore excludes engine deps + log.
assert_contains "$ROOT_DIR/scripts/bootstrap.sh" 'node_modules/' \
  'bootstrap.sh ensures .gitignore ignores node_modules/'
assert_contains "$ROOT_DIR/scripts/bootstrap.sh" 'docs/engine-run.log' \
  'bootstrap.sh ensures .gitignore ignores the engine run log'

# Functional: forge-engine-run.sh dry-run prints the full prepare+run sequence.
REPO_PARENT="$(mktemp -d)"
REPO_NAME="test-engine-run-$$"
git -C "$REPO_PARENT" init -q "$REPO_NAME"
ENGINE_REPO="$REPO_PARENT/$REPO_NAME"
mkdir -p "$ENGINE_REPO/docs" "$ENGINE_REPO/.agents/skills/forge-workflow-engine"
printf '{\n  "version": "1.0",\n  "generatedAt": "2026-08-24T00:00:00Z",\n  "repoRoot": "%s",\n  "harnessRoot": ".agents",\n  "prdPath": "docs/PRD.md",\n  "progressPath": "docs/PROGRESS.md",\n  "auditPath": "docs/EXECUTION-AUDIT.jsonl",\n  "validationCommands": [],\n  "approvalGates": { "preflight": true, "betweenPhases": false },\n  "phases": [],\n  "warnings": []\n}\n' "$ENGINE_REPO" > "$ENGINE_REPO/docs/EXECUTION-MANIFEST.json"

EXIT_CODE=0
bash "$ENGINE_RUN" --repo "$ENGINE_REPO" --harness opencode --yes --dry-run \
  >/tmp/forge-engine-run-test.txt 2>&1 || EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  fail "forge-engine-run: dry-run exited with code $EXIT_CODE"
  cat /tmp/forge-engine-run-test.txt >&2 || true
else
  pass "forge-engine-run: dry-run completed successfully"
  assert_contains /tmp/forge-engine-run-test.txt 'forge-engine-run: repo=' \
    'forge-engine-run: resolves the repo root'
  assert_contains /tmp/forge-engine-run-test.txt 'npm run workflow-engine -- run --harness opencode --yes' \
    'forge-engine-run: dry-run prints the engine run command'
  assert_contains /tmp/forge-engine-run-test.txt '\[dry-run\]' \
    'forge-engine-run: dry-run prints commands without executing'
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
