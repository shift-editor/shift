# De-risk spikes for the renderer editing engine

Throwaway harnesses from the October 2026 investigation into running
shift-font's own editing code in the renderer through WebAssembly. None of
this ships. Each crate is its own Cargo workspace; build it with its own
target directory and run commands inside `nix develop`.

The findings are written up in the Obsidian note
"Spike - Shift WASM Editing Engine and Step 0".

## engine-spike

Benchmarks and property tests over shift-font's `apply_intents`, built
natively and as wasm32. It depends on `../../crates/shift-font`; point
that path at another checkout to compare branches.

```bash
cd spikes/engine-spike
cargo run --release --bin native                 # per-edit cost across font shapes
cargo run --release --bin native sweep           # which dimension drives the cost
cargo run --release --bin native transform-hash  # compare with the wasm hash below
cargo build --release --lib --target wasm32-unknown-unknown
wasm-bindgen --target nodejs --experimental-reset-state-function --out-dir pkg \
  target/wasm32-unknown-unknown/release/engine_spike.wasm
node run.cjs                                     # same benchmarks in wasm, plus memory
node panic.cjs                                   # a panic kills the instance; reset recovers

cargo test --release --test rebase -- --nocapture          # renderer/native convergence
cargo test --release --test anchors -- --nocapture         # changeset order across engines
cargo test --release --test undo_conflicts -- --nocapture --test-threads=1
cargo test --release --test fuzz -- --nocapture            # garbage intents; seed 3911 overflows booleans
cargo test --release --test boolean_repro -- --ignored --nocapture
```

## bridge-bench

Times the shipped edit path (`Bridge.apply`, including SQLite and the echo)
on real font files. `SHIFT_ROOT` picks the checkout whose built addon to use.

```bash
SHIFT_ROOT=/path/to/checkout node spikes/bridge-bench/bench.cjs <font> 20
node spikes/bridge-bench/echo.cjs <font> /path/to/checkout   # which fields an echo carries
```

## loader

Imports a real font with shift-backends and writes lazy and fully loaded
`Font` JSON for the wasm load measurements: `loader <font.otf> <out-dir> 300`.

## ws-wasm-check

Tries to build shift-workspace for wasm32, to list what blocks it (SQLite
linking, zstd's C build, filesystem and thread use).
