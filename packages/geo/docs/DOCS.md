# @shift/geo

Lightweight 2D geometry library providing pure-functional vector math, bezier curve primitives, bounding boxes, polygon operations, and affine transformation matrices.

## Architecture Invariants

**Architecture Invariant:** `Vec2`, `Bounds`, `Curve`, and `Polygon` are stateless namespace objects (plain `const` objects, not classes). All functions are pure -- they return new `Point2D` objects and never mutate inputs. WHY: tree-shakeability and zero allocation overhead from class instantiation.

**Architecture Invariant:** `Mat` is the sole exception to the pure-function rule. It is a mutable class whose instance methods (`multiply`, `translate`, `scale`, `rotate`, `invert`) mutate in place and return `this` for chaining. Static factory methods (`Identity`, `Translate`, `Scale`, `Rotate`, `Compose`) return new instances. WHY: matrix chaining is a hot path where allocation matters; the mutable API mirrors Canvas2D's `setTransform`.

**Architecture Invariant:** All geometry operates on `Point2D` = `{ x: number; y: number }` from `@shift/types`. Functions accept any object with `x` and `y` properties -- no wrapper class required. WHY: avoids forcing callers to convert between vector types; any `{ x, y }` works.

**Architecture Invariant:** Floating-point comparisons in `Vec2` use `EPSILON = 1e-10` (module-level constant in Vec2.ts). `Curve` uses separate constants: `NEWTON_TOLERANCE = 1e-6` and `CURVE_SUBDIVISIONS = 32`. These are not configurable at runtime. WHY: consistent precision across all call sites; epsilon tuning should be a deliberate library-wide change, not per-call.

**Architecture Invariant:** `Bounds` is both an interface (`{ min, max }`) and a namespace object with the same name. TypeScript merges the declaration, so you import one symbol and get both the type and the functions. WHY: ergonomic API where `Bounds.create()` returns a `Bounds`.

## Codemap

```
src/
  index.ts       -- public re-exports for all symbols
  types.ts       -- re-exports Point2D, Rect2D from @shift/types
  Vec2.ts        -- 2D vector operations namespace (~50 functions)
  Bounds.ts      -- axis-aligned bounding box (interface + namespace)
  Curve.ts       -- line/quadratic/cubic bezier primitives with hit-testing
  Polygon.ts     -- polygon area and winding direction
  Mat.ts         -- mutable 2D affine transformation matrix class
```

## Key Types

- `Point2D` -- `{ x: number; y: number }` (re-exported from `@shift/types`). The universal 2D coordinate type used by every function in the library.
- `Rect2D` -- `{ x, y, width, height, left, top, right, bottom }` (re-exported from `@shift/types`). Returned by `Bounds.toRect` and `Polygon.boundingRect`.
- `Bounds` -- `{ min: Point2D; max: Point2D }` axis-aligned bounding box. Both an interface and a namespace.
- `LineCurve` -- `{ type: "line"; p0; p1 }`. Straight segment between two points.
- `QuadraticCurve` -- `{ type: "quadratic"; p0; c; p1 }`. One control point.
- `CubicCurve` -- `{ type: "cubic"; p0; c0; c1; p1 }`. Two control points.
- `CurveType` -- discriminated union of `LineCurve | QuadraticCurve | CubicCurve`. Switch on `.type`.
- `ClosestPointResult` -- `{ t, point, distance }`. Returned by `Curve.closestPoint` for hit-testing.
- `MatModel` -- readonly interface for the six affine matrix coefficients `(a, b, c, d, e, f)`.
- `Mat` -- mutable class implementing `MatModel`. Maps directly to Canvas2D `transform(a, b, c, d, e, f)`.

## How it works

**Vec2** is the core building block. It provides construction (`create`, `zero`, `fromAngle`), arithmetic (`add`, `sub`, `scale`, `dot`, `cross`), geometry (`normalize`, `project`, `reflect`, `rotate`, `rotateAround`, `mirror`, `perp`), interpolation (`lerp`, `lerpInt`), predicates (`equals`, `isParallel`, `isWithin`), and snapping (`constrainToAxis`, `snapToAngle`, `snapAngleWithHysteresis`). Every function takes and returns plain `{ x, y }` objects.

**Curve** implements bezier math with a discriminated-union pattern. You construct curves with `Curve.line`, `Curve.quadratic`, or `Curve.cubic`, then pass them to polymorphic functions: `pointAt(curve, t)`, `tangentAt`, `normalAt`, `closestPoint`, `bounds`, `splitAt`, `length`, `sample`. Closest-point queries use a two-phase algorithm: coarse subdivision scan (32 samples) followed by Newton-Raphson refinement (up to 8 iterations at 1e-6 tolerance). `quadraticToCubic` performs lossless degree elevation.

**Bounds** provides AABB construction from points, rectangles, or explicit min/max corners, plus composition (`union`, `unionAll`, `includePoint`), queries (`containsPoint`, `overlaps`, `center`, `width`, `height`), and conversion (`toRect`, `expand`).

**Polygon** uses the shoelace formula for `signedArea` and winding-direction detection (`isClockwise`, `isCounterClockwise`).

**Mat** is a 3x2 affine matrix (implicit bottom row `[0, 0, 1]`). Instance methods mutate and chain; static methods create new matrices. `Mat.fromDecomposed` / `Mat.toDecomposed` round-trip with `DecomposedTransform` (from `@shift/types`) for the UI's translate/rotate/scale/skew controls. `Mat.applyToPoint` transforms a `Point2D`.

## Workflow recipes

### Add a new Vec2 function
1. Add the function to the `Vec2` object in `Vec2.ts` -- maintain the section grouping (Construction, Basic Operations, etc.).
2. Add tests in `Vec2.test.ts`.
3. No index.ts change needed -- `Vec2` is already exported as a namespace.
4. Run `pnpm --filter @shift/geo test`.

### Add a new curve type
1. Add the curve interface in `Curve.ts` near the existing types.
2. Add it to the `CurveType` union.
3. Add a case to every `switch (curve.type)` in `Curve` -- the compiler will flag missing cases.
4. Add private implementation functions (e.g., `arcPointAt`, `arcClosestPoint`).
5. Export the new interface from `index.ts`.
6. Run `pnpm --filter @shift/geo test`.

### Use Mat for a Canvas2D transform
```typescript
const mat = Mat.Identity().translate(cx, cy).rotate(angle).scale(sx, sy).translate(-cx, -cy);
ctx.setTransform(...mat.toCanvasTransform());
```

## Gotchas

- `Mat` mutates in place. If you need the original matrix after chaining, call `.clone()` first.
- `Vec2.normalize` returns a zero vector (not NaN) when the input has zero length. Same for `setLen` and `clampLen`.
- `Curve.closestPoint` clamps `t` to `[0, 1]` -- it finds the closest point on the segment, not the unbounded curve.
- `Polygon.isClockwise` returns `true` for degenerate polygons (fewer than 3 points).
- `Bounds.fromPoints` returns `null` for empty arrays, not a zero-size bounds.
- `Mat.invert()` throws if the matrix is singular (determinant is zero).

## Verification

```bash
pnpm --filter @shift/geo test        # unit tests (vitest)
pnpm --filter @shift/geo typecheck   # TypeScript type checking
```

## Related

- `@shift/types` -- defines `Point2D`, `Rect2D`, and `DecomposedTransform` used throughout this package
- `@shift/font` -- uses `Vec2`, `Curve`, and `Bounds` for glyph geometry and contour operations
- `@shift/rules` -- uses `Vec2` and `Point2D` for constraint evaluation
- `Transform` (in `apps/desktop`) -- uses `Mat` for selection transforms (rotate, scale, reflect)
