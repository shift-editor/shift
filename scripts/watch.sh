#!/bin/bash

cargo watch  \
  -w "crates/shift-core/src/" \
  -w "crates/shift-font/src/" \
  -w "crates/shift-core/Cargo.toml" \
  -w "crates/shift-font/Cargo.toml" \
  -w "Cargo.toml" \
  -s "pnpm run build:native:debug && pnpm run dev"