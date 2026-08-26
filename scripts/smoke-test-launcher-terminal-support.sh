#!/usr/bin/env bash
# smoke-test-launcher-terminal-support.sh
# Smoke test that the forge-launcher npm package's terminal-launch support is
# wired up (cross-platform: copilot/opencode/claude in a separate terminal).
#
# The canonical implementation moved to the Node package at scripts/forge-launcher/
# (see ADR-023); the legacy shell-specific checks were retired.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR="$ROOT_DIR/scripts/forge-launcher"

pass_count=0
fail_count=0

pass() { echo "PASS: $1"; pass_count=$((pass_count + 1)); }
fail() { echo "FAIL: $1"; fail_count=$((fail_count + 1)); }

check_file() {
  local file="$1" label="$2"
  if [[ -f "$file" ]]; then pass "$label"; else fail "$label"; fi
}

check_contains() {
  local file="$1" pattern="$2" label="$3"
  if grep -q "$pattern" "$file"; then
    pass "$label"
  else
    fail "$label (pattern '$pattern' not found in $file)"
  fi
}

check_file "$PKG_DIR/scripts/terminal.ts" "terminal module exists"
check_file "$PKG_DIR/scripts/launcher.ts" "launcher module exists"

check_contains "$PKG_DIR/scripts/terminal.ts" "copilot\|opencode\|claude" "terminal launch supports harness CLIs"
check_contains "$PKG_DIR/scripts/terminal.ts" "gnome-terminal\|x-terminal-emulator\|konsole\|mate-terminal" "POSIX desktop terminal emulator support"
check_contains "$PKG_DIR/scripts/terminal.ts" "win32\|wt\|pwsh" "Windows terminal support"
check_contains "$PKG_DIR/scripts/launcher.ts" "launchCliInTerminal" "launcher calls the terminal-launch helper"
check_contains "$PKG_DIR/scripts/launcher.ts" '"opencode"' "launcher maps opencode harness"
check_contains "$PKG_DIR/scripts/launcher.ts" '\.opencode' "launcher references .opencode directory for opencode harness"

echo ""
echo "Summary: $pass_count passed, $fail_count failed"
if [[ $fail_count -gt 0 ]]; then
  exit 1
fi
