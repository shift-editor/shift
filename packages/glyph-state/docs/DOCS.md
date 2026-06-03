# Glyph State

Pure readers and geometry helpers for `GlyphStructure + Float64Array` glyph state.

## Architecture Invariants

- **Architecture Invariant:** This package has no editor state, signals, command history, bridge calls, source/session selection, DOM APIs, or mutation ownership. It only interprets already-provided glyph state.
- **Architecture Invariant:** `GlyphStateGeometry` is a lazy reader over `GlyphStructure + values`. The renderer may cache an instance per reactive state update; rendering paths should not rebuild it inside inner draw loops.
- **Architecture Invariant:** The flat values layout matches `shift-wire`: xAdvance, contour point positions, anchor positions, then component transforms. Any layout change in Rust must update `GlyphStateGeometry`, `Contour`, `Anchor`, and `Component` together.
- **Architecture Invariant:** Segment parsing is structural. Two on-curve points produce a line; onCurve/offCurve/onCurve produces a quad; onCurve/offCurve/offCurve/onCurve produces a cubic. Other patterns are skipped by the parser.

## Codemap

```
packages/glyph-state/src/
  index.ts              -- public API barrel
  GlyphStateGeometry.ts -- state reader, bounds, sidebearings, position packing
  Contour.ts            -- contour reader, point access, neighbors, selection bounds
  Anchor.ts             -- anchor reader and anchor value offsets
  Component.ts          -- component reader and decomposed transform matrix
  Segment.ts            -- id-aware segment class, hit testing, curve conversion
  GlyphGeometry.ts      -- low-level segment parser and curve conversion helpers
```

## Key Types

- **`GlyphStateGeometry`** -- immutable reader over `GlyphStructure + Float64Array`; exposes `xAdvance`, `contours`, `anchors`, `components`, `allPoints`, `bounds`, `sidebearings`, lookup helpers, preview value updates, and packed position updates.
- **`Contour`** -- reader for one contour's point records and point coordinates. Exposes endpoint/on-curve queries, wrapped `pointAt`, `withNeighbors`, `segments`, `selectionBounds`, and `canClose`.
- **`Anchor`** -- reader for one anchor's metadata and coordinates.
- **`Component`** -- reader for one component's base glyph and decomposed transform; exposes a simple affine matrix for outline composition.
- **`Segment`** -- id-aware line/quad/cubic wrapper with `id`, endpoint/control accessors, `bounds`, `toCurve`, `splitAt`, and `hitTest`.
- **`GlyphPosition` / `GlyphPositionTarget`** -- point/anchor position records used for source edit previews and sparse position patch packing.

## How It Fits

Rust owns loading, persistence, ID allocation, boolean operations, and authoritative mutation. The bridge returns `GlyphStructure + values` for a source. This package turns that state into useful geometry. The renderer wraps these readers in signals and editor APIs.

```ts
const geometry = new GlyphStateGeometry(state.structure, state.values);
const point = geometry.point(pointId);
const bounds = geometry.bounds;
const packed = GlyphStateGeometry.packPositionUpdates(positions);
```

Renderer code should keep using cached `GlyphStateGeometry` instances from the model layer. Creating a geometry object is fine on source/state changes; doing it per segment draw or per hit-test candidate is not.

## Verification

- `pnpm --filter @shift/glyph-state test`
- `pnpm --filter @shift/glyph-state typecheck`
