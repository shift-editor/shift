# Math

Geometry utilities for 2D vector math, points, rectangles, and distance calculations.

## Overview

The math library provides foundational geometric types and operations for the Shift editor. It includes point and vector classes, rectangle utilities with bounding box calculations, and distance/interpolation functions used throughout the codebase.

## Architecture

```
Types (types/math.ts)
├── Point2D { x, y }
└── Rect2D { x, y, width, height, left, top, right, bottom }

Classes (lib/math/)
├── Point (class with methods)
├── Vector2D (vector operations)
├── Rect (rectangle with hit testing)
├── Shape (abstract base)
├── Line (segment with interpolation)
└── Circle (circular shape)
```

### Key Design Decisions

1. **Type vs Class**: Point2D/Rect2D are plain types; Point/Rect are classes with methods
2. **Immutable Operations**: Vector operations return new instances
3. **Inheritance**: Rect and Circle extend abstract Shape
4. **Numerically Stable**: Uses Math.hypot() for distance calculations

## Key Concepts

### Point2D Type

Simple interface for 2D coordinates:

```typescript
type Point2D = { x: number; y: number };
```

### Vector2D Class

Full vector math operations:

```typescript
const v = new Vector2D(3, 4);
v.length(); // 5 (magnitude)
v.normalize(); // Vector2D(0.6, 0.8)
v.dot(other); // Dot product
v.cross(other); // 2D cross product (scalar)
v.project(onto); // Vector projection
```

### Rect2D Type

Rectangle with boundary accessors:

```typescript
type Rect2D = {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};
```

### Bounding Box

Calculate bounds from point array:

```typescript
const rect = getBoundingRect(points);
// Returns Rect2D with min/max coordinates
```

## API Reference

### Point Class

- `distance(x, y): number` - Distance to coordinates
- `lerp(p, t): Point` - Linear interpolation
- `clone(): Point` - Copy point
- `static distance(x0, y0, x1, y1): number` - Static distance

### Vector2D Class

- `length(): number` - Magnitude
- `normalize(): Vector2D` - Unit vector
- `dot(v): number` - Dot product
- `cross(v): number` - 2D cross product
- `add(v) / subtract(v)` - Vector arithmetic
- `multiply(s) / divide(s)` - Scalar arithmetic
- `project(v): Vector2D` - Projection
- `perpendicular(v): Vector2D` - Perpendicular component
- `reverse(): Vector2D` - Negate

### Rect Class

- `hit(x, y): boolean` - Point-in-rect test
- `resize(w, h): void` - Change dimensions
- `get_centered_position(): Point` - Center point
- `static fromBounds(l, t, r, b): Rect` - Create from bounds

### Line Class

- `length: number` - Segment length
- `startPoint / endPoint: Point` - Endpoints
- `static lerp(p1, p2, t): Point2D` - Interpolate

### Utilities

- `getBoundingRect(points): Rect2D` - Bounding box
- `Shape.shoelace(points): number` - Polygon area

## Usage Examples

### Vector Operations

```typescript
// Create from two points
const v = Vector2D.from(0, 0, 100, 50);

// Normalize and scale
const unit = v.normalize();
const scaled = unit.multiply(200);

// Project onto line
const projected = point.projectOntoLine(lineStart, lineEnd);
```

### Distance Calculations

```typescript
// Point to point
const d = Point.distance(x1, y1, x2, y2);

// Vector magnitude
const len = new Vector2D(dx, dy).length();
```

### Bounding Rectangles

```typescript
const points = snapshot.contours.flatMap((c) => c.points);
const bounds = getBoundingRect(points);
// bounds.left, bounds.right, bounds.top, bounds.bottom
```

### Linear Interpolation

```typescript
// Point along line at t (0-1)
const midpoint = Line.lerp(start, end, 0.5);

// Point class lerp (with floor)
const p = point.lerp(target, 0.25);
```

### Hit Testing

```typescript
const rect = new Rect(x, y, width, height);
if (rect.hit(mouseX, mouseY)) {
  // Point is inside rectangle
}
```

## Data Flow

```
Snapshot Points
    ↓
getBoundingRect(points)
    ↓
Rect2D { x, y, width, height, left, top, right, bottom }
    ↓
Draw bounding rectangle in editor
```

## Related Systems

- [editor](../editor/docs/DOCS.md) - Uses math for transforms and hit testing
- [tools](../tools/docs/DOCS.md) - Uses vectors for drag calculations
- [graphics](../graphics/docs/DOCS.md) - Path coordinates
