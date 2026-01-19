# Graphics - LLM Context

## Quick Facts

- **Purpose**: Rendering abstraction with Canvas 2D backend and path caching
- **Language**: TypeScript
- **Key Files**: `Path.ts`, `backends/Canvas2DRenderer.ts`, `style.ts`
- **Dependencies**: None (standalone)
- **Dependents**: lib/editor, lib/tools

## File Structure

```
src/renderer/src/lib/graphics/
├── Path.ts                         # ShiftPath2D class
├── style.ts                        # DrawStyle presets
└── backends/
    ├── Canvas2DRenderer.ts         # Canvas 2D implementation
    └── errors.ts                   # Error classes
```

## Core Abstractions

### IRenderer (types/graphics.ts)

```typescript
interface IRenderer {
  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
  antiAlias: boolean;
  dashPattern: number[];

  save(): void;
  restore(): void;
  flush(): void;
  clear(): void;

  drawLine(x0, y0, x1, y1): void;
  fillRect(x, y, w, h): void;
  strokeRect(x, y, w, h): void;
  fillCircle(x, y, r): void;
  strokeCircle(x, y, r): void;

  createPath(): IPath;
  beginPath(): void;
  moveTo(x, y): void;
  lineTo(x, y): void;
  quadTo(cpx, cpy, x, y): void;
  cubicTo(cp1x, cp1y, cp2x, cp2y, x, y): void;
  arcTo(x, y, r, start, end, ccw?): void;
  closePath(): void;
  stroke(path?: IPath): void;
  fill(path?: IPath): void;

  scale(x, y): void;
  translate(x, y): void;
  transform(a, b, c, d, e, f): void;
}
```

### Path2D / ShiftPath2D (Path.ts)

```typescript
class Path2D {
  #commands: PathCommand[] = [];
  invalidated = false;

  moveTo(x: number, y: number): void {
    this.#commands.push({ type: "moveTo", x, y });
  }

  lineTo(x: number, y: number): void {
    this.#commands.push({ type: "lineTo", x, y });
  }

  cubicTo(cp1x, cp1y, cp2x, cp2y, x, y): void {
    this.#commands.push({ type: "cubicTo", cp1x, cp1y, cp2x, cp2y, x, y });
  }

  clear(): void {
    this.#commands = [];
    this.invalidated = true;
  }

  get commands(): readonly PathCommand[] {
    return this.#commands;
  }
}
```

### PathCommand (types/graphics.ts)

```typescript
type PathCommand =
  | { type: "moveTo"; x: number; y: number }
  | { type: "lineTo"; x: number; y: number }
  | { type: "quadTo"; cp1x: number; cp1y: number; x: number; y: number }
  | {
      type: "cubicTo";
      cp1x: number;
      cp1y: number;
      cp2x: number;
      cp2y: number;
      x: number;
      y: number;
    }
  | { type: "close" };
```

### Canvas2DRenderer (backends/Canvas2DRenderer.ts)

```typescript
class Canvas2DRenderer implements IRenderer {
  #ctx: CanvasRenderingContext2D;
  #cachedPaths: Map<ShiftPath2D, Path2D> = new Map();

  stroke(path?: ShiftPath2D | IPath): void {
    if (path instanceof ShiftPath2D) {
      let cached = this.#cachedPaths.get(path);
      if (!cached || path.invalidated) {
        cached = this.#constructPath(path);
        this.#cachedPaths.set(path, cached);
        path.invalidated = false;
      }
      this.#ctx.stroke(cached);
    }
  }

  #constructPath(path: ShiftPath2D): Path2D {
    const native = new Path2D();
    for (const cmd of path.commands) {
      switch (cmd.type) {
        case 'moveTo': native.moveTo(cmd.x, cmd.y); break;
        case 'lineTo': native.lineTo(cmd.x, cmd.y); break;
        case 'cubicTo': native.bezierCurveTo(...); break;
        // etc.
      }
    }
    return native;
  }
}
```

## Key Patterns

### Path Caching with Invalidation

```typescript
// Scene marks path dirty when snapshot changes
glyphPath.invalidated = true;

// Renderer checks flag before using cache
if (!cached || path.invalidated) {
  cached = this.#constructPath(path);
  this.#cachedPaths.set(path, cached);
  path.invalidated = false; // Reset flag after rebuild
}
```

### Style Application

```typescript
setStyle(style: DrawStyle): void {
  this.lineWidth = style.lineWidth;
  this.strokeStyle = style.strokeStyle;
  this.fillStyle = style.fillStyle;
  if (style.dashPattern) {
    this.#ctx.setLineDash(style.dashPattern);
  }
}
```

## API Surface

| Class            | Method                | Purpose             |
| ---------------- | --------------------- | ------------------- |
| Canvas2DContext  | getContext()          | Get IRenderer       |
| Canvas2DContext  | resizeCanvas()        | Handle resize       |
| Canvas2DRenderer | stroke(path)          | Stroke with caching |
| Canvas2DRenderer | fill(path)            | Fill with caching   |
| Canvas2DRenderer | transform(...)        | Apply 2D transform  |
| Path2D           | moveTo/lineTo/cubicTo | Build path          |
| Path2D           | clear()               | Reset + invalidate  |

## Common Operations

### Create and draw path

```typescript
const path = new Path2D();
path.moveTo(0, 0);
path.lineTo(100, 100);
path.closePath();

ctx.stroke(path);
```

### Apply transforms

```typescript
ctx.save();
ctx.transform(1, 0, 0, -1, 0, height); // Flip Y
ctx.stroke(path);
ctx.restore();
```

### Use style presets

```typescript
ctx.setStyle(GUIDE_STYLES);
ctx.drawLine(0, baseline, width, baseline);
```

### Invalidate and rebuild

```typescript
// When glyph changes:
scene.glyphPath.clear();
// ... rebuild commands ...
scene.glyphPath.invalidated = true;
// Next stroke() will rebuild native path
```

## Style Presets (style.ts)

```typescript
const DEFAULT_STYLES = { lineWidth: 0.75, strokeStyle: '#000', fillStyle: '#fff' };
const GUIDE_STYLES = { lineWidth: 1, strokeStyle: '#0066ff', dashPattern: [] };
const SELECTION_RECTANGLE_STYLES = { strokeStyle: 'rgba(0, 102, 255, 0.5)' };
const BOUNDING_RECTANGLE_STYLES = { strokeStyle: '#999', dashPattern: [4, 4] };
const HANDLE_STYLES = {
  corner: { idle: {...}, hovered: {...}, selected: {...} },
  smooth: { idle: {...}, hovered: {...}, selected: {...} },
  // etc.
};
```

## Constraints and Invariants

1. **Cache Invalidation**: Must set `invalidated = true` when path changes
2. **State Stack**: save()/restore() must be balanced
3. **Transform Order**: Transforms apply in reverse order of calls
4. **Native Path Lifetime**: Cached paths live until invalidated
5. **Clear Resets Commands**: path.clear() empties command array
