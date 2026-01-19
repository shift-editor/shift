# Math - LLM Context

## Quick Facts

- **Purpose**: Geometry utilities for 2D vector math, points, rectangles
- **Language**: TypeScript
- **Key Files**: `point.ts`, `vector.ts`, `rect.ts`, `line.ts`
- **Dependencies**: None (standalone)
- **Dependents**: lib/editor, lib/tools

## File Structure

```
src/renderer/src/lib/math/
├── point.ts        # Point class
├── vector.ts       # Vector2D class
├── rect.ts         # Rect, UPMRect, UPMBoundingRect, getBoundingRect
├── shape.ts        # Abstract Shape base
├── line.ts         # Line class
├── circle.ts       # Circle class
└── rect.test.ts    # Tests
```

## Core Abstractions

### Point2D (types/math.ts)

```typescript
type Point2D = { x: number; y: number };
```

### Rect2D (types/math.ts)

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

### Point Class (point.ts)

```typescript
class Point {
  #x: number;
  #y: number;

  distance(x: number, y: number): number {
    return Math.hypot(this.#x - x, this.#y - y);
  }

  lerp(p: Point, t: number): Point {
    return new Point(
      Math.floor(this.#x + (p.x - this.#x) * t),
      Math.floor(this.#y + (p.y - this.#y) * t),
    );
  }

  static distance(x0: number, y0: number, x1: number, y1: number): number {
    return Math.hypot(x1 - x0, y1 - y0);
  }
}
```

### Vector2D Class (vector.ts)

```typescript
class Vector2D {
  #x: number;
  #y: number;

  static from(x0, y0, x1, y1): Vector2D {
    return new Vector2D(x1 - x0, y1 - y0);
  }

  length(): number {
    return Math.hypot(this.#x, this.#y);
  }

  normalize(): Vector2D {
    const len = this.length();
    return new Vector2D(this.#x / len, this.#y / len);
  }

  dot(v: Vector2D): number {
    return this.#x * v.x + this.#y * v.y;
  }

  cross(v: Vector2D): number {
    return this.#x * v.y - this.#y * v.x;
  }

  project(onto: Vector2D): Vector2D {
    const scalar = this.dot(onto) / onto.dot(onto);
    return onto.multiply(scalar);
  }
}
```

### Rect Class (rect.ts)

```typescript
class Rect extends Shape {
  #width: number;
  #height: number;

  hit(x: number, y: number): boolean {
    return (
      x >= this.x &&
      x <= this.x + this.#width &&
      y >= this.y &&
      y <= this.y + this.#height
    );
  }

  static fromBounds(left, top, right, bottom): Rect {
    return new Rect(left, top, right - left, bottom - top);
  }
}
```

### getBoundingRect (rect.ts)

```typescript
function getBoundingRect(points: Point2D[]): Rect2D {
  let minX = Infinity,
    minY = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity;

  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    left: minX,
    top: minY,
    right: maxX,
    bottom: maxY,
  };
}
```

## Key Patterns

### Immutable Vector Operations

```typescript
// All operations return new instances
const v1 = new Vector2D(1, 0);
const v2 = v1.multiply(5); // v1 unchanged
const v3 = v2.normalize(); // v2 unchanged
```

### Static Factory Methods

```typescript
Vector2D.from(x0, y0, x1, y1); // Direction vector
Vector2D.unitFrom(x0, y0, x1, y1); // Unit direction
Rect.fromBounds(l, t, r, b); // From boundaries
```

### Numerically Stable Distance

```typescript
// Always use Math.hypot for distance
Math.hypot(dx, dy); // Not Math.sqrt(dx*dx + dy*dy)
```

## API Surface

| Class    | Method                          | Return   |
| -------- | ------------------------------- | -------- |
| Point    | distance(x, y)                  | number   |
| Point    | lerp(p, t)                      | Point    |
| Point    | static distance(x0, y0, x1, y1) | number   |
| Vector2D | length()                        | number   |
| Vector2D | normalize()                     | Vector2D |
| Vector2D | dot(v)                          | number   |
| Vector2D | cross(v)                        | number   |
| Vector2D | project(v)                      | Vector2D |
| Vector2D | projectOntoLine(start, end)     | Vector2D |
| Rect     | hit(x, y)                       | boolean  |
| Rect     | resize(w, h)                    | void     |
| Line     | static lerp(p1, p2, t)          | Point2D  |
| -        | getBoundingRect(points)         | Rect2D   |

## Common Operations

### Vector from two points

```typescript
const direction = Vector2D.from(startX, startY, endX, endY);
const unit = direction.normalize();
```

### Point-in-rect test

```typescript
const rect = new Rect(x, y, width, height);
if (rect.hit(mouseX, mouseY)) {
  // Inside
}
```

### Bounding box from points

```typescript
const allPoints = contours.flatMap((c) => c.points);
const bounds = getBoundingRect(allPoints);
```

### Linear interpolation

```typescript
// t=0 returns p1, t=1 returns p2
const midpoint = Line.lerp(p1, p2, 0.5);
```

### Vector projection

```typescript
const v = new Vector2D(dragX, dragY);
const axis = new Vector2D(1, 0); // X axis
const projected = v.project(axis);
```

## Constraints and Invariants

1. **Immutability**: Vector operations always return new instances
2. **Math.hypot**: Used for all distance calculations (avoids overflow)
3. **Point2D vs Point**: Type for data, class for operations
4. **Rect2D Redundancy**: Both (x, y, w, h) and (left, top, right, bottom) provided
5. **Private Fields**: Classes use # private fields
