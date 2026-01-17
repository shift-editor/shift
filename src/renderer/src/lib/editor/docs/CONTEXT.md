# Editor - LLM Context

## Quick Facts
- **Purpose**: Canvas-based glyph editor with dual layers, transforms, and selection
- **Language**: TypeScript
- **Key Files**: `Editor.ts`, `Viewport.ts`, `Scene.ts`, `SelectionManager.ts`, `handles/`
- **Dependencies**: engine, graphics, reactive, commands
- **Dependents**: views/Editor.tsx, tools

## File Structure
```
src/renderer/src/lib/editor/
├── Editor.ts              # Main orchestrator (665 lines)
├── Scene.ts               # Path building from snapshots (225 lines)
├── Viewport.ts            # Coordinate transforms (226 lines)
├── SelectionManager.ts    # Selection state (111 lines)
├── FrameHandler.ts        # RAF scheduling (32 lines)
├── render.ts              # Rendering utilities (232 lines)
└── handles/
    ├── index.ts           # Handle API exports
    ├── renderers.ts       # Handle draw functions (122 lines)
    ├── primitives.ts      # Geometric primitives (57 lines)
    └── constants.ts       # Handle dimensions (7 lines)
```

## Core Abstractions

### Editor (Editor.ts:65-100)
```typescript
class Editor {
  #staticContext: IGraphicContext | null;
  #interactiveContext: IGraphicContext | null;
  #viewport: Viewport;
  #scene: Scene;
  #frameHandler: FrameHandler;
  #fontEngine: FontEngine;
  #commandHistory: CommandHistory;
  #selection: SelectionManager;
  #snapshotEffect: Effect;
}
```

### Viewport (Viewport.ts)
```typescript
class Viewport {
  #upm = 1000;        // Units per em
  #padding = 300;     // UPM margin
  #zoom = 1;          // Zoom level (0.1-6)
  #panX, #panY = 0;   // Pan offset
  #dpr = 1;           // Device pixel ratio

  projectScreenToUpm(x: number, y: number): Point2D;
  projectUpmToScreen(x: number, y: number): Point2D;
}
```

### Scene (Scene.ts)
```typescript
class Scene {
  readonly snapshot: WritableSignal<GlyphSnapshot | null>;
  readonly needsRebuild: ComputedSignal<boolean>;
  #glyphPath: Path2D;
  #lastBuiltSnapshot: GlyphSnapshot | null;

  setSnapshot(snapshot: GlyphSnapshot | null): void;
  rebuildGlyphPath(): void;
}
```

### SelectionManager (SelectionManager.ts)
```typescript
class SelectionManager {
  #selectedPoints = new Set<PointId>();
  #hoveredPoint: PointId | null = null;
  #mode: SelectionMode = 'committed';

  getHandleState(pointId: PointId): HandleState;
}
```

## Key Patterns

### Transform Stack (Editor.ts:440-478)
```typescript
#applyUserTransforms(ctx: IRenderer): void {
  // Zoom + pan around canvas center
  const { zoom, panX, panY, centerX, centerY } = this.#viewport;
  ctx.transform(zoom, 0, 0, zoom, panX + centerX*(1-zoom), panY + centerY*(1-zoom));
}

#applyUpmTransforms(ctx: IRenderer): void {
  // Flip Y-axis + apply padding
  const { padding, logicalHeight } = this.#viewport;
  ctx.transform(1, 0, 0, -1, padding, logicalHeight - padding);
}
```

### Reactive Redraw (Editor.ts:109-115)
```typescript
this.#snapshotEffect = effect(() => {
  const snapshot = this.#fontEngine.snapshot.value;
  this.#scene.setSnapshot(snapshot);
  this.requestRedraw();
});
```

### Handle Rendering (Editor.ts:558-633)
```typescript
#drawHandlesFromSnapshot(ctx: IRenderer, snapshot: GlyphSnapshot): void {
  for (const contour of snapshot.contours) {
    for (let idx = 0; idx < contour.points.length; idx++) {
      const point = contour.points[idx];
      const handleState = this.getHandleState(asPointId(point.id));

      // Determine handle type based on position & properties
      let handleType: HandleType;
      if (idx === 0 && contour.closed) handleType = 'direction';
      else if (idx === 0) handleType = 'first';
      else if (point.pointType === 'offCurve') handleType = 'control';
      else if (point.smooth) handleType = 'smooth';
      else handleType = 'corner';

      this.paintHandle(ctx, point.x, point.y, handleType, handleState);
    }
  }
}
```

## API Surface

| Class | Method | Purpose |
|-------|--------|---------|
| Editor | requestRedraw() | Schedule RAF redraw |
| Editor | projectScreenToUpm(x, y) | Coordinate transform |
| Editor | setSelectedPoints(ids) | Update selection |
| Editor | getHandleState(id) | Get render state |
| Editor | createToolContext() | Context for tools |
| Viewport | pan(dx, dy) | Pan canvas |
| Viewport | zoomIn() / zoomOut() | Zoom controls |
| Scene | setSnapshot(s) | Update glyph |
| Scene | rebuildGlyphPath() | Rebuild Path2D |
| SelectionManager | select(id) | Single select |
| SelectionManager | addToSelection(id) | Multi-select |

## Common Operations

### Setup editor
```typescript
const editor = new Editor({
  staticContext,
  interactiveContext,
  fontEngine,
  commandHistory,
});
editor.setViewportRect(bounds);
```

### Handle mouse events
```typescript
const upmPos = editor.projectScreenToUpm(e.clientX, e.clientY);
const pointId = hitTest(upmPos, snapshot);
if (pointId) editor.addToSelection(pointId);
```

### Draw cycle
```typescript
// Automatic via effect, or manual:
editor.requestRedraw();
// -> FrameHandler schedules RAF
// -> #draw() calls #drawStatic() + #drawInteractive()
```

### Tool context
```typescript
const ctx = editor.createToolContext();
// ctx.snapshot, ctx.selectedPoints, ctx.viewport, ctx.mousePosition
// ctx.setSelectedPoints(), ctx.requestRedraw(), etc.
```

## Constraints and Invariants

1. **UPM Y-Up**: Font coordinates have Y increasing upward (inverted from screen)
2. **Dual Canvas**: Static redraws on snapshot change, interactive on mouse events
3. **RAF Batching**: Multiple requestRedraw() calls batch into single frame
4. **Effect Cleanup**: snapshotEffect disposed on editor.destroy()
5. **Transform Order**: User transforms (zoom/pan) applied before UPM transforms
6. **Handle Types**: Determined by point position, type, and smooth flag
