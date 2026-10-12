#!/usr/bin/env bash
# Builds the Linux native bridge and shift-cli against napi-rs's glibc 2.17
# cross toolchain instead of the runner's glibc. Linking against the runner
# (Ubuntu 24.04, glibc 2.39) let Rust and C code pick newer symbol versions,
# which kept Shift off RHEL 9 and older distributions. Rust and C code must
# both use the toolchain: C compiled against newer glibc headers references
# symbols such as fcntl64 that a 2.17 link leaves unresolved until load time.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRIPLE="$(uname -m)-unknown-linux-gnu"
TRIPLE_UNDERSCORED="${TRIPLE//-/_}"
TRIPLE_UPPER="${TRIPLE_UNDERSCORED^^}"
GLIBC_FLOOR="2.17"
BRIDGE="$ROOT/crates/shift-bridge/shift-bridge.linux-$(node -p process.arch)-gnu.node"
CLI="$ROOT/target/release/shift-cli"

TOOLCHAIN_ROOT="$(
  cd "$ROOT/crates/shift-bridge" && TRIPLE="$TRIPLE" node -e '
    const { homedir } = require("node:os");
    const { existsSync, mkdirSync } = require("node:fs");
    const { join } = require("node:path");
    const { version, download } = require("@napi-rs/cross-toolchain");
    // Same location and layout `napi build --use-napi-cross` uses.
    const root = join(homedir(), ".napi-rs", "cross-toolchain", version, process.env.TRIPLE);
    if (!existsSync(join(root, "package.json"))) {
      mkdirSync(root, { recursive: true });
      download(process.arch, process.env.TRIPLE).unpack(root);
    }
    console.log(root);
  '
)"
TOOLCHAIN="$TOOLCHAIN_ROOT/bin/$TRIPLE"

export "CARGO_TARGET_${TRIPLE_UPPER}_LINKER=$TOOLCHAIN-gcc"
export "CC_${TRIPLE_UNDERSCORED}=$TOOLCHAIN-gcc"
export "CXX_${TRIPLE_UNDERSCORED}=$TOOLCHAIN-g++"
export "AR_${TRIPLE_UNDERSCORED}=$TOOLCHAIN-ar"

pnpm --dir "$ROOT" --filter shift-bridge run build
# Same output path as `pnpm build:cli`, which electron-builder packages.
cargo build --manifest-path "$ROOT/Cargo.toml" --release --locked -p shift-cli

# Fails on any glibc symbol newer than the floor, and on any unversioned
# undefined symbol other than Node-API's, which only resolves on a system whose
# glibc happens to export it.
for binary in "$BRIDGE" "$CLI"; do
  NEWEST="$(readelf --dyn-syms --wide "$binary" | grep -oE '@GLIBC_[0-9.]+' | cut -d_ -f2 | sort -Vu | tail -1)"
  if [[ "$(printf '%s\n%s\n' "$NEWEST" "$GLIBC_FLOOR" | sort -V | tail -1)" != "$GLIBC_FLOOR" ]]; then
    echo "$binary requires glibc $NEWEST; expected at most $GLIBC_FLOOR" >&2
    exit 1
  fi

  UNVERSIONED="$(
    readelf --dyn-syms --wide "$binary" \
      | awk '$7 == "UND" && $5 == "GLOBAL" && $8 != "" && $8 !~ /@/ && $8 !~ /^napi_/ { print $8 }'
  )"
  if [[ -n "$UNVERSIONED" ]]; then
    echo "$binary has unversioned undefined symbols:" >&2
    echo "$UNVERSIONED" >&2
    exit 1
  fi
done
