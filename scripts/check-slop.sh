#!/bin/bash
# check-slop.sh — Catches common agent-generated anti-patterns.
# Run: ./scripts/check-slop.sh
# Returns non-zero if violations found.

set -euo pipefail

ERRORS=0
APP_DIR="apps/desktop/src/renderer/src"

# Allowed files for direct .contours access
CONTOURS_ALLOW="packages/font/|engine/draft\.ts|engine/mock\.ts|engine/FontEngine\.ts|\.test\.|testing/|SelectionBounds\.ts|compositeHitTest\.ts|TextRunRenderContributor\.ts|ClipboardCommands\.ts|SetNodePositionsCommand\.ts|PointCommands\.ts|BezierCommands\.ts"

echo "=== Checking for anti-slop patterns ==="
echo ""

# 1. Raw .contours access outside allowed files
echo "--- Raw .contours access outside packages/font/ and engine/ ---"
HITS=$(grep -rn '\.contours\b' "$APP_DIR" --include='*.ts' | grep -v "$CONTOURS_ALLOW" | grep -v '// slop-ok' || true)
if [ -n "$HITS" ]; then
  echo "$HITS"
  echo ""
  echo "  FIX: Use Glyphs.findPoints / Glyphs.points from @shift/font"
  echo ""
  ERRORS=$((ERRORS + 1))
fi

# 2. Inline coordinate math (x: foo.x - bar.x pattern)
echo "--- Inline coordinate math (use Vec2 instead) ---"
HITS=$(grep -rn 'x:.*\.x\s*[-+*].*\.x\|y:.*\.y\s*[-+*].*\.y' "$APP_DIR" --include='*.ts' | grep -v '\.test\.\|// slop-ok' || true)
if [ -n "$HITS" ]; then
  echo "$HITS"
  echo ""
  echo "  FIX: Use Vec2.sub / Vec2.add / Vec2.scale from @shift/geo"
  echo ""
  ERRORS=$((ERRORS + 1))
fi

# 3. Function overloads with type resolution (typeof positionOrX === "number")
echo "--- Function overload resolution code ---"
HITS=$(grep -rn 'typeof.*OrX\|typeof.*positionOr\|typeof.*pointOr' "$APP_DIR" --include='*.ts' | grep -v '\.test\.\|// slop-ok' || true)
if [ -n "$HITS" ]; then
  echo "$HITS"
  echo ""
  echo "  FIX: Use a single Point2D parameter instead of (x, y) overloads"
  echo ""
  ERRORS=$((ERRORS + 1))
fi

# 4. Nested ternary with .map (condition ? x.map(...) : x pattern spanning 5+ lines)
echo "--- Nested ternary with .map chains ---"
HITS=$(grep -rn '? .*\.map(' "$APP_DIR" --include='*.ts' | grep -v '\.test\.\|// slop-ok' || true)
if [ -n "$HITS" ]; then
  echo "$HITS"
  echo ""
  echo "  REVIEW: Consider extracting into a named variable or helper function"
  echo ""
  # This is a warning, not an error — some cases are fine
fi

echo "=== Done ==="

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "Found $ERRORS anti-slop violation(s). See CLAUDE.md ## Anti-Slop Rules for guidance."
  exit 1
fi

echo "No violations found."
