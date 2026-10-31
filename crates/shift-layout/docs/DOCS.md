# shift-layout

<!-- reviewed: 2026-11-01 review-every: 90d -->

Lays out proof text over the live font in one call: shaping, the positioning export generates from kerning and anchors, line breaking, bidi order, alignment, carets and boxes. The editor draws, hit-tests and edits from the `TextLayout` it returns.

## Architecture Invariants

**Architecture Invariant:** Every text layout rule runs here or in the crates it composes (shift-shape, shift-shaper-font, shift-font), never in TypeScript. WHY: the editor, export checks and any later host must lay text out the same way; a second copy drifts.

**Architecture Invariant:** Layout reads the live font at one location through `LayoutFont`, which resolves each glyph once per layout (`FontProjection`), and positions generated features inside shaping at their insert markers (`LiveShaper::shape_paragraph_live`, `GeneratedPositioning`). WHY: kerning and anchor edits show at once without recompiling the shaper font, and generated positioning composes with authored `GPOS` in export's order.

**Architecture Invariant:** The crate reads no files and holds no state between layouts. WHY: it builds for `wasm32-unknown-unknown` inside the engine module, which owns caching.

## Codemap

```text
crates/shift-layout/src/
  lib.rs        TextLayout and what it returns: lines, runs, placed glyphs, unit glyphs, caret stops
  request.rs    LayoutRequest, LayoutUnit, TextOptions (language, script, features, shaping, align, line height, width)
  font.rs       LayoutFont: the live font at a location; LineMetrics; GeneratedPositions, the positioning callback
  paragraph.rs  splitting at line breaks; shaping a paragraph, or laying it out as typed
  lines.rs      line breaking (UAX #14), each line's runs in display order (UAX #9 L2), alignment
  carets.rs     caret stops per grapheme boundary
  units.rs      which glyphs each unit shows
```

## Key Types

- `TextLayout::new(&LayoutFont, &LayoutRequest)` -- lays the units out. Units count line breaks, and every index in the result counts units. Font units, y up: line 0's baseline is 0, each later one a line height lower (`LineHeight::Auto`: ascender minus descender plus line gap; `Em`: a multiple of units per em)
- `LayoutLine` -- a paragraph, or the part of one that fits `TextOptions::width`, with its runs in display order (`LineRun`: units, bidi level, direction, script, its glyph range). `left` is where alignment put it in `TextLayout::width`; with no `align`, a line starts where its paragraph's direction starts
- `PlacedGlyph` -- a glyph's pen position (`left`, `baseline`), offset, advance, the units it shows (a ligature several), its run's direction, the `GDEF` mark flag, and its outline bounds
- `UnitGlyphs` -- for each unit, the glyphs that show it in logical order, so a decomposed character's body comes before its dot in either direction
- `CaretStop` -- one per grapheme boundary of each line: the leading edge of the unit after it (a right-to-left glyph's right edge), or the trailing edge of the one before at a line's end; at a direction boundary, `secondary` is the other edge. Inside a ligature a stop sits at the ligature's `caret_N` anchor when it has one per boundary, as export compiles `GDEF` ligature carets, and at an even share of its advance otherwise
- `LayoutFont` -- the live font at one location: a `FontProjection` for advances, bounds and compiled anchors, a `KerningBlend`, the session's `LiveShaper` (or why there is none), and each glyph's `GDEF` class

## How it works

Each paragraph is shaped by `LiveShaper::shape_paragraph_live`: bidi levels and scripts split it into runs, each glyph starts from its live advance, HarfRust applies the shaper font's authored lookups, and at each generated feature's marker `GeneratedPositions` hands the run to shift-font's `RunPositioning`. Text with `shaping` off, and a paragraph that cannot be shaped, is laid out as typed: one glyph per unit by the shaper's character map, left to right, with a zero-width nonspacing mark given a 600-unit stand-in advance and set beside the text at the height its anchor attaches at (`TextLayout::unshaped` says why, when it was not asked for).

Lines break greedily at UAX #14 opportunities, measured by the shaped advances; a line's runs are ordered by their levels, then placed left to right, then aligned.

## Workflow recipes

### Adding a layout option

1. Add the field to `TextOptions` (`request.rs`); it crosses to the editor as a pack type, so keep it plain data.
2. Read it where the rule lives: shaping in `paragraph.rs`, line breaking and alignment in `lines.rs`, carets in `carets.rs`.
3. Add a test in `tests.rs` over a fixture font, asserting on the returned geometry.

## Gotchas

- **A line is not reshaped where it breaks.** Runs are shaped per paragraph and cut at line ends, so a contextual form across a break keeps its in-line shape.
- **Bidi levels are resolved over the whole paragraph**, as one line, including the trailing-whitespace rule (L1); each line then orders its own runs.
- **Generated positioning has no attachment chain.** An attached glyph's offset is final when its feature runs, so an authored lookup after the marker that moves a base does not carry the base's marks.

## Verification

```bash
nix develop --command cargo test -p shift-layout
nix develop --command cargo clippy -p shift-layout --all-targets -- -D warnings
nix develop --command cargo check -p shift-layout --target wasm32-unknown-unknown
```

## Related

- [`crates/shift-shape/docs/DOCS.md`](../../shift-shape/docs/DOCS.md) -- itemizing, shaping and break opportunities
- [`crates/shift-shaper-font/docs/DOCS.md`](../../shift-shaper-font/docs/DOCS.md) -- the shaper font and `LiveShaper`
- [`crates/shift-font/docs/DOCS.md`](../../shift-font/docs/DOCS.md) -- `RunPositioning` and `FontProjection::compiled_anchors`
