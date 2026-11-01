# shift-shaper-font

<!-- reviewed: 2026-10-31 review-every: 90d -->

Compiles a font's authored OpenType feature code into a shaper font: the minimal binary the editor shapes live text with. Natively and in WebAssembly, from the same code.

## Architecture Invariants

**Architecture Invariant:** A shaper font holds only authored feature code. Generated kerning, mark attachment, and `STAT` stay out of it, and shapers supply character mapping and advances from the live font. WHY: outline, advance, kerning, and anchor edits must reshape text without recompiling, so the shaper font only rebuilds when feature source, glyph order, glyph classes, or axes change.

**Architecture Invariant:** The compiler reads plain data, never a font. `ShaperFontRequest::new` takes shift-font's `ShaperFontSource` (units per em, glyph order, feature source, axes and mappings, each glyph's `GDEF` class), which any holder of a `Font` reads with `Font::shaper_font_source`. WHY: the source can be read where the font lives and compiled wherever this crate is linked.

**Architecture Invariant:** The crate depends only on shift-font, shift-shape and the fontc crates it compiles with (fea-rs, fontbe, fontir, fontdrasil, write-fonts), and reads no files: `include` statements are inlined when a font is imported, and any left are reported as diagnostics. WHY: it must build for `wasm32-unknown-unknown`.

**Architecture Invariant:** `to_ir_axes` is the one conversion of Shift axes and independent mappings into fontir axes; export (`shift-backends`) uses it too. WHY: the shaper font must resolve variable feature values at the same coordinates export compiles.

## Codemap

```text
crates/shift-shaper-font/src/
  lib.rs           ShaperFontRequest, ShaperFont::compile, InsertMarker, ShaperFontError, UnitsPerEm, ToGlyphClassDef
  axes.rs          to_ir_axes, axis_tag, AxisConversionError
  diagnostics.rs   fea-rs diagnostics with UTF-16 ranges
  tables.rs        GDEF classes, an empty GPOS when the source positions nothing, fvar axis names, insert markers
  glyph_order.rs   ShaperGlyphOrder: the Shift glyph at each shaper glyph id, both ways
  state.rs         ShaperFontState: last valid font, compile only when a compile input changes
  references.rs    the glyph names a feature source names
  shape.rs         LiveShaper over shift-shape
  positioning.rs   GeneratedPositioning: the editor's kern, mark, mkmk and curs, run at their insert markers
```

## Key Types

- `ShaperFontRequest` / `ShaperFont::compile` -- compile a font's authored feature source with fea-rs into a shaper font: `GSUB`/`GPOS`/`GDEF`, `head`, and `fvar`, with no outlines, `cmap`, or `hmtx`. Glyph ids index the request's glyph order with `.notdef` first; `GDEF` glyph classes come from the source's classes unless the feature code declares its own; diagnostics carry UTF-16 ranges
- `ShaperFontState` -- keeps the last successfully compiled shaper font active while later feature source has errors, and compiles only when a compile input changes: units per em, the feature source, the axes and their mappings, a glyph the feature source names (added, removed or renamed; a source with a glyph range or CID names every glyph), or a glyph's `GDEF` class. Any other added glyph is appended to its `glyph_order` past the compiled font's glyph count, where HarfRust shapes it as itself, uncovered by any lookup and unclassed; a removed glyph keeps its slot, unmapped. `compiles` counts compile attempts. **WHY:** a compile of a large feature source takes about 11 ms (10,000 glyphs, 5,074-line source), and adding a glyph is the commonest edit that changes the glyph directory
- `LiveShaper` -- what the editor's WebAssembly engine module (`crates/shift-wasm`, `engine` feature) shapes with, over the state's glyph order (`set_glyphs`): `shift-shape` through `LiveGlyphs`, a `GlyphSource` mapping characters through the live font's Unicode values with zero advances; the request and result types are `shift-shape`'s, aliased over `GlyphId` and `ExternalLocation`
- `GeneratedPositioning` -- how the editor positions the features export generates from kerning and anchors (`curs`, `kern`, `mark`, `mkmk`), which the shaper font leaves out. `LiveShaper::shape_positioned` and `shape_paragraph_positioned` run it through a HarfRust shape hook once per feature per run, where export would insert that feature's lookups: at the first `GPOS` lookup at or past the feature's `InsertMarker`, or at the end of `GPOS` for a feature with no marker (or none left to reach), in insertion order, skipping a feature the request turns off. "At or past" rather than "at": a shaper reports only the lookups its plan enables, so a marked lookup the script, language or a feature setting leaves out still lets the feature run at the next one. **WHY:** generated positioning composes with authored `GPOS` in export's order without recompiling on kerning or anchor edits. Every shaper font carries a `GPOS` table, empty when the source positions nothing, so the hook always runs

## How it works

A glyph's `GDEF` class depends on its category, which falls back to Glyphs' glyph data (held natively, by the store's reader and `shift-backends`, and asked for by the window's engine), and on whether it carries an anchor marks attach to. The rule is shift-font's, behind `GlyphClasses::class`; `Font::shaper_font_source` takes a `GlyphClasses` built from those answers.

`ShaperFont::compile` parses the source, validates it against the glyph order and axes, compiles it, adds the `GDEF` classes and units per em, and names the axes in `fvar`. The first stage that reports an error ends compilation with diagnostics and no font, a normal authoring state; `ShaperFontState` then keeps the last valid font, or compiles the glyph order without features when none has compiled yet, so text still shapes.

## Verification

```bash
nix develop --command cargo test -p shift-shaper-font
nix develop --command cargo clippy -p shift-shaper-font --all-targets -- -D warnings
nix develop --command cargo check -p shift-shaper-font --target wasm32-unknown-unknown
```

## Related

- [`crates/shift-shape/docs/DOCS.md`](../../shift-shape/docs/DOCS.md) -- the shaper `LiveShaper` runs
- [`crates/shift-backends/docs/DOCS.md`](../../shift-backends/docs/DOCS.md) -- `GlyphCategories::classes`, and export, which converts axes with `to_ir_axes`
