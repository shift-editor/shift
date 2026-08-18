# Transform

<!-- reviewed: 2026-08-18 review-every: 90d -->

Pure geometry transformation system for rotating, scaling, reflecting, aligning, and distributing selected points.

## Architecture Invariants

- **Architecture Invariant:** All functions in `Transform` are pure -- they return new arrays and never mutate input points. Glyph writes happen through `GlyphLayer` methods.
- **Architecture Invariant:** Every geometric transform goes through `Transform.applyMatrix` internally. The three high-level functions (`rotatePoints`, `scalePoints`, `reflectPoints`) are thin wrappers that build a matrix and delegate. Custom transforms should follow the same pattern.
- **Architecture Invariant: CRITICAL:** The composite matrix in `applyMatrix` must be assembled in the order `Translate(+origin) * Matrix * Translate(-origin)` (right-to-left application). Reversing the order silently produces wrong results around non-zero origins.
- **Architecture Invariant:** `Alignment.distributePoints` requires at least 3 points. With fewer, it returns the input unchanged. The outermost points are always pinned; only interior points move.
- **Architecture Invariant:** Matrix math (`Mat`, `MatModel`, `Bounds`) comes from `@shift/geo`, not from any local primitives file. The old `primitives/Mat.ts` no longer exists.

## Codemap

```
transform/
  Transform.ts        — Pure transform functions (rotate, scale, reflect, applyMatrix)
  Alignment.ts        — Point alignment (edge/center) and distribution
  anchor.ts           — Maps a 9-position anchor grid to a concrete Point2D on bounds
  zoomFromWheel.ts    — Converts wheel deltaY into a zoom multiplier
  types.ts            — Re-exports centralized types from @/types/transform
  index.ts            — Barrel for pure transform helpers
```

## Key Types

- Coordinate-bearing items -- transform helpers accept any object with `x` and `y` and preserve its other fields.
- `ReflectAxis` -- `"horizontal" | "vertical" | { angle: number }`. Named axes or arbitrary angle for reflection.
- `AlignmentType` -- `"left" | "center-h" | "right" | "top" | "center-v" | "bottom"`. Edge or center to align against.
- `DistributeType` -- `"horizontal" | "vertical"`. Axis along which to space points evenly.
- `TransformOptions` -- `{ origin?: Point2D }`. Shared base for optional origin override.
- `ScaleOptions` -- Extends `TransformOptions` with `{ uniform?: boolean }`.
- `AnchorPosition` -- `"tl" | "tm" | "tr" | "lm" | "m" | "rm" | "bl" | "bm" | "br"`. 9-position grid defined in `TransformGrid`.
- `MatModel` -- Affine matrix shape from `@shift/geo`, used by `applyMatrix`.

## How it works

### Pure functions layer

`Transform` is a namespace object with pure functions. All three geometric operations -- `rotatePoints`, `scalePoints`, `reflectPoints` -- build a `MatModel` via `Mat` helpers and pass it to `applyMatrix`. These helpers operate on generic coordinate-bearing objects and preserve metadata such as `kind` and `id`. `applyMatrix` constructs the composite `Translate(+origin) * Matrix * Translate(-origin)` so every transform pivots around the caller-supplied origin.

The `matrices` namespace exposes the raw `Mat` builders (`Mat.Rotate`, `Mat.Scale`, etc.) for callers that need to compose custom transforms.

### Glyph layer writes

`GlyphLayer` owns the mutating transform API: `rotate`, `scale`, `reflect`,
`moveSelectionTo`, `align`, and `distribute`. Those methods resolve point
positions, call the pure transform/alignment helpers, and commit one sparse
position patch through the workspace ledger.

### Alignment

`Alignment.alignPoints` moves every point to one edge or center of the selection's own bounding box (computed via `Bounds.fromPoints`). `Alignment.distributePoints` sorts points along an axis and spaces the interior ones equally between the two extremes.

### Selection bounds

Segment-aware selection bounds are not part of this module. They live in `@shift/glyph-state` as `Contour.selectionBounds`, and the editor exposes the current selection's rectangle through `Editor.selectionBoundsCell` (consumed by the `useSelectionBounds` hook). Transform callers that need a pivot compute it from those bounds via `Bounds.center`.

### Anchor mapping

`anchorToPoint` converts a 9-position `AnchorPosition` into a `Point2D` on a `Bounds` rectangle. The sidebar `TransformGrid` and `ScaleSection` components use this to let users pick the transform origin.

### Zoom from wheel

`zoomMultiplierFromWheel` normalizes `WheelEvent.deltaY` into a clamped zoom multiplier (default range 0.9--1.1), handling both pixel and line delta modes.

## Workflow recipes

### Add a new transform type

1. Add a pure function to `Transform` in `Transform.ts` that builds a matrix and calls `applyMatrix`.
2. Add or update the corresponding `GlyphLayer` method if this transform should mutate glyph geometry.
3. Add pure tests in `Transform.test.ts` and layer behavior tests in `GlyphLayerGeometry.test.ts`.

### Add a new alignment mode

1. Add the new literal to `AlignmentType` in `@/types/transform`.
2. Add a `case` branch in `Alignment.alignPoints`.
3. Update `GlyphLayer.align` if it needs special bounds logic.
4. Add tests in `Alignment.test.ts` and `GlyphLayerGeometry.test.ts`.

### Use a custom compound transform

Build matrices with `Transform.matrices.*`, compose with `Mat.Compose`, then call `Transform.applyMatrix`:

```ts
import { Mat, type Point2D } from "@shift/geo";
import { Transform } from "../Transform";

declare const points: Point2D[];
declare const origin: Point2D;

const matrix = Mat.Compose(Mat.Rotate(Math.PI / 4), Mat.Scale(1.5, 1.5));
const result = Transform.applyMatrix(points, matrix, origin);
```

## Gotchas

- `reflectPoints("horizontal")` flips Y (mirrors across the X axis), not X. The naming follows "flip across the horizontal center line" convention, which inverts the vertical coordinate.
- `applyMatrix` defaults origin to `{ x: 0, y: 0 }`, not the selection center. Callers must compute the center themselves (typically via `Bounds.center(Bounds.fromPoints(points))`).
- `distributePoints` with fewer than 3 points is a no-op -- no error is thrown, the input is returned unchanged.
- There is no `SelectionBounds.ts` here anymore. Segment-aware bounds moved to `Contour.selectionBounds` in `@shift/glyph-state`; only fully selected segments contribute curve bounds there, so a single unselected control point can produce a visibly smaller box.

## Verification

```bash
# Unit tests for all transform files
npx vitest run --reporter verbose src/renderer/src/lib/transform/

# Layer integration tests
pnpm --filter @shift/desktop test -- src/renderer/src/lib/model/GlyphLayerGeometry.test.ts
```

## Related

- `GlyphLayer` -- mutating transform API over authored glyph geometry
- `Mat`, `MatModel`, `Bounds` -- matrix and bounds math from `@shift/geo`
- `Contour.selectionBounds` (`@shift/glyph-state`) -- segment-aware selection bounding boxes, formerly this module's `SelectionBounds.ts`
- `TransformGrid`, `TransformSection`, `ScaleSection` -- sidebar UI components that drive transforms through `GlyphLayer`
- `EditorView` -- consumes `zoomMultiplierFromWheel` for viewport zoom
