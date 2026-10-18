# shift-shape

<!-- reviewed: 2026-10-18 review-every: 90d -->

Shapes text with compiled OpenType features — bidi and script itemization, HarfRust shaping, and line-break opportunities — once, for every Shift host.

## Architecture Invariants

- **One shaping implementation.** The editor's workspace (`shift-backends`' `LiveShaper`, through NAPI), command-line rendering, and the editor through WebAssembly shape with this crate. Itemization, inserted-glyph stand-ins, run directions, and break opportunities are rules: a second copy in another crate or in TypeScript would let a proof and the editor's preview set the same text differently.
- **Hosts differ only by `GlyphSource`.** It answers where a character maps and what a glyph's own advance is; `None` defers to the shaping font's own `cmap` and `hmtx`. The editor maps characters through the live font and returns zero advances, so results hold only what the feature source contributes and live advances, kerning, and mark attachment are added by the caller; a compiled font uses `()`, its own tables.
- **No Shift types.** Glyphs are shaper glyph ids (indices into the shaping font's glyph order) and locations are normalized coordinates in `fvar` order. Hosts map ids to their glyphs and normalize their own locations, so the crate depends on nothing in the workspace and builds for `wasm32`.
- **Parse once.** A `Shaper` parses the font's layout tables (`ShaperData`) and `GDEF` mark classes when made. Keep one per font bytes; making one per call reparses `GSUB`/`GPOS` every time.

## Codemap

```text
crates/shift-shape/src/
  lib.rs      Unit, the crate's public surface
  shape.rs    Shaper, GlyphSource, requests and shaped runs, feature substitutions
  itemize.rs  UAX #9 levels then script runs, inserted glyphs as U+FFFC
  breaks.rs   UAX #14 line-break opportunities over units
```

## Key Types

- `Unit` — a character, or a glyph inserted by name (as a shaper glyph id), which shapes as itself and reads as an inline object for bidi and line breaking.
- `Shaper` — one font's parsed layout tables; `shape` shapes a run, `shape_paragraph` itemizes and shapes each run in its level's direction, `feature_substitutions` lists what a feature can substitute.
- `GlyphSource` — the host seam: character mapping and own advances.
- `ShapedParagraph` / `ShapedRun` / `ShapedGlyph` — runs in logical order with bidi levels; glyphs in visual order with clusters indexing the paragraph's units.
- `LineBreak` — a unit a line may (or must) start with.

## How it works

`shape_paragraph` resolves bidi levels over the units (inserted glyphs read as U+FFFC, so they take the direction around them), splits each level run by script (common characters join the run around them), and shapes each run with HarfRust in its level's direction. Each inserted glyph gets a stand-in character from Supplementary Private Use Area-B that `GlyphSource` lookups never see, so features can still substitute or position it while it forms no context. Runs come back in logical order: reordering them for display is the line's job.

`line_breaks` runs the Unicode line breaking algorithm over the same units. Choosing which allowed break to take is measurement against live advances and kerning, which the caller does.

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
