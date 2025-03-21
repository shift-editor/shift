#!/usr/bin/env bash


pnpm --filter @shift/shared clean 

cargo test -p shift-font export_bindings & 
cargo test -p shift-events export_bindings & 

wait

pnpm --filter @shift/shared build