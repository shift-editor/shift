# Font

Pure, stateless query functions for glyph and contour domain structures.

## Architecture Invariants

- **Architecture Invariant:** Every function in `Glyphs` and `Contours` is pure -- it reads the glyph/contour and returns a result without mutation. These namespaces must never hold state or modify their inputs.
- **Architecture Invariant:** The domain types (`Glyph`, `Contour`, `Point`, `GlyphSnapshot`) live in `@shift/types`, not here. This package only provides operations over those types; it never defines the shapes themselves.
- **Architecture Invariant:** `Contours.at` wraps indices for closed contours by default (`wrap = contour.closed`). Neighbor lookups (`neighbors`, `withNeighbors`) depend on this wrapping behavior -- open contours yield `null` at boundaries, closed contours wrap around.
- **Architecture Invariant:** `parseContourSegments` determines segment type by scanning the `pointType` sequence (onCurve/offCurve). Two consecutive onCurve points produce a line; onCurve-offCurve-onCurve produces a quad; onCurve-offCurve-offCurve-onCurve produces a cubic. No other patterns are recognized.
- **Architecture Invariant:** `areGlyphSnapshotsEqual` compares snapshots field-by-field (not via generic deep-equal) to keep history-commit checks fast and predictable. Any new field added to `GlyphSnapshot` must be added to this function or equality checks will silently ignore it.

## Codemap

```
packages/font/src/
  index.ts            -- public API barrel; exports Contours, Glyphs, areGlyphSnapshotsEqual,
                         geometry functions and types
  Glyph.ts            -- Glyphs namespace: point lookup, iteration, spatial queries over Glyph
  Contour.ts          -- Contours namespace: point access, neighbor traversal, open/closed queries
  GlyphEquality.ts    -- areGlyphSnapshotsEqual: value-based snapshot comparison for undo dedup
  GlyphGeometry.ts    -- segment parsing, curve conversion, bounding-box derivation
```

## Key Types

- **`Glyphs`** -- namespace object with `findPoint`, `findContour`, `points` (generator), `findPoints`, `getAllPoints`, `getPointAt`. All take a `Glyph` as first argument.
- **`Contours`** -- namespace object with `firstPoint`, `lastPoint`, `firstOnCurvePoint`, `lastOnCurvePoint`, `getOnCurvePoints`, `getOffCurvePoints`, `findPointById`, `findPointIndex`, `isOpen`, `isEmpty`, `hasInteriorPoints`, `canClose`, `pointCount`, `at`, `neighbors`, `withNeighbors`. All take a `Contour` as first argument.
- **`PointInContour`** -- returned by `Glyphs.points` and `Glyphs.findPoint`: `{ point, contour, index }`.
- **`PointWithNeighbors`** -- returned by `Contours.withNeighbors`: `{ prev, current, next, index, isFirst, isLast }`.
- **`SegmentGeometry`** -- discriminated union (`LineSegmentGeometry | QuadSegmentGeometry | CubicSegmentGeometry`) produced by `parseContourSegments`.
- **`SegmentContourLike`** -- minimal contour shape (`{ points, closed }`) accepted by `parseContourSegments`, allowing it to work with both `Contour` and `RenderContour`.
- **`areGlyphSnapshotsEqual`** -- standalone function comparing two `GlyphSnapshot` values field-by-field.

## How it works

The package is organized as two functional namespaces (`Glyphs`, `Contours`) plus standalone geometry/equality functions.

**Point lookup and iteration.** `Glyphs.findPoint` does a linear scan across all contours to locate a point by `PointId`, returning the point, its parent contour, and index. `Glyphs.points` is a generator that lazily yields every point with contour context. `Glyphs.getPointAt` finds the first point within a given radius of a position (used for hit-testing).

**Contour traversal.** `Contours.at` handles index wrapping for closed contours using modular arithmetic. `Contours.withNeighbors` builds on this to yield each point with its previous/next neighbors -- for closed contours the last point's `next` wraps to the first, and vice versa. `Contours.canClose` checks whether a drawing position is close enough to the first point to close the contour (used by the pen tool).

**Segment parsing.** `parseContourSegments` walks a contour's point array and emits typed `SegmentGeometry` values (line/quad/cubic) based on onCurve/offCurve patterns. `segmentToCurve` converts each segment into a `CurveType` from `@shift/geo` for mathematical operations. `deriveGlyphTightBounds` composes these to compute axis-aligned bounding boxes over all contours (including composite contours).

**Snapshot equality.** `areGlyphSnapshotsEqual` performs a structured comparison of two `GlyphSnapshot` objects, checking scalar fields, then array-comparing contours, anchors, and composite contours element-by-element. This avoids generic deep-equal overhead and is used by the undo system to skip no-op history entries.

## Workflow recipes

### Add a new query to Glyphs or Contours

1. Add the function to the `Glyphs` or `Contours` object in `Glyph.ts` / `Contour.ts`.
2. Keep it pure: take `Glyph` or `Contour` as first arg, return without mutation.
3. Export from `index.ts` if it introduces a new type.
4. Add a test case in the corresponding `.test.ts` file.
5. Run `pnpm test` in the package.

### Add a new field to GlyphSnapshot

1. Add the field in `@shift/types` (the snapshot is generated from Rust).
2. Update `areGlyphSnapshotsEqual` in `GlyphEquality.ts` to compare the new field.
3. Add a test case in `GlyphEquality.test.ts` verifying that differing values return `false`.

### Use segment geometry for rendering or hit-testing

1. Call `parseContourSegments(contour)` to get `SegmentGeometry[]`.
2. For each segment, call `segmentToCurve(segment)` to get a `CurveType`.
3. Use `Curve.bounds`, `Curve.evaluate`, etc. from `@shift/geo` on the result.

## Gotchas

- **`getPointAt` returns the first match**: It scans contours in order and returns the first point within radius. If two points overlap, the one earlier in contour iteration order wins.
- **`parseContourSegments` silently stops on unexpected patterns**: If the point sequence doesn't match line/quad/cubic patterns (e.g., an offCurve at position 0), the parser breaks out of its loop. No error is thrown; you just get fewer segments.
- **`SegmentContourLike` vs `Contour`**: Geometry functions accept `SegmentContourLike` (points with optional `id`) so they work with `RenderContour` (composite contours that lack `id`/`ContourId`). Don't accidentally narrow the parameter type to `Contour`.
- **`areGlyphSnapshotsEqual` must be kept in sync**: If a new field is added to `GlyphSnapshot` but not to `areGlyphSnapshotsEqual`, changes to that field won't create undo history entries.

## Verification

- `pnpm --filter @shift/font test` -- runs all unit tests (Glyph, Contour, GlyphEquality, GlyphGeometry).
- `pnpm --filter @shift/font typecheck` -- confirms type correctness against `@shift/types` and `@shift/geo`.

## Related

- **`Glyph`**, **`Contour`**, **`Point`**, **`GlyphSnapshot`** (`@shift/types`) -- the domain types this package operates on.
- **`Vec2`**, **`Bounds`**, **`Curve`** (`@shift/geo`) -- geometric primitives used by `GlyphGeometry` and `Contours.canClose`.
- **`Glyph` reactive model** (renderer `lib/model/Glyph.ts`) -- imports `Glyphs`, `Contours`, `parseContourSegments`, and `segmentToCurve` to build the reactive glyph wrapper.
- **`NativeBridge`** (renderer bridge) -- uses `Glyphs` for point lookup after native engine calls.
- **`Contours`** usage in pen tool -- `Contours.canClose`, `Contours.lastOnCurvePoint`, `Contours.firstPoint` drive pen drawing behavior.
