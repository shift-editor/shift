# shift-proof

Shapes, lays out, and renders proof text from compiled font bytes. It sits below every host: callers compile a font however they like and hand over TrueType or OpenType bytes.

- `ProofFont` binds the bytes to one location, user-space or normalized, validated against `fvar`. Text is shaped there with HarfRust, so kerning and features apply as compiled, and outlined with skrifa, unhinted, in font units with y up.
- `set_line` runs the Unicode bidirectional algorithm, splits runs by script, and places `/name` glyph tokens directly.
- `layout_text` stacks lines × sizes × locations into a pixel `Page`; `layout_grid` sets glyphs in labelled cells. `render_svg` and `render_png` (tiny-skia) draw a page.
- `render_proof` runs the whole pipeline from a `ProofRequest` and returns the image with a serialisable `ProofReport`.

Characters the font does not map are never silently dropped: they shape to `.notdef`, are drawn as red placeholders, and are listed in the report.

`shift-specimen` (recent-file thumbnails) shapes and outlines through `ProofFont`, so Shift has one shaping path for compiled fonts. `shift-cli proof` is the command-line projection.
