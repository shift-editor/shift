# Graphics

Rendering abstraction layer with Canvas 2D backend and path caching.

## Overview

The graphics library provides a renderer-agnostic interface for 2D drawing operations. It implements the IRenderer abstraction with a Canvas 2D backend, including efficient path caching to avoid reconstructing native paths on every frame.

## Architecture

```
IRenderer (Interface)
├── State: lineWidth, strokeStyle, fillStyle, dashPattern
├── Lifecycle: save(), restore(), flush(), clear()
├── Drawing: drawLine(), fillRect(), strokeCircle(), etc.
├── Paths: createPath(), stroke(path), fill(path)
└── Transforms: scale(), translate(), transform()

Canvas2DRenderer (Implementation)
├── #ctx: CanvasRenderingContext2D
├── #cachedPaths: Map<ShiftPath2D, Path2D>
└── Path cache invalidation on path.invalidated
```

### Key Design Decisions

1. **Interface Abstraction**: IRenderer allows future backend swaps
2. **Path Caching**: Native Path2D objects cached until invalidated
3. **Invalidation Flags**: Paths track dirty state for efficient rebuilds
4. **Style Objects**: DrawStyle bundles stroke/fill/line settings

## Key Concepts

### IRenderer Interface

Complete drawing API with state management:

```typescript
interface IRenderer {
  // State
  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  dashPattern: number[];

  // Lifecycle
  save(): void;
  restore(): void;
  clear(): void;

  // Drawing
  drawLine(x0, y0, x1, y1): void;
  fillRect(x, y, w, h): void;
  fillCircle(x, y, r): void;
  stroke(path?: IPath): void;
  fill(path?: IPath): void;

  // Transforms
  transform(a, b, c, d, e, f): void;
}
```

### Path2D (ShiftPath2D)

Custom path class with command queue and invalidation:

```typescript
class Path2D {
  #commands: PathCommand[];
  invalidated: boolean;

  moveTo(x, y): void;
  lineTo(x, y): void;
  quadTo(cpx, cpy, x, y): void;
  cubicTo(cp1x, cp1y, cp2x, cp2y, x, y): void;
  closePath(): void;
  clear(): void;
}
```

### Path Caching

Renderer caches native paths and rebuilds on invalidation:

```typescript
stroke(path: ShiftPath2D): void {
  let nativePath = this.#cachedPaths.get(path);

  if (!nativePath || path.invalidated) {
    nativePath = this.#constructPath(path);
    this.#cachedPaths.set(path, nativePath);
    path.invalidated = false;
  }

  this.#ctx.stroke(nativePath);
}
```

## API Reference

### IGraphicContext
- `resizeCanvas(canvas, rect)` - Handle resize
- `getContext(): IRenderer` - Get renderer
- `destroy()` - Cleanup

### IRenderer
- `save() / restore()` - State stack
- `clear()` - Clear canvas
- `drawLine(x0, y0, x1, y1)` - Draw line
- `fillRect(x, y, w, h)` - Fill rectangle
- `strokeRect(x, y, w, h)` - Stroke rectangle
- `fillCircle(x, y, r)` - Fill circle
- `strokeCircle(x, y, r)` - Stroke circle
- `stroke(path?)` - Stroke path
- `fill(path?)` - Fill path
- `transform(a, b, c, d, e, f)` - 2D transform

### DrawStyle
```typescript
interface DrawStyle {
  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  dashPattern: number[];
}
```

## Usage Examples

### Basic Drawing
```typescript
const ctx = graphicContext.getContext();

ctx.save();
ctx.lineWidth = 2;
ctx.strokeStyle = '#000000';
ctx.drawLine(0, 0, 100, 100);
ctx.restore();
```

### Path Operations
```typescript
const path = ctx.createPath();
path.moveTo(0, 0);
path.lineTo(100, 0);
path.lineTo(100, 100);
path.closePath();

ctx.fillStyle = '#ff0000';
ctx.fill(path);
ctx.stroke(path);
```

### Using ShiftPath2D
```typescript
const glyphPath = new Path2D();
glyphPath.moveTo(0, 0);
glyphPath.cubicTo(25, 50, 75, 50, 100, 0);

// Later, when glyph changes:
glyphPath.invalidated = true;
// Next render will rebuild native path
```

### Style Presets
```typescript
import { GUIDE_STYLES, HANDLE_STYLES } from './style';

ctx.setStyle(GUIDE_STYLES);
ctx.stroke(guidePath);

ctx.setStyle(HANDLE_STYLES.corner.idle);
ctx.fillRect(x - 4, y - 4, 8, 8);
```

## Data Flow

```
Scene builds Path2D from snapshot
    ↓
Path2D stores commands + invalidated flag
    ↓
Editor calls ctx.stroke(path)
    ↓
Canvas2DRenderer checks cache
    ├── Cache hit + !invalidated → use cached native Path2D
    └── Cache miss or invalidated → rebuild native Path2D
        ↓
    Store in cache, set invalidated = false
        ↓
    ctx.stroke(nativePath)
```

## Related Systems

- [editor](../editor/docs/DOCS.md) - Uses IRenderer for drawing
- [tools](../tools/docs/DOCS.md) - Tools draw overlays
- [handles](../editor/docs/DOCS.md) - Handle rendering uses primitives
