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
2. **Matrix Transforms**: 2D affine matrices for all coordinate transformations
3. **Reactive Matrices**: Computed signals auto-invalidate when dependencies change
4. **UPM Coordinates**: Font design space with Y-axis inversion
5. **Reactive Rendering**: Effects watch snapshot signal for redraws
6. **Functional Rendering**: Pure functions render from immutable snapshots

## Key Concepts

### Dual Canvas System

Two overlapping canvases for performance:

| Canvas      | Content                       | Redraw Frequency   |
| ----------- | ----------------------------- | ------------------ |
| Static      | Guides, outlines, handles     | On snapshot change |
| Interactive | Tool overlays, selection rect | On mouse events    |

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

### Matrix Transform System

The Shift editor uses **2D affine transformation matrices** (3x2 representation) for all coordinate transformations. This provides a solid foundation for current features and future transforms (rotation, reflection, skew).

#### Overview

```typescript
// 2D Affine Matrix (3x2 representation)
// Represents: | a  c  e |
//             | b  d  f |
//             | 0  0  1 | (implicit)

const m = Mat.Identity() // Create identity matrix
  .translate(100, 50) // Translate
  .scale(2, 3) // Scale
  .rotate(Math.PI / 4); // Rotate (future)

// Transform a point
const point = Mat.applyToPoint(m, { x: 10, y: 20 });

// Compose matrices
const composed = Mat.Compose(m1, m2);

// Invert matrix
const inverse = Mat.Inverse(m);
```

#### Transformation Pipeline

**UPM → Screen Transform:**

1. Scale to canvas space and flip Y-axis
2. Position baseline at padding
3. Apply zoom around canvas center
4. Apply pan offset

```typescript
// Example: baseline at 600px, scale 0.4 UPM/px, zoom 1.5, pan (50, 0)
upmTransform = Identity.translate(300, 600) // Position baseline
  .scale(0.4, -0.4); // Scale and flip Y

screenTransform = Identity.translate(50, 0) // Pan
  .scale(1.5, 1.5); // Zoom

result = Compose(screenTransform, upmTransform);
```

**Screen → UPM Transform:**

- Inverse of UPM → Screen
- Applied to mouse events to convert screen coordinates to UPM space

#### Zoom-to-Cursor

The `zoomToPoint(screenX, screenY, zoomDelta)` algorithm maintains the UPM coordinate under the cursor:

```typescript
1. Record UPM at cursor BEFORE zoom
2. Apply zoom factor to viewport
3. Calculate UPM at cursor AFTER zoom (matrices recompute automatically)
4. Adjust pan to compensate for UPM drift
```

This ensures smooth zooming that "follows" the cursor, creating an intuitive zoom experience.

#### Future Transform Support

The matrix system already supports additional transforms needed for future features:

```typescript
// Rotation (already implemented in Mat.rotate)
const rotated = Mat.Rotate(Math.PI / 4);

// Reflection (via negative scale)
const flipX = Mat.Scale(-1, 1);
const flipY = Mat.Scale(1, -1);

// Skew (modify matrix components)
const skewed = Mat.Identity();
skewed.c = Math.tan(angleX); // X-axis skew
```

### Selection Management

Three handle states based on selection:

```typescript
type HandleState = "idle" | "hovered" | "selected";
type SelectionMode = "preview" | "committed";
```

## API Reference

### Editor

- `snapshot: GlyphSnapshot | null` - Current glyph state
- `selectedPoints: ReadonlySet<PointId>` - Selected point IDs
- `requestRedraw()` - Schedule redraw
- `projectScreenToUpm(x, y): Point2D` - Coordinate transform

### Viewport

- `pan(dx, dy)` - Pan canvas
- `zoomIn() / zoomOut()` - Zoom to canvas center (1.25x / 0.8x)
- `zoomToPoint(screenX, screenY, zoomDelta)` - Zoom toward cursor position
- `projectScreenToUpm(x, y): Point2D` - Screen to UPM transform
- `projectUpmToScreen(x, y): Point2D` - UPM to screen transform
- `getUpmToScreenMatrix(): Mat` - Get transformation matrix
- `getScreenToUpmMatrix(): Mat` - Get inverse transformation matrix
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

## Winding and Fill Rules

Font glyphs use the **nonzero winding rule** for fills. This determines how overlapping contours create holes (like the inside of an "O").

### Winding Conventions

In font coordinate space (Y-up):

- **Outer contours**: counter-clockwise winding
- **Inner contours (holes)**: clockwise winding

The editor applies a Y-axis flip (`-scale`) to convert from font coords to screen coords. This reverses the visual winding direction, but the nonzero rule still works correctly.

### Path Building Pattern

All contours must be built into a **single path** before calling `fill()`:

```typescript
// Correct: single path, single fill
ctx.beginPath();
for (const contour of snapshot.contours) {
  buildContourPath(ctx, contour);
}
ctx.fill();

// Wrong: fills each contour separately (holes render as solid)
for (const contour of snapshot.contours) {
  ctx.beginPath();
  buildContourPath(ctx, contour);
  ctx.fill();
}
```

### API Design

`buildContourPath(ctx, contour)` is a pure path-building function:

- Does **not** call `beginPath()` - caller owns path lifecycle
- Adds contour segments to the current path via `moveTo`, `lineTo`, `cubicTo`, `closePath`
- Returns `true` if contour is closed

Higher-level functions like `renderGlyph()` handle the full lifecycle:

```typescript
ctx.beginPath();
// ... build all contours
ctx.stroke(); // or ctx.fill()
```

## Related Systems

- [engine](../../engine/docs/DOCS.md) - FontEngine state source
- [graphics](../graphics/docs/DOCS.md) - IRenderer abstraction
- [tools](../tools/docs/DOCS.md) - Tool implementations
- [commands](../commands/docs/DOCS.md) - Undo/redo integration
- [reactive](../reactive/docs/DOCS.md) - Signal-based updates
