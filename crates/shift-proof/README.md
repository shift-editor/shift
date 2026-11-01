# shift-proof

Lays out and renders proof text from compiled font bytes, shaped by `shift-text`. It sits below every host: callers compile a font however they like and hand over TrueType or OpenType bytes.

- `ProofFont` binds the bytes to one location, user-space or normalized, validated against `fvar`. Text is shaped there by `shift-text`'s `shape` module (a `Shaper` over the compiled font with `FontGlyphs`, HarfRust underneath), so kerning and features apply as compiled and every Shift host shapes by the same rules, and outlined with skrifa, unhinted, in font units with y up.
- `set_line` itemizes the line with `shift-text` (bidi levels, then scripts), shapes each run between `/name` glyph tokens, places the tokens directly, unshaped, and orders the runs for display with `visual_order`.
- With a width, lines wrap greedily at `shift-text`'s line break opportunities (UAX #14), the editor's rule.
- `layout_text` stacks lines × sizes × locations into a pixel `Page`; `layout_grid` sets glyphs in labelled cells. `render_svg` and `render_png` (tiny-skia) draw a page.
- `render_proof` runs the whole pipeline from a `ProofRequest` and returns the image with a serialisable `ProofReport`.

Characters the font does not map are never silently dropped: they shape to `.notdef`, are drawn as red placeholders, and are listed in the report.

`shift-specimen` (recent-file thumbnails) shapes and outlines through `ProofFont`. What stays here is proof-specific: compiled-font loading and locations, glyph grids, page layout, and rendering (tiny-skia PNG, SVG). `shift-cli proof` is the command-line projection.
