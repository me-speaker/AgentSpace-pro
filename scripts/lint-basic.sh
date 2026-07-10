#!/usr/bin/env bash
# FSM P2-3 — basic lint for the test repo.
#
# Zero-dep lint that catches the highest-ROI issues without pulling in
# ESLint (which would break the test repo's manual @agent-space/* symlinks
# per MEMORY #30). Runs in <1s on the test repo.
#
# Rules:
#   R1. `console.log(` in production code (console.error / console.warn OK).
#       Whitelist: handle-notify-channel.ts (delivers messages via stdout
#       by design).
#   R2. `.only(` in any *.test.ts (skips other tests silently — easy to
#       leave behind after a focused fix).
#   R3. tab characters in any *.ts file (project uses 2-space indent;
#       tabs sneak in from copy-paste).
#   R4. oversized files (>500 lines) — informational only, not an error.
#
# Exit: 0 if clean, 1 if any rule violation, 2 if script error.
#
# Run with:  npm run lint:basic

set -euo pipefail

# Resolve repo root regardless of where this script is invoked from.
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

errors=0

# ── R1 ────────────────────────────────────────────────────────────────
echo "R1: console.log( in production code..."
#   - .ts files only
#   - skip .test.ts (console.log is fine in tests for diagnostics)
#   - whitelist handle-notify-channel.ts (the notify handler delivers
#     via stdout by design)
r1=$(grep -rn "console\.log(" \
  --include="*.ts" \
  packages/ apps/ 2>/dev/null \
  | grep -v "\.test\.ts" \
  | grep -v "handle-notify-channel\.ts" \
  || true)
if [ -n "$r1" ]; then
  echo "  FAIL  console.log( found in production code:"
  echo "$r1" | sed 's/^/         /'
  errors=$((errors + 1))
fi

# ── R2 ────────────────────────────────────────────────────────────────
echo "R2: .only( in test files..."
#   - .only( is how node:test marks it-only descriptors (skips other tests).
r2=$(grep -rPn "\.only\(" \
  --include="*.test.ts" \
  packages/ apps/ 2>/dev/null || true)
if [ -n "$r2" ]; then
  echo "  FAIL  .only( found in test files:"
  echo "$r2" | sed 's/^/         /'
  errors=$((errors + 1))
fi

# ── R3 ────────────────────────────────────────────────────────────────
echo "R3: tab characters in .ts files..."
r3=$(grep -rlP "\t" \
  --include="*.ts" \
  packages/ apps/ 2>/dev/null || true)
if [ -n "$r3" ]; then
  echo "  FAIL  tab characters in .ts files:"
  echo "$r3" | sed 's/^/         /'
  errors=$((errors + 1))
fi

# ── R4 ────────────────────────────────────────────────────────────────
echo "R4: oversized files (>500 lines, informational only)..."
#   - Large FSM runtime files are by design (state machine shape).
#   - This rule does NOT count toward `errors`; it just lists them.
large_files=$(find packages/ apps/ \
  -name "*.ts" -not -name "*.test.ts" -not -path "*/node_modules/*" \
  -type f -exec awk 'END { if (NR > 500) print FILENAME, NR }' {} \; 2>/dev/null || true)
if [ -n "$large_files" ]; then
  echo "  info  large files (not counted as errors):"
  echo "$large_files" | sed 's/^/         /'
fi

# ── Summary ──────────────────────────────────────────────────────────
echo ""
if [ "$errors" -eq 0 ]; then
  echo "lint:basic OK (4 rules, 0 errors)"
  exit 0
else
  echo "lint:basic FAIL (${errors} rule group(s) violated)"
  exit 1
fi
