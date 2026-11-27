#!/usr/bin/env bash
# Thin wrapper: explorations/strokes dev hook → shift-cli stroke subcommands.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
exec nix develop --command cargo run -p shift-cli --quiet -- "$@"