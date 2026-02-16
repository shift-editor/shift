# Engine

TypeScript facade wrapping the native Rust FontEngine with reactive state management.

## Overview

The engine layer provides a high-level TypeScript API for font editing, organizing functionality into specialized managers. It wraps the native NAPI bindings with reactive signals for automatic UI updates and centralized error handling.

## Architecture

```
FontEngine implements EditingEngineDeps, SessionEngineDeps, InfoEngineDeps, IOEngineDeps
├── $glyph: Signal<GlyphSnapshot | null>
├── editing: EditingManager      (point/contour mutations, smart edits)
├── session: SessionManager      (edit session lifecycle)
├── info: InfoManager            (font metadata)
└── io: IOManager                (file operations)
    ↓
Per-manager dep interfaces (focused slices of FontEngine)
    ↓
window.shiftFont (Native NAPI via contextBridge)
```

### Key Design Decisions

1. **Per-Manager Dep Interfaces**: Each manager declares a focused deps interface (`EditingEngineDeps`, `SessionEngineDeps`, etc.) for exactly the methods it uses. `FontEngine` implements all of them and passes `this` to each manager.
2. **Centralized Commit**: All native mutations flow through `commit()`, which parses JSON, checks for errors (throws `NativeOperationError` on failure), and updates the glyph signal. Callers never check `result.success`.
3. **Reactive Signal**: Single `$glyph` signal as source of truth for glyph state.
4. **Session Validation**: All editing managers validate session before operations.
5. **Typed Errors**: Custom error hierarchy for precise error handling.

## Key Concepts

### Per-Manager Dep Interfaces

Each manager declares a focused deps interface for exactly the methods it uses:

- `EditingEngineDeps` — raw API, session check, glyph access, snapshot restore, paste
- `SessionEngineDeps` — session lifecycle, snapshot, glyph emit
- `InfoEngineDeps` — metadata, metrics, glyph queries
- `IOEngineDeps` — load/save

### FontEngine Class

Central orchestrator implementing all dep interfaces:

```typescript
const engine = new FontEngine();

// Reactive state - auto-updates UI
effect(() => {
  const glyph = engine.$glyph.value;
  renderGlyph(glyph);
});

// Manager access
engine.session.startEditSession({ glyphName: "A", unicode: 65 });
engine.editing.addPoint({ id: "" as PointId, x: 100, y: 200, pointType: "onCurve", smooth: false });
```

### commit() — Centralized State Transitions

All native mutations flow through `commit()`:

```typescript
// Void operations (most editing methods):
this.#engine.commit(() => this.#engine.native.closeContour());

// Extraction operations (returns a value from the result):
return this.#engine.commit(
  () => this.#engine.native.addContour(),
  (result) => asContourId(result.snapshot?.activeContourId ?? ""),
);
```

`commit()` handles:

- Calling the native operation and parsing the JSON result
- Throwing `NativeOperationError` if `result.success` is false
- Updating the `$glyph` signal if the result includes a snapshot

### Bridge Types

Native types are imported from the shared bridge:

```typescript
import type { FontEngineAPI } from "@shared/bridge/FontEngineAPI";
```

See [bridge docs](../../../shared/bridge/docs/DOCS.md) for type-safe bridge architecture.

### Segment Parsing

Converts snapshot points to renderable path segments:

```typescript
const segments = parseSegments(contour.points, contour.closed);
// Returns: LineSegment | QuadSegment | CubicSegment[]
```

## API Reference

### FontEngine

- `$glyph: Signal<GlyphSnapshot | null>` - Reactive glyph state
- `editing: EditingManager` - Point/contour operations and smart edits
- `session: SessionManager` - Session lifecycle
- `info: InfoManager` - Font metadata
- `io: IOManager` - File I/O

### EditingManager

- `addPoint(edit): PointId`
- `addContour(): ContourId`
- `movePoints(ids, delta): PointId[]`
- `removePoints(ids): void`
- `toggleSmooth(id): void`
- `applySmartEdits(selectedPoints, dx, dy): PointId[]` - Constraint-aware edits

### SessionManager

- `startEditSession(glyph): void`
- `endEditSession(): void`
- `isActive(): boolean`

### InfoManager

- `getMetadata(): FontMetadata`
- `getMetrics(): FontMetrics`
- `getGlyphCount(): number`
- `getGlyphUnicodes(): number[]`
- `getGlyphSvgPath(unicode): string | null`
- `getGlyphAdvance(unicode): number | null`
- `getGlyphBbox(unicode): [number, number, number, number] | null`

### Errors

- `FontEngineError` - Base error class
- `NoEditSessionError` - Operation requires session
- `NativeOperationError` - Rust operation failed (thrown by `commit()`)

## Usage Examples

### Basic Workflow

```typescript
const engine = createFontEngine();

// Load and start editing
engine.io.loadFont("/path/to/font.ufo");
engine.session.startEditSession({ glyphName: "A", unicode: 65 });

// React to changes
effect(() => {
  const glyph = engine.$glyph.value;
  if (glyph) redraw(glyph);
});

// Add geometry
const contourId = engine.editing.addContour();
const pointId = engine.editing.addPoint({
  id: "" as PointId,
  x: 100,
  y: 200,
  pointType: "onCurve",
  smooth: false,
});

// Apply constraint-aware edits (uses Rust rule engine)
const affected = engine.editing.applySmartEdits(new Set([pointId]), 50, 0);
```

### Segment Rendering

```typescript
const glyph = engine.$glyph.value;
const segmentMap = parseGlyphSegments(glyph.contours);

for (const [contourId, segments] of segmentMap) {
  for (const segment of segments) {
    switch (segment.type) {
      case "line":
        drawLine(segment.start, segment.end);
        break;
      case "quad":
        drawQuad(segment.start, segment.cp, segment.end);
        break;
      case "cubic":
        drawCubic(segment.start, segment.cp1, segment.cp2, segment.end);
        break;
    }
  }
}
```

## Data Flow

```
User Action
    ↓
Manager Method (e.g., editing.addPoint())
    ↓
Validate Session (#requireSession)
    ↓
commit(operation, extract?)
    ↓
Call Native (engine.native.addPoint())
    ↓
Parse JSON CommandResult
    ↓
Check success (throw NativeOperationError on failure)
    ↓
Emit Snapshot (engine.$glyph.set())
    ↓
Signal Notifies Subscribers
    ↓
UI Updates Automatically
```

## Related Systems

- [bridge](../../../shared/bridge/docs/DOCS.md) - Type-safe bridge definitions
- [shift-node](../../../crates/shift-node/docs/DOCS.md) - Native NAPI bindings
- [preload](../../preload/docs/DOCS.md) - Context bridge exposure
- [reactive](../lib/reactive/docs/DOCS.md) - Signal system
- [editor](../lib/editor/docs/DOCS.md) - Canvas rendering
