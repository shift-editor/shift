#!/bin/bash

cargo watch  \
  -w "crates/" \
  -i "target/" \
  -i "*/node_modules/" \
  -i "*/npm/" \
  -i "*/dist/" \
  -i "*.d.ts" \
  -i "**/test**/" \
  -s "pnpm run build:native:debug && pnpm run dev"
