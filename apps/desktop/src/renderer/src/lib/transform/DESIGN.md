# Transform System Design

## Overview

The transform system provides scalable, maintainable geometry transformations for selected points. It supports:
- **Rotate** - Rotate selection around an origin
- **Scale** - Scale selection from an origin (uniform and non-uniform)
- **Reflect** - Mirror selection across horizontal/vertical/custom axis
- **Translate** - Move selection by delta (already exists via MovePointsCommand)

Future extensions:
- **Skew/Shear** - Slant geometry along an axis
- **Boolean Operations** - Union, intersect, subtract (via Skia/Rust bindings)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        UI Layer                                  │
│  ┌─────────────────┐  ┌─────────────────────────────────────┐  │
│  │  Transform Tool │  │  Transform Sidebar (Button-driven) │  │
│  │  (Canvas drag)  │  │  - Rotate 90°/180°/-90°            │  │
│  └────────┬────────┘  │  - Flip H/V                         │  │
│           │           │  - Scale %                           │  │
│           │           └─────────────────┬───────────────────┘  │
└───────────┼─────────────────────────────┼──────────────────────┘
            │                             │
            ▼                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Editor.createToolContext()                    │
│                                                                  │
│   ctx.transform.rotate(angle, origin?)                          │
│   ctx.transform.scale(sx, sy, origin?)                          │
│   ctx.transform.reflect(axis, origin?)                          │
│                                                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Command Layer                                │
│                                                                  │
│   ┌───────────────────┐  ┌──────────────────┐  ┌─────────────┐ │
│   │ RotatePointsCmd   │  │ ScalePointsCmd   │  │ ReflectCmd  │ │
│   │ stores: pointIds, │  │ stores: pointIds,│  │ stores:     │ │
│   │   angle, origin,  │  │   sx, sy, origin,│  │  axis,      │ │
│   │   originalPos[]   │  │   originalPos[]  │  │  origin...  │ │
│   └─────────┬─────────┘  └────────┬─────────┘  └──────┬──────┘ │
│             │                     │                    │        │
└─────────────┼─────────────────────┼────────────────────┼────────┘
              │                     │                    │
              ▼                     ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                  TransformService (Pure Functions)               │
│                                                                  │
│   TransformService.rotatePoints(points, angle, origin)          │
│   TransformService.scalePoints(points, sx, sy, origin)          │
│   TransformService.reflectPoints(points, axis, origin)          │
│   TransformService.applyMatrix(points, matrix)                  │
│                                                                  │
│   Uses: Mat.ts, Vec2.ts, getBoundingRect()                      │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EditingManager.movePointTo()                  │
│                                                                  │
│   Final mutations go through the existing editing API            │
│   → Rust backend via N-API bindings                              │
└─────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. Transform Origin

Transforms need an origin point (pivot). Options:
- **Selection Center** (default) - Center of the bounding box
- **Individual Origins** - Each contour around its own center
- **Custom Origin** - User-specified anchor point (future)

```typescript
type TransformOrigin =
  | { type: 'selection-center' }           // Default: center of selected points bbox
  | { type: 'contour-centers' }            // Each contour transforms around its center
  | { type: 'point'; point: Point2D }      // Custom anchor point
  | { type: 'bbox-corner'; corner: 'tl' | 'tr' | 'bl' | 'br' };
```

### 2. Pure Transform Functions

Transform math lives in `TransformService` as pure functions. No side effects.
This allows:
- Easy testing
- Reuse across commands and tools
- Preview transforms before committing

```typescript
// Example: rotate points around origin
function rotatePoints(
  points: Array<{ id: PointId; x: number; y: number }>,
  angle: number,
  origin: Point2D
): Array<{ id: PointId; x: number; y: number }> {
  return points.map(p => ({
    id: p.id,
    ...Vec2.rotateAround({ x: p.x, y: p.y }, origin, angle)
  }));
}
```

### 3. Commands Store Original Positions

For undo, commands must store original positions, not deltas.
This is critical because multiple transforms may be composed.

```typescript
class RotatePointsCommand extends BaseCommand<void> {
  #pointIds: PointId[];
  #angle: number;
  #origin: Point2D;
  #originalPositions: Map<PointId, Point2D> = new Map(); // For undo

  execute(ctx) {
    // Capture original positions before transform
    for (const id of this.#pointIds) {
      const point = findPoint(ctx.snapshot, id);
      this.#originalPositions.set(id, { x: point.x, y: point.y });
    }
    // Apply transform...
  }

  undo(ctx) {
    // Restore original positions
    for (const [id, pos] of this.#originalPositions) {
      ctx.fontEngine.editing.movePointTo(id, pos.x, pos.y);
    }
  }
}
```

### 4. Batch Mutations

For performance, apply all point moves in a batch:

```typescript
// In EditingManager - add new method
transformPoints(transforms: Array<{ id: PointId; x: number; y: number }>): void {
  // Single call to Rust that updates all points at once
  const resultJson = this.#ctx.native.setPointPositions(transforms);
  // ...
}
```

If batch isn't available yet, fall back to individual `movePointTo` calls.

## File Structure

```
src/lib/transform/
├── index.ts                 # Public exports
├── TransformService.ts      # Pure transform functions
├── TransformCommands.ts     # Command implementations
├── types.ts                 # TransformOrigin, TransformResult, etc.
└── DESIGN.md               # This file
```

## API Design

### TransformService (Pure Functions)

```typescript
export const TransformService = {
  /**
   * Rotate points around an origin.
   */
  rotatePoints(
    points: TransformablePoint[],
    angle: number,
    origin: Point2D
  ): TransformablePoint[];

  /**
   * Scale points from an origin.
   * @param sx - Scale factor X (1 = no change, 2 = double, 0.5 = half)
   * @param sy - Scale factor Y
   */
  scalePoints(
    points: TransformablePoint[],
    sx: number,
    sy: number,
    origin: Point2D
  ): TransformablePoint[];

  /**
   * Reflect points across an axis through the origin.
   * @param axis - 'horizontal' (flip Y), 'vertical' (flip X), or custom angle
   */
  reflectPoints(
    points: TransformablePoint[],
    axis: ReflectAxis,
    origin: Point2D
  ): TransformablePoint[];

  /**
   * Apply an arbitrary affine transformation matrix.
   */
  applyMatrix(
    points: TransformablePoint[],
    matrix: MatModel,
    origin: Point2D
  ): TransformablePoint[];

  /**
   * Calculate the center of a bounding box for points.
   */
  getSelectionCenter(points: TransformablePoint[]): Point2D;

  /**
   * Build common transformation matrices.
   */
  matrices: {
    rotate(angle: number): Mat;
    scale(sx: number, sy: number): Mat;
    reflectHorizontal(): Mat;  // Flip across X axis (mirrors Y)
    reflectVertical(): Mat;    // Flip across Y axis (mirrors X)
    reflectAxis(angle: number): Mat;  // Reflect across arbitrary axis
  };
} as const;
```

### ToolContext Extension

```typescript
// In Editor.createToolContext()
transform: {
  /**
   * Rotate selected points.
   * @param angle - Rotation in radians (positive = counter-clockwise)
   * @param origin - Optional origin point; defaults to selection center
   */
  rotate(angle: number, origin?: Point2D): void;

  /**
   * Scale selected points.
   * @param sx - Scale factor X
   * @param sy - Scale factor Y (defaults to sx for uniform scale)
   * @param origin - Optional origin; defaults to selection center
   */
  scale(sx: number, sy?: number, origin?: Point2D): void;

  /**
   * Reflect selected points across an axis.
   * @param axis - 'horizontal' | 'vertical' | { angle: number }
   * @param origin - Optional origin; defaults to selection center
   */
  reflect(axis: 'horizontal' | 'vertical' | { angle: number }, origin?: Point2D): void;

  /**
   * Apply an arbitrary transformation matrix.
   * @param matrix - The transformation matrix
   * @param origin - Optional origin for the transform
   */
  applyMatrix(matrix: MatModel, origin?: Point2D): void;

  /**
   * Get the center of the current selection's bounding box.
   */
  getSelectionCenter(): Point2D | null;
}
```

## Common Use Cases

### 1. Rotate 90° (Sidebar Button)
```typescript
// onClick handler
const center = editor.transform.getSelectionCenter();
if (center) {
  ctx.transform.rotate(Math.PI / 2, center);
}
```

### 2. Flip Horizontal (Sidebar Button)
```typescript
ctx.transform.reflect('horizontal');
```

### 3. Scale 200% (Sidebar Input)
```typescript
ctx.transform.scale(2, 2);
```

### 4. Interactive Rotate (Transform Tool)
```typescript
// During drag
const angle = Vec2.angleTo(origin, currentMouse) - Vec2.angleTo(origin, startMouse);
// Preview: apply transform to visual only, don't commit
preview.setTransform(TransformService.rotatePoints(selected, angle, origin));

// On drag end: commit
ctx.transform.rotate(angle, origin);
```

## Implementation Order

1. **TransformService** - Pure math functions (no dependencies on Editor)
2. **TransformCommands** - Commands that use TransformService
3. **ToolContext.transform** - Wire up to Editor
4. **Transform Tool** (optional) - Interactive canvas-based transforms

## Notes on Boolean Operations

Boolean operations (union, subtract, intersect) are fundamentally different:
- They operate on **contours/paths**, not individual points
- They create/destroy geometry (new points, removed contours)
- Best implemented in Rust using Skia or a path boolean library

Suggested API (future):
```typescript
ctx.boolean.union(contourIds: ContourId[]): ContourId[];
ctx.boolean.subtract(targetId: ContourId, cutterIds: ContourId[]): ContourId[];
ctx.boolean.intersect(contourIds: ContourId[]): ContourId[];
```

These would call Rust functions that return new contour data.
