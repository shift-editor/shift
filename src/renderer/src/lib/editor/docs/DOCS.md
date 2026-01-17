# Editor

Canvas-based glyph editor with dual rendering layers, viewport transforms, and selection management.

## Overview

The editor library provides the core visual editing experience for the Shift font editor. It implements a dual-canvas system (static and interactive layers), UPM coordinate transforms, point selection, and reactive rendering triggered by snapshot changes.

## Architecture

```
Editor
├── #staticContext: IGraphicContext      (outlines, guides, handles)
├── #interactiveContext: IGraphicContext (tool overlays)
├── #viewport: Viewport                  (coordinate transforms)
├── #scene: Scene                        (path building from snapshots)
├── #frameHandler: FrameHandler          (RAF scheduling)
├── #fontEngine: FontEngine              (state source)
├── #commandHistory: CommandHistory      (undo/redo)
├── #selection: SelectionManager         (point selection)
└── #snapshotEffect: Effect              (reactive redraw trigger)
```

### Key Design Decisions

1. **Dual Canvas**: Static layer for glyph, interactive layer for tools
2. **UPM Coordinates**: Font design space with Y-axis inversion
3. **Reactive Rendering**: Effects watch snapshot signal for redraws
4. **Functional Rendering**: Pure functions render from immutable snapshots

## Key Concepts

### Dual Canvas System

Two overlapping canvases for performance:

| Canvas | Content | Redraw Frequency |
|--------|---------|------------------|
| Static | Guides, outlines, handles | On snapshot change |
| Interactive | Tool overlays, selection rect | On mouse events |

### Coordinate Systems

Four coordinate spaces with transforms between them:

```
Screen (canvas pixels)
    ↓ DPR scaling
Device (physical pixels)
    ↓ Viewport transforms
Logical (canvas units)
    ↓ UPM transforms
UPM (font design units, Y-up)
```

### Viewport Transforms

```typescript
// Screen → UPM (for mouse events)
projectScreenToUpm(screenX, screenY): Point2D

// UPM → Screen (for rendering)
projectUpmToScreen(upmX, upmY): Point2D
```

### Selection Management

Three handle states based on selection:

```typescript
type HandleState = 'idle' | 'hovered' | 'selected';
type SelectionMode = 'preview' | 'committed';
```

## API Reference

### Editor
- `snapshot: GlyphSnapshot | null` - Current glyph state
- `selectedPoints: ReadonlySet<PointId>` - Selected point IDs
- `requestRedraw()` - Schedule redraw
- `projectScreenToUpm(x, y): Point2D` - Coordinate transform

### Viewport
- `pan(dx, dy)` - Pan canvas
- `zoomIn() / zoomOut()` - Zoom controls
- `setViewportRect(rect)` - Set canvas bounds
- `setViewportUpm(upm)` - Set units per em

### SelectionManager
- `select(id)` - Single selection
- `selectMultiple(ids)` - Multi-select
- `addToSelection(id)` - Add to selection
- `clearSelection()` - Deselect all
- `setHovered(id)` - Hover state

### Scene
- `setSnapshot(snapshot)` - Update glyph data
- `rebuildGlyphPath()` - Reconstruct path
- `glyphPath: Path2D` - Cached path

## Usage Examples

### Initialize Editor
```typescript
const editor = new Editor({
  staticContext,
  interactiveContext,
  fontEngine,
  commandHistory,
});

editor.setViewportRect(canvasBounds);
```

### Reactive Updates
```typescript
// Editor internally sets up:
effect(() => {
  const snapshot = fontEngine.snapshot.value;
  scene.setSnapshot(snapshot);
  requestRedraw();
});
```

### Coordinate Conversion
```typescript
canvas.onMouseMove = (e) => {
  const upmPos = editor.projectScreenToUpm(e.clientX, e.clientY);
  console.log(`Mouse at UPM: ${upmPos.x}, ${upmPos.y}`);
};
```

### Selection
```typescript
// Single select
editor.setSelectedPoints(new Set([pointId]));

// Add to selection (shift-click)
editor.addToSelection(pointId);

// Check state for rendering
const state = editor.getHandleState(pointId);
// 'idle' | 'hovered' | 'selected'
```

## Data Flow

```
FontEngine.snapshot changes
    ↓
Effect triggers (#snapshotEffect)
    ↓
Scene.setSnapshot(snapshot)
    ↓
Scene invalidates path cache
    ↓
Editor.requestRedraw()
    ↓
FrameHandler schedules RAF
    ↓
#draw() executes
    ├── #drawStatic()
    │   ├── Clear canvas
    │   ├── Apply transforms
    │   ├── Draw guides
    │   ├── Draw glyph outline
    │   ├── Draw bounding rect
    │   └── Draw handles
    └── #drawInteractive()
        └── tool.drawInteractive(ctx)
```

## Related Systems

- [engine](../../engine/docs/DOCS.md) - FontEngine state source
- [graphics](../graphics/docs/DOCS.md) - IRenderer abstraction
- [tools](../tools/docs/DOCS.md) - Tool implementations
- [commands](../commands/docs/DOCS.md) - Undo/redo integration
- [reactive](../reactive/docs/DOCS.md) - Signal-based updates
