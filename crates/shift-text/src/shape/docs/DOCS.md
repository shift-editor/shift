# shift-text: shape

<!-- reviewed: 2026-11-01 review-every: 90d -->

Shapes text with compiled OpenType features — bidi and script itemization, HarfRust shaping, and line-break opportunities — once, for every Shift host. The `shape` module of `shift-text`, behind its `shape` feature.

## Architecture Invariants

- **One shaping implementation.** Proofs (`shift-proof`, for `shift-cli proof` and the launcher's specimens) and the editor, through WebAssembly, shape with this module, as does `shaper_font`'s `LiveShaper`. Itemization, inserted-glyph stand-ins, and break opportunities are rules: a second copy in another crate or in TypeScript would let a proof and the editor's preview set the same text differently.
- **Hosts differ only by `GlyphSource`.** It owns every translation between the host and the shaper: the host's glyph identity (`type Glyph`) to and from shaper glyph ids, where a character maps, and a glyph's own advance (`None` defers to the shaping font's `cmap` and `hmtx`). Requests and results are generic over that glyph type, so no host redefines or copies them: `shaper_font` names them as aliases (`ShapedRun = shape::ShapedRun<GlyphId>`). The editor maps characters through the live font and returns zero advances, so results hold only what the feature source contributes and live advances, kerning, and mark attachment are added by the caller; a compiled font uses `FontGlyphs`, its own tables and glyph ids.
- **No Shift types.** The shaper works in shaper glyph ids and normalized coordinates in `fvar` order. A host holding another kind of location converts it and re-targets its request with `ParagraphRequest::at`, so the module uses nothing else in the workspace and builds for `wasm32`.
- **Same coordinates, same mapping.** `AxisNormalization` (user to normalized, linear between the shaper font's mapping points) and `character_glyphs` (a character two glyphs claim maps to the first in glyph order) are used by `shaper_font`'s `LiveShaper`, which the editor's WebAssembly shaper runs, and by command-line shaping alike, so both shape the same text at the same location to the same glyphs.
- **Parse once.** A `Shaper` parses the font's layout tables (`ShaperData`) when made. Keep one per font bytes; making one per call reparses `GSUB`/`GPOS` every time.

## Codemap

```text
crates/shift-text/src/shape/
  mod.rs            Unit, the module's public surface
  source.rs         GlyphSource, FontGlyphs, NOTDEF, character_glyphs
  axis.rs           AxisNormalization
  shaper.rs         Shaper, requests, directions, shaped runs and glyphs
  itemize.rs        itemize (bidi levels, then scripts), visual_order
  breaks.rs         UAX #14 line-break opportunities over units
```

## Key Types

- `Unit<G>` — a character, or a glyph inserted by name (as the host's glyph), which shapes as itself and reads as an inline object for line breaking.
- `Shaper` — one font's parsed layout tables, a shaper font or a whole compiled font; `shape` shapes a run (horizontal or vertical, `ShapeDirection`) and returns the direction it shaped in (`ShapedText`), `shape_paragraph` itemizes and shapes each run in its level's direction. Both take an optional HarfRust `ShapeHook` (re-exported with `ShapeEvent`, `ShapeTable`, `GlyphInfo` and `GlyphPosition`), told about each `GSUB` and `GPOS` table and lookup as shaping applies them, which may change positions during `GPOS`; it sees shaper glyph ids and run-relative clusters. HarfRust is the shift-editor fork pinned in the workspace `Cargo.toml`, 0.13.3 plus the hook.
- `GlyphSource` — the host seam: glyph identity both ways, character mapping, and own advances.
- `ShapedParagraph<G>` / `ShapedRun<G>` / `ShapedGlyph<G>` — a paragraph's base direction and its runs in logical order, each with its bidi level; glyphs in visual order, as host glyphs, with clusters indexing the paragraph's units, each flagged `is_mark` when the font's `GDEF` classes it a mark.
- `itemize` — the itemization `shape_paragraph` runs, for a host that shapes the runs itself (`shift-proof` places named glyphs between them unshaped): runs in logical order with their level and script, and the paragraph's direction.
- `visual_order` — orders one line's runs for display by their bidi levels (UAX #9 rule L2).
- `FeatureSetting` — a feature tag and value for the whole run or a range of its units; parses HarfBuzz syntax (`kern[3:5]=0`).
- `LineBreak` — a unit a line may (or must) start with.

## How it works

`shape_paragraph` resolves bidi levels (UAX #9, with the request's base direction, or else its first strong character's, and inserted glyphs read as U+FFFC), splits the units where the level changes and then where the script changes (common characters, combining marks, and inserted glyphs join the run around them), and shapes each run with HarfRust in its level's direction, so digits inside Arabic come back as their own left-to-right run. Runs stay in logical order: a host breaks lines first and orders each line's runs with `visual_order`. Each inserted glyph gets a stand-in character from Supplementary Private Use Area-B that `GlyphSource` lookups never see, so features can still substitute or position it while it forms no context. Runs come back in logical order.

`line_breaks` runs the Unicode line breaking algorithm over the same units. Choosing which allowed break to take is measurement against live advances and kerning, which the caller does.

## Workflow recipes

### Shaping for a new host

1. Implement `GlyphSource` for the host's view of the shaping font: its glyph type, both directions of glyph identity, and, only where the host differs from the font, character mapping and advances.
2. Make one `Shaper` per font bytes and keep it; convert the host's location to normalized coordinates in `fvar` order and pass the request through `ParagraphRequest::at`.
3. Alias the request and result types over the host's glyph type rather than declaring new ones.
4. Verify: `cargo test -p shift-text`, and `cargo check -p shift-text --features shape --target wasm32-unknown-unknown` if the host is the editor.

## Gotchas

- **Thai, Lao, Khmer, and Burmese break only at spaces.** UAX #14 needs a dictionary to find their word boundaries; `unicode-linebreak` has none.
- **Clusters index units, not bytes or UTF-16 code units.** One `Unit` is one character or one inserted glyph.
- **`.notdef` is two things.** HarfRust gives glyph id 0 both for a character with no glyph and for a `.notdef` inserted by name; only the second comes back as a host glyph, told apart by the unit at its cluster.

## Verification

```bash
nix develop --command cargo test -p shift-text
nix develop --command cargo test -p shift-proof
nix develop --command cargo clippy -p shift-text --all-targets -- -D warnings
```

## Related

- [`crates/shift-text/docs/DOCS.md`](../../../docs/DOCS.md) — the crate and its features.
- [`crates/shift-text/src/shaper_font/docs/DOCS.md`](../../shaper_font/docs/DOCS.md) — compiles the shaper font from authored features and wraps this module as `LiveShaper`.
- [`crates/shift-proof/README.md`](../../../../shift-proof/README.md) — proofs from compiled font bytes, shaped here.
- [`crates/shift-wasm/docs/DOCS.md`](../../../../shift-wasm/docs/DOCS.md) — how rules reach the editor through WebAssembly.
