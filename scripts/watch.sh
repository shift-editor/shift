#!/bin/bash
set -euo pipefail

pnpm run build:native:debug
pnpm --filter @shift/desktop dev &
DESKTOP_PID=$!

cleanup() {
  if kill -0 "$DESKTOP_PID" 2>/dev/null; then
    kill "$DESKTOP_PID"
  fi
}

trap cleanup EXIT INT TERM

cargo watch \
  -w "crates/shift-edit/src/" \
  -w "crates/shift-bridge/src/" \
  -w "crates/shift-edit/Cargo.toml" \
  -w "crates/shift-bridge/Cargo.toml" \
  -w "Cargo.toml" \
  -s "pnpm run build:native:debug && touch apps/desktop/src/main/main.ts"
