# Transform

Geometry transformation system for rotating, scaling, and reflecting selected points.

## Overview

Pure transform functions with command-based undo/redo. All transforms operate relative to an origin point (defaults to selection center).

## Architecture

```
Transform (Pure Functions)
├── rotatePoints(points, angle, origin)
├── scalePoints(points, sx, sy, origin)
├── reflectPoints(points, axis, origin)
└── applyMatrix(points, matrix, origin)

Commands (Undo/Redo)
├── RotatePointsCommand
├── ScalePointsCommand
├── ReflectPointsCommand
└── TransformMatrixCommand
    └── All extend BaseTransformCommand

Editor.createToolContext().transform
├── rotate(angle, origin?)
├── scale(sx, sy?, origin?)
├── reflect(axis, origin?)
├── rotate90CCW/CW(), rotate180()
└── flipHorizontal/Vertical()
```

## Key Concepts

### Transform Origin

All transforms pivot around an origin point. If not specified, uses selection center:

```typescript
ctx.transform.rotate(Math.PI / 4);           // Around selection center
ctx.transform.rotate(Math.PI / 4, { x: 0, y: 0 }); // Around origin
```

### Matrix-Based Implementation

All transforms use `applyMatrix` internally with Mat.ts matrices:

```typescript
rotatePoints(points, angle, origin) {
  return Transform.applyMatrix(points, Mat.Rotate(angle), origin);
}
```

### Reflect Axis

Reflection supports horizontal, vertical, or arbitrary angle:

```typescript
ctx.transform.reflect('horizontal');        // Flip across X axis
ctx.transform.reflect('vertical');          // Flip across Y axis
ctx.transform.reflect({ angle: Math.PI/4 }); // Flip across 45° axis
```

## API Reference

### Transform Functions

- `rotatePoints(points, angle, origin)` - Rotate by angle (radians)
- `scalePoints(points, sx, sy, origin)` - Scale by factors
- `reflectPoints(points, axis, origin)` - Mirror across axis
- `applyMatrix(points, matrix, origin)` - Apply affine transform
- `getSelectionBounds(points)` - Bounding box with center
- `getSelectionCenter(points)` - Center point only

### Matrix Builders

- `Transform.matrices.rotate(angle)` → Mat.Rotate
- `Transform.matrices.scale(sx, sy)` → Mat.Scale
- `Transform.matrices.reflectHorizontal()` → Mat.ReflectHorizontal
- `Transform.matrices.reflectVertical()` → Mat.ReflectVertical
- `Transform.matrices.reflectAxis(angle)` → Mat.ReflectAxis

## Usage Examples

### Rotate Selection 90°

```typescript
ctx.transform.rotate90CCW();
// or
ctx.transform.rotate(Math.PI / 2);
```

### Scale 200%

```typescript
ctx.transform.scale(2, 2);
```

### Flip Horizontal

```typescript
ctx.transform.flipHorizontal();
// or
ctx.transform.reflect('horizontal');
```

### Custom Transform

```typescript
const matrix = Mat.Compose(Mat.Rotate(Math.PI/4), Mat.Scale(1.5, 1.5));
const transformed = Transform.applyMatrix(points, matrix, center);
```

## Related Systems

- [commands](../../commands/docs/DOCS.md) - Command pattern for undo/redo
- [editor](../../editor/docs/DOCS.md) - ToolContext.transform API
- [primitives/Mat.ts](../../primitives/Mat.ts) - Matrix operations
