#!/usr/bin/env bash
# Verification oracle for cleanup + backend changes.
#
#   1. Metro production bundle - resolves the ENTIRE module graph and hard-fails
#      on any unresolved import. Exit 0 == nothing broke. Byte delta shows the win.
#   2. TypeScript - own-code error count must not exceed the recorded baseline.
#
# Usage: bash scripts/verify-cleanup.sh [baseline-bundle-bytes]
# NOTE: do not run this concurrently with jest or another bundle - Metro needs
# several minutes and competing node processes make it look like a hang.
set -uo pipefail
cd "$(dirname "$0")/.."

TMP=".verify-tmp"
BUNDLE="$TMP/verify.android.bundle"
mkdir -p "$TMP"

BASE_BYTES="${1:-8746133}"
BASELINE_TSC=17

echo "=== [1/2] Metro production bundle ==="
rm -f "$BUNDLE"
npx react-native bundle \
  --platform android --dev false \
  --entry-file index.js \
  --bundle-output "$BUNDLE" \
  --assets-dest "$TMP/assets" >"$TMP/bundle.log" 2>&1
BUNDLE_EXIT=$?

if [ $BUNDLE_EXIT -ne 0 ] || [ ! -f "$BUNDLE" ]; then
  echo "FAIL: bundle did not build (exit $BUNDLE_EXIT). Broken import - DO NOT COMMIT."
  grep -Ei 'unable to resolve|could not find|error:' "$TMP/bundle.log" | head -20
  exit 1
fi

BYTES=$(stat -c %s "$BUNDLE" 2>/dev/null || echo 0)
[ -z "$BYTES" ] && BYTES=0
DELTA=$((BASE_BYTES - BYTES))
echo "OK  bundle=$BYTES bytes (baseline $BASE_BYTES, delta ${DELTA})"

echo
echo "=== [2/2] TypeScript (own code only) ==="
npx tsc --noEmit >"$TMP/tsc-raw.txt" 2>&1
grep -E '^(src|convex|App|__tests__)/' "$TMP/tsc-raw.txt" | sort >"$TMP/tsc.txt"
OWN=$(grep -c '' "$TMP/tsc.txt" 2>/dev/null | head -1)
[ -z "$OWN" ] && OWN=0
OWN=$(echo "$OWN" | tr -d '\r\n ' )

if [ "$OWN" -gt "$BASELINE_TSC" ]; then
  echo "FAIL: own-code TS errors rose from $BASELINE_TSC to $OWN."
  echo "New errors:"
  grep -F -x -f "$TMP/tsc.txt" /dev/null >/dev/null 2>&1
  grep -E '^(src|convex|App|__tests__)/' "$TMP/tsc.txt" | head -20
  exit 1
fi
echo "OK  own-code TS errors: $OWN (baseline $BASELINE_TSC, lower is better)"
echo
echo "ALL CHECKS PASSED"