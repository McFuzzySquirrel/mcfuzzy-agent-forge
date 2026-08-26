#!/usr/bin/env bash
# test-forge-launcher.sh
# Functional non-interactive tests for forge-launcher.
#
# The canonical implementation is the Node npm package at scripts/forge-launcher/.
# This script delegates to that package's test suite (node --test), preserving
# the historical invocation for CI / the testing guide. The old static bash/ps1
# content checks were retired with the shell implementations (see ADR-023).
#
# Usage:
#   ./scripts/test-forge-launcher.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG_DIR="$ROOT_DIR/scripts/forge-launcher"

# Ensure git identity is set (needed for the commit step in CI environments)
if [[ -z "$(git config --global user.email 2>/dev/null || true)" ]]; then
  git config --global user.email "forge-launcher-test@example.com"
fi
if [[ -z "$(git config --global user.name 2>/dev/null || true)" ]]; then
  git config --global user.name "Forge Launcher Test"
fi

echo ""
echo "=== forge-launcher npm package tests (scripts/forge-launcher/) ==="

if [[ ! -d "$PKG_DIR/node_modules" ]]; then
  echo "Installing package dependencies …"
  (cd "$PKG_DIR" && npm install >/dev/null)
fi

(cd "$PKG_DIR" && npm test)
