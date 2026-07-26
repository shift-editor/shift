# @shift/glyph-codec

DOM-free TypeScript implementation of Shift's packed glyph payload family.

The normative byte layout and compatibility rules live in
[`crates/shift-glyph-codec/SPECIFICATION.md`](../../crates/shift-glyph-codec/SPECIFICATION.md).
This package owns strict validation and the opaque `PackedGlyphOutline` value;
transport, persistence, `Path2D`, SVG debugging, and Slug transformations belong
to their respective consumers.
