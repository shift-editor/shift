# Transform - LLM Context

## Quick Facts

- **Purpose**: Geometry transforms (rotate, scale, reflect) with undo/redo
- **Language**: TypeScript
- **Key Files**: `Transform.ts`, `TransformCommands.ts`, `types.ts`
- **Dependencies**: lib/primitives/Mat.ts, lib/commands, @/types/snapshots
- **Dependents**: lib/editor (ToolContext.transform)

## File Structure

```
src/renderer/src/lib/transform/
├── index.ts              # Public exports
├── Transform.ts          # Pure transform functions
├── TransformCommands.ts  # Command implementations
├── types.ts              # TransformablePoint, ReflectAxis, etc.
├── Transform.test.ts
└── TransformCommands.test.ts
```

## Core Abstractions

### TransformablePoint (types.ts)

```typescript
interface TransformablePoint {
  readonly id: PointId;
  readonly x: number;
  readonly y: number;
}
```

### Transform Object (Transform.ts)

```typescript
const Transform = {
  rotatePoints(points, angle, origin): TransformablePoint[];
  scalePoints(points, sx, sy, origin): TransformablePoint[];
  reflectPoints(points, axis, origin): TransformablePoint[];
  applyMatrix(points, matrix, origin): TransformablePoint[];
  getSelectionBounds(points): SelectionBounds | null;
  getSelectionCenter(points): Point2D | null;
  matrices: { rotate, scale, reflectHorizontal, reflectVertical, reflectAxis };
};
```

### BaseTransformCommand (TransformCommands.ts)

```typescript
abstract class BaseTransformCommand extends BaseCommand<void> {
  #pointIds: PointId[];
  #originalPositions: Map<PointId, Point2D>;

  protected abstract transformPoints(points: readonly TransformablePoint[]): TransformablePoint[];

  execute(ctx): void {
    const points = getPointsFromSnapshot(ctx.snapshot, this.#pointIds);
    // Store originals, apply transform, call movePointTo
  }

  undo(ctx): void {
    // Restore original positions
  }
}
```

## Key Patterns

### Matrix-Based Transforms

All core transforms delegate to `applyMatrix`:

```typescript
rotatePoints(points, angle, origin) {
  return Transform.applyMatrix(points, Mat.Rotate(angle), origin);
}

scalePoints(points, sx, sy, origin) {
  return Transform.applyMatrix(points, Mat.Scale(sx, sy), origin);
}

reflectPoints(points, axis, origin) {
  const matrix = axis === "horizontal" ? Mat.ReflectHorizontal()
               : axis === "vertical" ? Mat.ReflectVertical()
               : Mat.ReflectAxis(axis.angle);
  return Transform.applyMatrix(points, matrix, origin);
}
```

### Origin-Centered Matrix Application

```typescript
applyMatrix(points, matrix, origin) {
  const toOrigin = Mat.Translate(-origin.x, -origin.y);
  const fromOrigin = Mat.Translate(origin.x, origin.y);
  const composite = Mat.Compose(Mat.Compose(fromOrigin, matrix), toOrigin);
  return points.map(p => {
    const t = Mat.applyToPoint(composite, { x: p.x, y: p.y });
    return { id: p.id, x: t.x, y: t.y };
  });
}
```

### Command Inheritance

```typescript
class RotatePointsCommand extends BaseTransformCommand {
  readonly name = "Rotate Points";
  #angle: number;
  #origin: Point2D;

  protected transformPoints(points): TransformablePoint[] {
    return Transform.rotatePoints(points, this.#angle, this.#origin);
  }
}
```

## API Surface

| Function/Class               | Purpose                           |
| ---------------------------- | --------------------------------- |
| Transform.rotatePoints       | Rotate points around origin       |
| Transform.scalePoints        | Scale from origin                 |
| Transform.reflectPoints      | Mirror across axis through origin |
| Transform.applyMatrix        | Apply arbitrary affine matrix     |
| Transform.getSelectionBounds | Compute bounding box + center     |
| RotatePointsCommand          | Undoable rotation                 |
| ScalePointsCommand           | Undoable scaling                  |
| ReflectPointsCommand         | Undoable reflection               |
| TransformMatrixCommand       | Undoable matrix transform         |

## Common Operations

### Pure Transform

```typescript
const rotated = Transform.rotatePoints(points, Math.PI / 2, center);
```

### Via Editor

```typescript
ctx.transform.rotate(Math.PI / 2);
ctx.transform.scale(2, 2);
ctx.transform.reflect("horizontal");
```

### Direct Command

```typescript
const cmd = new RotatePointsCommand(pointIds, Math.PI / 2, center);
history.execute(cmd);
```

## Constraints

1. **Pure Functions**: Transform methods don't mutate, return new arrays
2. **Origin Required**: All transforms need an origin point
3. **Command Stores Originals**: For undo, commands store pre-transform positions
4. **No Redraw Needed**: Commands trigger redraw via signal flow (snapshot changes)
