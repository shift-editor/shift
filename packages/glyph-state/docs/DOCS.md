# Glyph State

<!-- reviewed: 2026-09-05 review-every: 90d -->

Pure readers and geometry helpers for `GlyphStructure + Float64Array` glyph state.

## Architecture Invariants

- **Architecture Invariant:** This package has no editor state, signals, command history, bridge calls, source/session selection, DOM APIs, or mutation ownership. It only interprets already-provided glyph state. Its dependency surface is exactly `@shift/types` + `@shift/geo` — enforced by `scripts/check-invariants.py` (`glyph-state-deps`).
- **Architecture Invariant:** `GlyphGeometry` is a lazy reader over `GlyphStructure + values`. The renderer may cache an instance per reactive state update; rendering paths should not rebuild it inside inner draw loops.
- **Architecture Invariant:** The flat values layout matches `shift-wire`: xAdvance, contour point positions, anchor positions, then component transforms. Any layout change in Rust must update `GlyphGeometry`, `Contour`, `Anchor`, and `Component` together.
- **Architecture Invariant:** On-curve predicates accept both `onCurve` and `qCurve`. Point factories preserve the requested endpoint type and smooth flag; only off-curve controls force smoothness off.
- **Architecture Invariant:** Segment parsing is structural. Two on-curve points produce a line; onCurve/offCurve/onCurve produces a quad; onCurve/offCurve/offCurve/onCurve produces a cubic. Runs starting with an off-curve point are skipped only in open contours — closed contours wrap and consume leading off-curves as controls of the final wrapped segment — and runs of three or more off-curves after an on-curve point are emitted as mis-typed cubics rather than dropped (see Gotchas).
- **Architecture Invariant:** `bounds` always means tight drawable curve bounds, and sidebearings derive only from those bounds plus advance width. Raw control-point extents are point bounds and must be exposed as `pointBounds` if a consumer needs them; `selectionBounds` may intentionally combine complete curve segments with individually selected points.

## Codemap

```
packages/glyph-state/src/
  index.ts              -- public API barrel
  GlyphGeometry.ts      -- state reader, bounds, sidebearings, hit testing, preview updates
  Contour.ts            -- contour reader, point access, neighbors, selection bounds
  Anchor.ts             -- anchor reader and anchor value offsets
  Component.ts          -- component reader and decomposed transform matrix
  Segment.ts            -- id-aware segment class, hit testing, curve conversion
  Point.ts              -- id-aware point with on/off-curve predicates and factories
  IdIndex.ts            -- lazy id-to-object map over a supplied list
  types/contour.ts      -- minimal named contour geometry contract
```

## Key Types

- **`GlyphGeometry`** -- immutable reader over `GlyphStructure + Float64Array`; exposes `xAdvance`, `contours`, `segments`, `anchors`, `components`, `allPoints`, `bounds`, `sidebearings`, id lookups, hit testing (`hitAt`, `hitPoint`, `hitAnchor`, `hitSegment`), position reads (`positionsFor`), and preview updates (`withPositionUpdates`).
- **`Contour`** -- reader for one contour's point records and point coordinates. Exposes endpoint/on-curve queries, wrapped `pointAt`, `withNeighbors`, `segments`, `selectionBounds`, and `canClose`.
- **`Anchor`** -- reader for one anchor's metadata and coordinates.
- **`Component`** -- reader for one component's base glyph and decomposed transform; exposes a simple affine matrix for outline composition.
- **`Segment`** -- id-aware line/quad/cubic wrapper with `id`, endpoint/control accessors, `bounds`, `toCurve`, `splitAt`, and `hit`.
- **`Point`** -- id-aware point record (`pointType`, `smooth`, coordinates) with on/off-curve predicates and `NewPoint` factories for authoring flows.
- **`ContourGeometry`** -- minimal named `points + closed` contract accepted by segment parsing.
- **`SegmentedContour`** -- contour geometry that exposes domain-owned segment traversal to renderer path derivation.
- **`GlyphPosition` / `GlyphPositionTarget`** -- point/anchor position records used by `positionsFor`, `movePositions`, and `withPositionUpdates` so transform code stays independent of where the geometry came from.

## How it works

Rust owns loading, persistence, ID allocation, boolean operations, and authoritative mutation. The bridge returns `GlyphStructure + values` for a source. This package turns that state into useful geometry. The renderer wraps these readers in signals and editor APIs.

```ts
import { GlyphGeometry, type GlyphPositions } from "@shift/glyph-state";
import type { GlyphStructure, PointId } from "@shift/types";

declare const state: { structure: GlyphStructure; values: Float64Array };
declare const pointId: PointId;
declare const positions: GlyphPositions;

const geometry = new GlyphGeometry(state.structure, state.values);
const point = geometry.point(pointId);
const bounds = geometry.bounds;
const preview = geometry.withPositionUpdates(positions);
```

Renderer code should keep using cached `GlyphGeometry` instances from the model layer. Creating a geometry object is fine on source/state changes; doing it per segment draw or per hit-test candidate is not.

## Workflow recipes

### Add a derived geometry query to `GlyphGeometry`

1. Add a lazily cached private field and getter to `GeometryCache` in `GlyphGeometry.ts`, following the `bounds` / `sidebearings` pattern (compute on first access, memoize).
2. Expose a getter on `GlyphGeometry` that delegates to the cache. Do not compute in the `GlyphGeometry` constructor -- everything in this package is lazy so cheap readers stay cheap.
3. Export any new result type from `index.ts`.
4. Add a test using the `structure + Float64Array` fixture style in `Contour.test.ts` / `Segment.test.ts` -- no mocks, build real structures.
5. Verify: `pnpm --filter @shift/glyph-state test` and `pnpm --filter @shift/glyph-state typecheck`.

### Change the flat value layout (after a Rust layout change)

1. Update the cursor math in every reader together: `Contour.fromStructure` and `Contour.pointValueOffsets`, `Anchor.fromStructure` and `Anchor.valueOffsets`, and `Component.fromStructure` (stride 9 for `"decomposed"`, 6 for `"affine"` transforms).
2. `GlyphGeometry.withPositionUpdates` writes through `pointValueOffsets` / `valueOffsets`, so it follows once those are correct. Check `GlyphGeometry.xAdvance` if the leading `values[0]` slot moves.
3. Verify: `pnpm --filter @shift/glyph-state test`, then `pnpm test` so desktop consumers run against the new layout.

### Add a new hit-target kind

1. Add the kind and its id type to `GlyphHitIdByKind` in `GlyphGeometry.ts`; derive a `GlyphHitBase` alias like `GeometryPointHit`.
2. Implement a `hit<Kind>` method on `GlyphGeometry` that scans cached readers and keeps the nearest hit within `radius`.
3. Decide where it sits in the fixed `hitAt` priority chain (currently anchor, then point, then segment).
4. Export the new hit type from `index.ts` and verify: `pnpm --filter @shift/glyph-state typecheck` and `pnpm --filter @shift/glyph-state test`.

## Gotchas

- `Segment.parse` skips only runs that start with an off-curve point, and only in open contours — those points produce no segments, so they vanish from `Contour.bounds`, `segments`, and segment hit testing. In a closed contour the parser wraps past the end, so leading off-curves become controls of the final wrapped segment instead of being skipped. More than two consecutive off-curves are not skipped either: the cubic branch never checks that its fourth point is on-curve, so onCurve/off/off/off emits a malformed cubic whose `anchor2` is the third off-curve, and that segment participates in segments, bounds, and hit testing as if it were real.
- `hitAt` has fixed priority -- an anchor hit beats a closer point hit, and a point hit beats a closer segment hit. For nearest-across-kinds behavior, call `hitPoint` / `hitAnchor` / `hitSegment` yourself and compare distances.
- The `componentTransformKind` passed to the `GlyphGeometry` constructor must match how the value buffer was packed: `"decomposed"` reads 9 values per component, `"affine"` reads 6. There is no runtime check -- a mismatch silently misreads every component transform. The default is `"decomposed"`.
- `withPositionUpdates` copies the entire value buffer per call. Batch a frame's updates into one call; unknown point/anchor ids in the update list are skipped without error.
- `allPoints` returns a fresh array copy on every access. Read it once and reuse the result inside loops.
- `SegmentId` is derived from the endpoint point ids (`segment:<start>:<end>`), so it is stable across re-parses of unchanged geometry -- but any operation that replaces an endpoint produces a different id. Use `parseSegmentId` to recover the endpoints from an id.

## Verification

- `pnpm --filter @shift/glyph-state test`
- `pnpm --filter @shift/glyph-state typecheck`

## Related

- [`@shift/geo`](../../geo/docs/DOCS.md) -- coordinate, curve, matrix, and bounds primitives
- [`@shift/types`](../../types/docs/DOCS.md) -- canonical glyph structure and identity types
- [Renderer font model](../../../apps/desktop/src/renderer/src/lib/model/docs/DOCS.md) -- reactive ownership over glyph-state readers
