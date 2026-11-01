# shift-text

<!-- reviewed: 2026-11-01 review-every: 90d -->

Shapes and lays out text, once, for every Shift host: bidi and script itemization and HarfRust shaping (`shape`), the shaper font compiled from authored features (`shaper_font`), and text layout over the live font (`layout`). Each module has its own DOCS.md; this one covers the crate and how its consumers pick parts of it.

## Architecture Invariants

**Architecture Invariant:** Every text shaping and layout rule is written here once. The editor's engine module (through `shift-wasm`), export checks (`shift-backends`), and proofs from compiled font bytes (`shift-proof`, for `shift-cli proof` and the launcher's specimens) all call it. WHY: a proof and the editor setting the same text differently is the failure a second copy causes; `shift-proof` had its own bidi, script and HarfRust pipeline until it moved onto `shape`.

**Architecture Invariant:** No part is compiled unless a consumer names it. Features build on each other, `layout` ⊃ `shaper-font` ⊃ `shape`, and the workspace dependency turns the defaults off. WHY: the editor's default WebAssembly module holds only layout's request and result types (through `shift-engine`), and must link neither HarfRust nor fea-rs and fontbe; the engine module links all three.

**Architecture Invariant:** The crate reads no files, and its library code returns errors instead of panicking (`clippy::unwrap_used` in `lib.rs`, which CI's `-D warnings` makes an error). WHY: it builds for `wasm32-unknown-unknown`, where a panic ends the editing session.

## Codemap

```text
crates/shift-text/
  Cargo.toml          features: shape, shaper-font, layout (default), pack, serde, test-support
  src/lib.rs          the three modules, gated by feature
  src/shape/          itemizing, shaping, line-break opportunities (docs/DOCS.md)
  src/shaper_font/    the shaper font compile and LiveShaper (docs/DOCS.md)
  src/layout/         TextLayout and its request and result types (docs/DOCS.md)
```

## Key Types

- `shape` (feature `shape`) -- `Shaper`, `itemize`, `line_breaks`, `visual_order`, `GlyphSource`; see [`src/shape/docs/DOCS.md`](../src/shape/docs/DOCS.md)
- `shaper_font` (feature `shaper-font`) -- `ShaperFont::compile`, `ShaperFontState`, `LiveShaper`; see [`src/shaper_font/docs/DOCS.md`](../src/shaper_font/docs/DOCS.md)
- `layout` (types always; laying out with feature `layout`) -- `TextLayout`, `LayoutRequest`, `TextOptions`, `LayoutFont`; see [`src/layout/docs/DOCS.md`](../src/layout/docs/DOCS.md)

## How it works

Each consumer turns on the features it uses:

| Consumer | Features | Why |
| --- | --- | --- |
| `shift-engine` | `pack`, `serde` | the text options a scene's run stores: layout's types only |
| `shift-wasm` `engine-protocol` | `shape`, `pack` | the feature lists the protocol carries |
| `shift-wasm` `engine` | `layout` | the engine module lays text out over the session's font |
| `shift-backends` | `shaper-font` (tests: `layout`) | export converts axes with `to_ir_axes` |
| `shift-proof` | `shape` | proofs shape compiled fonts with `FontGlyphs` |

`layout` is the crate's default feature so `cargo test -p shift-text` tests every module; consumers inherit no defaults through the workspace dependency.

## Verification

```bash
nix develop --command cargo test -p shift-text
nix develop --command cargo clippy -p shift-text --all-targets -- -D warnings
nix develop --command cargo clippy -p shift-text --no-default-features -- -D warnings
nix develop --command cargo check -p shift-text --target wasm32-unknown-unknown
```

## Related

- [`crates/shift-wasm/docs/DOCS.md`](../../shift-wasm/docs/DOCS.md) -- the editor's WebAssembly modules and their features
- [`crates/shift-proof/README.md`](../../shift-proof/README.md) -- proofs from compiled font bytes, shaped by `shape`
