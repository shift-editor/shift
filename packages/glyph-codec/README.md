# @shift/glyph-codec

DOM-free TypeScript implementation of Shift's packed glyph payload family.

The normative byte layouts and compatibility rules live in
[`crates/shift-glyph-codec/SPECIFICATION.md`](../../crates/shift-glyph-codec/SPECIFICATION.md).

The package owns:

- strict `shift.glyph-outline.v1` validation and `PackedGlyphOutline`;
- strict, lossless `shift.glyph-layer.v1` validation and `PackedGlyphLayer`;
- canonical encoders shared with Rust golden vectors;
- iterable layer/contour views that avoid constructing a complete font.

`PackedGlyphOutline` is flattened, derived `f32` rendering data.
`PackedGlyphLayer` is canonical authored `f64` state with stable identities,
point semantics, components, anchors, guidelines, and lib values. They are not
interchangeable.

Transport, persistence, `Path2D`, SVG debugging, SQLite, and Slug/GPU
transformations belong to their respective consumers. Rust adaptation to the
editable object model lives in shift-font's private `codec_adapter`, keeping the codec
independent of font semantics.

Implementation modules keep responsibilities narrow: `frame.ts` owns the common
frame, `layer-binary.ts` owns bounded byte access, `layer-strings.ts` owns the
canonical first-use string table, `layer-lib.ts` owns nested lib values, and
`layer.ts` owns layer framing and iterable views. Packing retains writer-derived
offsets rather than decoding its own output a second time.

```ts
import { decodeLayer, packLayer } from "@shift/glyph-codec";

const packed = packLayer(layer);
for (const contour of packed.contours()) {
  for (const point of contour.points()) {
    // Build a bounded derived projection without materializing every layer.
  }
}

const validated = decodeLayer(bytes);
const editableLayer = validated.unpack();
```

Verification:

```bash
pnpm --filter @shift/glyph-codec typecheck
pnpm --filter @shift/glyph-codec test
cargo test -p shift-glyph-codec
cargo run --release -p shift-glyph-codec --example layer_benchmark
```
