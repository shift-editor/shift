# shift-shape

<!-- reviewed: 2026-10-18 review-every: 90d -->

Shapes text with compiled OpenType features — script itemization, HarfRust shaping, and line-break opportunities — once, for every Shift host.

## Architecture Invariants

- **One shaping implementation.** The editor's workspace (`shift-backends`' `LiveShaper`, through NAPI), command-line rendering, and the editor through WebAssembly shape with this crate. Itemization, inserted-glyph stand-ins, and break opportunities are rules: a second copy in another crate or in TypeScript would let a proof and the editor's preview set the same text differently.
- **Hosts differ only by `GlyphSource`.** It owns every translation between the host and the shaper: the host's glyph identity (`type Glyph`) to and from shaper glyph ids, where a character maps, and a glyph's own advance (`None` defers to the shaping font's `cmap` and `hmtx`). Requests and results are generic over that glyph type, so no host redefines or copies them: `shift-backends` names them as aliases (`ShapedRun = shift_shape::ShapedRun<GlyphId>`). The editor maps characters through the live font and returns zero advances, so results hold only what the feature source contributes and live advances, kerning, and mark attachment are added by the caller; a compiled font uses `FontGlyphs`, its own tables and glyph ids.
- **No Shift types.** The shaper works in shaper glyph ids and normalized coordinates in `fvar` order. A host holding another kind of location converts it and re-targets its request with `ParagraphRequest::at`, so the crate depends on nothing in the workspace and builds for `wasm32`.
- **Same coordinates, same mapping.** `AxisNormalization` (user to normalized, linear between the shaper font's mapping points) and `character_glyphs` (a character two glyphs claim maps to the first in glyph order) are used by the workspace's `LiveShaper` and the editor's WebAssembly shaper alike, so both shape the same text at the same location to the same glyphs.
- **Parse once.** A `Shaper` parses the font's layout tables (`ShaperData`) when made. Keep one per font bytes; making one per call reparses `GSUB`/`GPOS` every time.

## Codemap

```text
crates/shift-shape/src/
  lib.rs            Unit, the crate's public surface
  source.rs         GlyphSource, FontGlyphs, NOTDEF, character_glyphs
  axis.rs           AxisNormalization
  shape.rs          Shaper, requests, shaped runs and glyphs
  itemize.rs        script runs
  breaks.rs   UAX #14 line-break opportunities over units
```

## Key Types

- `Unit<G>` — a character, or a glyph inserted by name (as the host's glyph), which shapes as itself and reads as an inline object for line breaking.
- `Shaper` — one font's parsed layout tables; `shape` shapes a run, `shape_paragraph` splits by script and shapes each run in its script's direction.
- `GlyphSource` — the host seam: glyph identity both ways, character mapping, and own advances.
- `ShapedRun<G>` / `ShapedGlyph<G>` — runs in logical order; glyphs in visual order, as host glyphs, with clusters indexing the paragraph's units.
- `LineBreak` — a unit a line may (or must) start with.

## How it works

`shape_paragraph` splits the units where their script changes (common characters, combining marks, and inserted glyphs join the run around them) and shapes each run with HarfRust, which picks the run's direction from its script. Each inserted glyph gets a stand-in character from Supplementary Private Use Area-B that `GlyphSource` lookups never see, so features can still substitute or position it while it forms no context. Runs come back in logical order.

`line_breaks` runs the Unicode line breaking algorithm over the same units. Choosing which allowed break to take is measurement against live advances and kerning, which the caller does.

## Workflow recipes

### Shaping for a new host

1. Implement `GlyphSource` for the host's view of the shaping font: its glyph type, both directions of glyph identity, and, only where the host differs from the font, character mapping and advances.
2. Make one `Shaper` per font bytes and keep it; convert the host's location to normalized coordinates in `fvar` order and pass the request through `ParagraphRequest::at`.
3. Alias the request and result types over the host's glyph type rather than declaring new ones.
4. Verify: `cargo test -p shift-shape`, and `cargo check -p shift-shape --target wasm32-unknown-unknown` if the host is the editor.

## Gotchas

- **Thai, Lao, Khmer, and Burmese break only at spaces.** UAX #14 needs a dictionary to find their word boundaries; `unicode-linebreak` has none.
- **Clusters index units, not bytes or UTF-16 code units.** One `Unit` is one character or one inserted glyph.

## Verification

```bash
nix develop --command cargo test -p shift-shape
nix develop --command cargo test -p shift-backends --lib shaper_font
nix develop --command cargo clippy -p shift-shape --all-targets -- -D warnings
```

## Related

- [`crates/shift-backends/docs/DOCS.md`](../../shift-backends/docs/DOCS.md) — compiles the shaper font from authored features and wraps this crate as `LiveShaper`.
- [`crates/shift-wasm/docs/DOCS.md`](../../shift-wasm/docs/DOCS.md) — how rules reach the editor through WebAssembly.
