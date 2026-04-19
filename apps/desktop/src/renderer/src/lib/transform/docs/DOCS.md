# Transform

Pure geometry transformation system for rotating, scaling, reflecting, aligning, and distributing selected points.

## Architecture Invariants

- **Architecture Invariant:** All functions in `Transform` are pure -- they return new arrays and never mutate input points. Commands are the only path that writes back to the glyph.
- **Architecture Invariant:** Every geometric transform goes through `Transform.applyMatrix` internally. The three high-level functions (`rotatePoints`, `scalePoints`, `reflectPoints`) are thin wrappers that build a matrix and delegate. Custom transforms should follow the same pattern.
- **Architecture Invariant: CRITICAL:** The composite matrix in `applyMatrix` must be assembled in the order `Translate(+origin) * Matrix * Translate(-origin)` (right-to-left application). Reversing the order silently produces wrong results around non-zero origins.
- **Architecture Invariant:** `Alignment.distributePoints` requires at least 3 points. With fewer, it returns the input unchanged. The outermost points are always pinned; only interior points move.
- **Architecture Invariant:** Matrix math (`Mat`, `MatModel`, `Bounds`) comes from `@shift/geo`, not from any local primitives file. The old `primitives/Mat.ts` no longer exists.

## Codemap

```
transform/
  Transform.ts        — Pure transform functions (rotate, scale, reflect, applyMatrix)
  Alignment.ts        — Point alignment (snap to edge/center) and distribution
  SelectionBounds.ts  — Segment-aware bounding box that accounts for bezier curves
  anchor.ts           — Maps a 9-position anchor grid to a concrete Point2D on bounds
  zoomFromWheel.ts    — Converts wheel deltaY into a zoom multiplier
  types.ts            — Re-exports centralized types from @/types/transform
  index.ts            — Barrel; also re-exports command classes from commands/transform
```

## Key Types

- `PointPosition` (internal) -- `{ id: PointId; x: number; y: number }`. Local helper shape used inside transform/model internals for stable point identity plus absolute position.
- `ReflectAxis` -- `"horizontal" | "vertical" | { angle: number }`. Named axes or arbitrary angle for reflection.
- `AlignmentType` -- `"left" | "center-h" | "right" | "top" | "center-v" | "bottom"`. Edge or center to align against.
- `DistributeType` -- `"horizontal" | "vertical"`. Axis along which to space points evenly.
- `TransformOptions` -- `{ origin?: Point2D }`. Shared base for optional origin override.
- `ScaleOptions` -- Extends `TransformOptions` with `{ uniform?: boolean }`.
- `AnchorPosition` -- `"tl" | "tm" | "tr" | "lm" | "m" | "rm" | "bl" | "bm" | "br"`. 9-position grid defined in `TransformGrid`.
- `MatModel` -- Affine matrix shape from `@shift/geo`, used by `applyMatrix`.

## How it works

### Pure functions layer

`Transform` is a namespace object with pure functions. All three geometric operations -- `rotatePoints`, `scalePoints`, `reflectPoints` -- build a `MatModel` via `Mat` helpers and pass it to `applyMatrix`. These helpers operate on a small internal `PointPosition` shape rather than exporting transform-specific point vocabulary into the wider app. `applyMatrix` constructs the composite `Translate(+origin) * Matrix * Translate(-origin)` so every transform pivots around the caller-supplied origin.

The `matrices` namespace exposes the raw `Mat` builders (`Mat.Rotate`, `Mat.Scale`, etc.) for callers that need to compose custom transforms.

### Command layer

Undo/redo is handled by command classes in `commands/transform/`, re-exported through the barrel `index.ts`:

- `RotatePointsCommand`, `ScalePointsCommand`, `ReflectPointsCommand`, `MoveSelectionToCommand` all extend `BaseTransformCommand`. The base class captures original positions on first execute; subclasses now call glyph-domain verbs (`glyph.rotate`, `glyph.scale`, etc.) instead of manually iterating point writes.
- `AlignPointsCommand` and `DistributePointsCommand` extend `BaseCommand` directly and call `Alignment.alignPoints` / `Alignment.distributePoints`.

### Alignment

`Alignment.alignPoints` snaps every point to one edge or center of the selection's own bounding box (computed via `Bounds.fromPoints`). `Alignment.distributePoints` sorts points along an axis and spaces the interior ones equally between the two extremes.

### Selection bounds

`getSegmentAwareBounds` computes a tight bounding box that accounts for bezier curve geometry. When every point of a segment is selected, the segment's full curve bounds are used (which may extend beyond on-curve points). Partially selected segments fall back to raw point coordinates.

### Anchor mapping

`anchorToPoint` converts a 9-position `AnchorPosition` into a `Point2D` on a `Bounds` rectangle. The sidebar `TransformGrid` and `ScaleSection` components use this to let users pick the transform origin.

### Zoom from wheel

`zoomMultiplierFromWheel` normalizes `WheelEvent.deltaY` into a clamped zoom multiplier (default range 0.9--1.1), handling both pixel and line delta modes.

## Workflow recipes

### Add a new transform type

1. Add a pure function to `Transform` in `Transform.ts` that builds a matrix and calls `applyMatrix`.
2. Create a command class in `commands/transform/TransformCommands.ts` extending `BaseTransformCommand`; implement `transformPoints` to call the new function.
3. Re-export the command from `commands/transform/index.ts` and `transform/index.ts`.
4. Add tests in `Transform.test.ts` and `TransformCommands.test.ts`.

### Add a new alignment mode

1. Add the new literal to `AlignmentType` in `@/types/transform`.
2. Add a `case` branch in `Alignment.alignPoints`.
3. Update `AlignPointsCommand` if it needs special bounds logic.
4. Add tests in `Alignment.test.ts`.

### Use a custom compound transform

Build matrices with `Transform.matrices.*`, compose with `Mat.Compose`, then call `Transform.applyMatrix`:

```ts
const matrix = Mat.Compose(Mat.Rotate(Math.PI / 4), Mat.Scale(1.5, 1.5));
const result = Transform.applyMatrix(points, matrix, origin);
```

## Gotchas

- `reflectPoints("horizontal")` flips Y (mirrors across the X axis), not X. The naming follows "flip across the horizontal center line" convention, which inverts the vertical coordinate.
- `applyMatrix` defaults origin to `{ x: 0, y: 0 }`, not the selection center. Callers must compute the center themselves (typically via `Bounds.center(Bounds.fromPoints(points))`).
- `distributePoints` with fewer than 3 points is a no-op -- no error is thrown, the input is returned unchanged.
- `getSegmentAwareBounds` only uses curve bounds when _all_ points of a segment are selected. A single unselected control point causes fallback to raw point coordinates, which can produce a visibly smaller bounding box.

## Verification

```bash
# Unit tests for all transform files
npx vitest run --reporter verbose src/renderer/src/lib/transform/

# Command integration tests
npx vitest run --reporter verbose src/renderer/src/lib/commands/transform/
```

## Related

- `BaseTransformCommand`, `RotatePointsCommand`, `ScalePointsCommand`, `ReflectPointsCommand`, `MoveSelectionToCommand` -- command classes in `commands/transform`
- `AlignPointsCommand`, `DistributePointsCommand` -- alignment command classes in `commands/transform`
- `Mat`, `MatModel`, `Bounds` -- matrix and bounds math from `@shift/geo`
- `Segment` -- bezier segment utilities used by `getSegmentAwareBounds`
- `TransformGrid`, `TransformSection`, `ScaleSection` -- sidebar UI components that drive transforms via commands
- `EditorView` -- consumes `zoomMultiplierFromWheel` for viewport zoom
