#!/bin/bash
# check-napi-dead-methods.sh — finds Rust NAPI methods with no TypeScript caller.
#
# Compares #[napi] methods in font_engine.rs against actual usage in FontEngine.ts.
# Run: ./scripts/check-napi-dead-methods.sh

set -euo pipefail

RUST_FILE="crates/shift-node/src/font_engine.rs"
TS_FILE="apps/desktop/src/renderer/src/engine/FontEngine.ts"
NATIVE_TESTS="crates/shift-node/__test__"

# Extract Rust pub fn names (napi methods), convert snake_case to camelCase via python
rust_methods=$(grep -E '^\s+pub fn ' "$RUST_FILE" | sed 's/.*pub fn //' | sed 's/(.*//' | grep -v '^new$')

dead=()

for method in $rust_methods; do
  camel=$(python3 -c "
s = '$method'
parts = s.split('_')
print(parts[0] + ''.join(p.capitalize() for p in parts[1:]))
")

  if ! grep -rq "\.${camel}\b" "$TS_FILE" "$NATIVE_TESTS" 2>/dev/null; then
    dead+=("$method → $camel")
  fi
done

if [ ${#dead[@]} -eq 0 ]; then
  echo "All Rust NAPI methods have TypeScript callers."
  exit 0
fi

echo "Dead Rust NAPI methods (no TypeScript caller in FontEngine.ts):"
for m in "${dead[@]}"; do
  echo "  - $m"
done
echo ""
echo "Either delete from $RUST_FILE or add callers in $TS_FILE."
exit 1
