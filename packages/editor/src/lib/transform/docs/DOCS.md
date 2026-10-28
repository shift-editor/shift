# Transform

<!-- reviewed: 2026-08-24 review-every: 90d -->

Matrices about an origin, and pure point transforms for the rotate and scale previews. Committed rotate, scale, reflect, align and distribute edits run in shift-font (`crates/shift-font/src/point_arrange.rs`).

## Architecture Invariants

- **Architecture Invariant:** All functions in `Transform` are pure -- they return new arrays and never mutate input points. Glyph writes happen through `GlyphLayer` methods.
- **Architecture Invariant:** Every point transform goes through `Transform.applyMatrix` internally. `rotatePoints` and `scalePoints` build a matrix and delegate. A committed transform is never applied here: it is one matrix (`Transform.about`) sent to shift-font.
- **Architecture Invariant: CRITICAL:** The composite matrix in `applyMatrix` must be assembled in the order `Translate(+origin) * Matrix * Translate(-origin)` (right-to-left application). Reversing the order silently produces wrong results around non-zero origins.
- **Architecture Invariant:** Matrix math (`Mat`, `MatModel`, `Bounds`) comes from `@shift/geo`, not from any local primitives file. The old `primitives/Mat.ts` no longer exists.

## Codemap

```
transform/
  Transform.ts        — Matrices about an origin (about, reflectionMatrix) and preview transforms (rotatePoints, scalePoints, applyMatrix)
  anchor.ts           — Maps a 9-position anchor grid to a concrete Point2D on bounds
  zoomFromWheel.ts    — Converts wheel deltaY into a zoom multiplier
  types.ts            — Re-exports centralized types from ../../../types/transform
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

`Transform` is a namespace object with pure functions. `about` puts a matrix about an origin and `reflectionMatrix` builds the reflection for a `ReflectAxis`; `GlyphLayer` sends what they build to shift-font. `rotatePoints` and `scalePoints`, used by the drag previews, build a `MatModel` via `Mat` helpers and pass it to `applyMatrix`. These helpers operate on generic coordinate-bearing objects and preserve metadata such as `kind` and `id`. `applyMatrix` constructs the composite `Translate(+origin) * Matrix * Translate(-origin)` so every transform pivots around the caller-supplied origin.

### Glyph layer writes

`GlyphLayer` owns the mutating transform API: `rotate`, `scale`, `reflect`,
`moveSelectionTo`, `align`, and `distribute`. `rotate`, `scale` and `reflect`
build one matrix about the origin (`Transform.about`) and send it as one
`transformPoints` intent; `align` and `distribute` send `alignPoints` and
`distributePoints`. shift-font applies them (`point_arrange.rs`): alignment
uses the box around the points' own positions, and distribution needs three
points, keeps the outermost two and keeps ties in the order given.

### Selection bounds

Segment-aware selection bounds are not part of this module. `Contour.selectionBounds` in `@shift/glyph-state` computes them (complete selected segments contribute curve bounds), but it currently has no production call sites — only its own test exercises it. The on-screen selection rectangle instead comes from `Editor.selectionBounds()`, which unions each selected object's full bounds; it is exposed reactively as `Editor.selectionBoundsCell` and consumed through the `useSelectionBounds` hook.

### Anchor mapping

`anchorToPoint` converts a 9-position `AnchorPosition` into a `Point2D` on a `Bounds` rectangle. `ScaleSection` uses it to resolve the scale origin selected through `TransformGrid`. Position edits always target the selection's top-left, while rotation and reflection use the selection center; the scale anchor does not affect those operations.

### Zoom from wheel

`zoomMultiplierFromWheel` normalizes `WheelEvent.deltaY` into a clamped zoom multiplier (default range 0.9--1.1), handling both pixel and line delta modes.

## Workflow recipes

### Add a new transform type

1. Build its matrix with `Mat` (and `Transform.about` for an origin); add a matrix builder to `Mat` in `@shift/geo` with a test in `Mat.test.ts` if none fits.
2. Add the `GlyphLayer` method that sends it as one `transformPoints` intent.
3. Add layer behavior tests alongside the existing suites in `GlyphLayerGeometry.test.ts` (it covers structural and metric edits and point arrangement).

### Add a new alignment mode

1. Add the variant to `PointAlignment` in `crates/shift-font/src/point_arrange.rs` and its branch in `GlyphLayer::align_points`, with a Rust test.
2. Add the literal to `AlignPointsIntent.alignment` in `crates/shift-wire/src/intents.rs` and to `AlignmentType` in `packages/editor/src/types/transform.ts`.
3. Add a layer-level test alongside the existing suites in `GlyphLayerGeometry.test.ts`.

### Use a custom compound transform

Build matrices with `Mat`, compose with `Mat.Compose`, then call `Transform.applyMatrix`:

```ts
import { Mat, type Point2D } from "@shift/geo";
import { Transform } from "../Transform";

declare const points: Point2D[];
declare const origin: Point2D;

const matrix = Mat.Compose(Mat.Rotate(Math.PI / 4), Mat.Scale(1.5, 1.5));
const result = Transform.applyMatrix(points, matrix, origin);
```

## Gotchas

- `reflectionMatrix("horizontal")` flips Y (mirrors across the X axis), not X. The naming follows "flip across the horizontal center line" convention, which inverts the vertical coordinate.
- `applyMatrix` defaults origin to `{ x: 0, y: 0 }`, not the selection center. Callers must supply the pivot themselves — `ScaleSection` resolves its selected scale anchor with `anchorToPoint`, `TransformSection` uses the selection center for rotation and reflection, and the select tool's `BoundingBox` uses the scene rect's center (its local `rectCenter` helper).
- There is no `SelectionBounds.ts` here anymore. Segment-aware bounds moved to `Contour.selectionBounds` in `@shift/glyph-state` (only fully selected segments contribute curve bounds there), but nothing in production calls it — the visible selection box is `Editor.selectionBounds()`, which unions full per-object bounds.

## Verification

```bash
# Focused transform tests
pnpm --filter @shift/editor exec vitest run src/lib/transform

# Layer integration tests
pnpm test:desktop src/renderer/src/lib/model/GlyphLayerGeometry.test.ts
```

## Related

- `GlyphLayer` -- mutating transform API over authored glyph geometry
- `Mat`, `MatModel`, `Bounds` -- matrix and bounds math from `@shift/geo`
- `Contour.selectionBounds` (`@shift/glyph-state`) -- segment-aware selection bounding boxes, formerly this module's `SelectionBounds.ts`; currently unused in production, `Editor.selectionBounds()` supplies the visible selection rectangle
- `TransformSection`, `ScaleSection` -- sidebar UI components that drive transforms through `GlyphLayer`; `ScaleSection` resolves its origin via `anchorToPoint`, and `TransformGrid` renders its anchor picker
- `Canvas` (`components/editor/Canvas.tsx`) -- consumes `zoomMultiplierFromWheel` for viewport zoom
