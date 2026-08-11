#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASH_LAUNCHER="$ROOT_DIR/scripts/forge-launcher.sh"
PS1_LAUNCHER="$ROOT_DIR/scripts/forge-launcher.ps1"

pass_count=0
fail_count=0

pass() { echo "PASS: $1"; pass_count=$((pass_count + 1)); }
fail() { echo "FAIL: $1"; fail_count=$((fail_count + 1)); }

check_contains() {
  local file="$1"
  local pattern="$2"
  local description="$3"
  if grep -q "$pattern" "$file"; then
    pass "$description"
  else
    fail "$description"
  fi
}

if [[ -f "$BASH_LAUNCHER" ]]; then
  pass "Bash launcher exists"
else
  fail "Bash launcher exists"
fi

if [[ -f "$PS1_LAUNCHER" ]]; then
  pass "PowerShell launcher exists"
else
  fail "PowerShell launcher exists"
fi

check_contains "$BASH_LAUNCHER" "copilot" "Bash launcher checks for Copilot CLI"
check_contains "$BASH_LAUNCHER" "launch_cli_in_terminal" "Bash launcher has a dedicated terminal-launch helper"
check_contains "$BASH_LAUNCHER" "gnome-terminal\|x-terminal-emulator\|konsole" "Bash launcher can use a desktop terminal emulator"
check_contains "$BASH_LAUNCHER" 'HARNESS="opencode"' "Bash launcher maps opencode choice to harness=opencode"
check_contains "$BASH_LAUNCHER" '\.opencode' "Bash launcher references .opencode directory for opencode harness"
check_contains "$PS1_LAUNCHER" "copilot" "PowerShell launcher checks for Copilot CLI"
check_contains "$PS1_LAUNCHER" "Start-Process" "PowerShell launcher can start a new terminal process"
check_contains "$PS1_LAUNCHER" '"opencode"' "PowerShell launcher maps opencode choice to Harness=opencode"
check_contains "$PS1_LAUNCHER" '\.opencode' "PowerShell launcher references .opencode directory for opencode harness"

echo ""
echo "Summary: $pass_count passed, $fail_count failed"
if [[ $fail_count -gt 0 ]]; then
  exit 1
fi
