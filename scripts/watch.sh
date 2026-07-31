#!/bin/bash
set -euo pipefail

PROFILE="${1:-debug}"

case "$PROFILE" in
  debug)
    BUILD_SCRIPT="build:native:debug"
    ;;
  release)
    BUILD_SCRIPT="build:native"
    ;;
  *)
    echo "Usage: $0 [debug|release]" >&2
    exit 2
    ;;
esac

pnpm run "$BUILD_SCRIPT"
pnpm --filter @shift/desktop dev &
DESKTOP_PID=$!

cleanup() {
  if kill -0 "$DESKTOP_PID" 2>/dev/null; then
    kill "$DESKTOP_PID"
  fi
}

trap cleanup EXIT INT TERM

cargo watch --postpone -s "pnpm run $BUILD_SCRIPT && touch apps/desktop/src/main/main.ts"
