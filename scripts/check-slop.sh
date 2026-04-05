#!/bin/bash
# check-slop.sh — Catches agent-generated anti-patterns that oxlint can't detect.
#
# Run: ./scripts/check-slop.sh [--fix]
# Returns non-zero if violations found.
#
# These checks supplement oxlint. When we upgrade to oxlint 1.x with JS plugin
# support, these should migrate to proper AST-based lint rules.
#
# Add "// slop-ok" on a line to suppress a specific match.

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

APP="apps/desktop/src/renderer/src"
# Files where direct .contours access is expected
CONTOURS_SKIP="engine/draft\.ts|engine/mock\.ts|engine/FontEngine\.ts|packages/font/|\.test\.|testing/"

check() {
  local label="$1"
  local pattern="$2"
  local skip="$3"
  local severity="$4"  # error or warn
  local fix="$5"

  local hits
  hits=$(grep -rn "$pattern" "$APP" --include='*.ts' \
    | grep -v "$skip" \
    | grep -v '// slop-ok' \
    || true)

  if [ -n "$hits" ]; then
    if [ "$severity" = "error" ]; then
      echo -e "${RED}ERROR: $label${NC}"
      ERRORS=$((ERRORS + 1))
    else
      echo -e "${YELLOW}WARN: $label${NC}"
      WARNINGS=$((WARNINGS + 1))
    fi
    echo "$hits" | head -10
    local total
    total=$(echo "$hits" | wc -l | tr -d ' ')
    if [ "$total" -gt 10 ]; then
      echo "  ... and $((total - 10)) more"
    fi
    echo -e "  FIX: $fix"
    echo ""
  fi
}

echo "=== Anti-slop checks ==="
echo ""

# 1. Raw .contours loops in app code (use Glyphs.findPoints etc)
check \
  "Raw .contours iteration in app code" \
  'for.*of.*\.contours\b' \
  "$CONTOURS_SKIP" \
  "error" \
  "Use Glyphs.findPoints / Glyphs.points from @shift/font"

# 2. Inline coordinate subtraction (use Vec2.sub)
check \
  "Inline coordinate math (use Vec2)" \
  '{ *x: .*\.x [-+] .*[,;].*y: .*\.y [-+]' \
  '\.test\.|testing/|// slop-ok' \
  "warn" \
  "Use Vec2.sub / Vec2.add / Vec2.scale from @shift/geo"

# 3. Overload resolution typeof checks
check \
  "Function overload resolution code" \
  'typeof.*Or[A-Z].*=== "number"' \
  '\.test\.|testing/' \
  "error" \
  "Use a single Point2D parameter instead of (x, y) overloads"

# 4. Direct .contours property access (not in a for loop — catches .contours.map etc)
check \
  "Direct .contours access in app code" \
  '\.contours\.\(map\|filter\|find\|reduce\|flatMap\|some\|every\)' \
  "$CONTOURS_SKIP|SelectionBounds\.ts|compositeHitTest\.ts|ClipboardCommands\.ts|SetNodePositionsCommand\.ts" \
  "warn" \
  "Consider using Glyphs.* utilities or extracting to packages/font/"

echo "=== Done ==="

if [ "$ERRORS" -gt 0 ]; then
  echo -e "${RED}$ERRORS error(s), $WARNINGS warning(s)${NC}"
  exit 1
fi

if [ "$WARNINGS" -gt 0 ]; then
  echo -e "${YELLOW}$WARNINGS warning(s) (non-blocking)${NC}"
fi

echo "Clean."
