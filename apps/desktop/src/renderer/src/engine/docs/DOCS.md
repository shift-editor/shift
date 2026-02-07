# Engine

TypeScript facade wrapping the native Rust FontEngine with reactive state management.

## Overview

The engine layer provides a high-level TypeScript API for font editing, organizing functionality into specialized managers. It wraps the native NAPI bindings with reactive signals for automatic UI updates and centralized error handling.

## Architecture

```
FontEngine implements EngineCore
├── $glyph: Signal<GlyphSnapshot | null>
├── editing: EditingManager      (point/contour mutations, smart edits)
├── session: SessionManager      (edit session lifecycle)
├── info: InfoManager            (font metadata)
└── io: IOManager                (file operations)
    ↓
EngineCore interface { native, hasSession(), commit(), getGlyph(), emitGlyph() }
    ↓
window.shiftFont (Native NAPI via contextBridge)
```

### Key Design Decisions

1. **Interface-Based DI**: `FontEngine` implements `EngineCore` and passes `this` to managers. Managers depend on the `EngineCore` abstraction, enabling easy testing with mocks.
2. **Centralized Commit**: All native mutations flow through `commit()`, which parses JSON, checks for errors (throws `NativeOperationError` on failure), and updates the glyph signal. Callers never check `result.success`.
3. **Reactive Signal**: Single `$glyph` signal as source of truth for glyph state.
4. **Session Validation**: All editing managers validate session before operations.
5. **Typed Errors**: Custom error hierarchy for precise error handling.

## Key Concepts

### EngineCore Interface

The contract that `FontEngine` implements and managers depend on:

```typescript
interface EngineCore {
  readonly native: NativeFontEngine;
  hasSession(): boolean;
  getGlyph(): GlyphSnapshot | null;
  commit(operation: () => string): void;
  commit<T>(operation: () => string, extract: (result: CommandResult) => T): T;
  emitGlyph(glyph: GlyphSnapshot | null): void;
}
```

### FontEngine Class

Central orchestrator implementing `EngineCore`:

```typescript
const engine = new FontEngine();

// Reactive state - auto-updates UI
effect(() => {
  const glyph = engine.$glyph.value;
  renderGlyph(glyph);
});

// Manager access
engine.session.startEditSession(65);
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

- `startEditSession(unicode): void`
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
engine.session.startEditSession(65);

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
