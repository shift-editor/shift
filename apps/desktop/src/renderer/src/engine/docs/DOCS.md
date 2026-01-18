# Engine

TypeScript facade wrapping the native Rust FontEngine with reactive state management.

## Overview

The engine layer provides a high-level TypeScript API for font editing, organizing functionality into specialized managers. It wraps the native NAPI bindings with reactive signals for automatic UI updates and structured error handling.

## Architecture

```
FontEngine
├── snapshot: WritableSignal<GlyphSnapshot | null>
├── editing: EditingManager      (point/contour mutations)
├── editEngine: EditEngine       (unified rule-based edits)
├── session: SessionManager      (edit session lifecycle)
├── info: InfoManager            (font metadata)
├── history: HistoryManager      (undo/redo tracking)
└── io: IOManager                (file operations)
    ↓
Shared Context { native, hasSession(), emitSnapshot() }
    ↓
window.shiftFont (Native NAPI via contextBridge)
```

### Key Design Decisions

1. **Manager Pattern**: Domain-specific managers share context via dependency injection
2. **Reactive Snapshot**: Single signal source of truth for glyph state
3. **Session Validation**: All managers validate session before operations
4. **Typed Errors**: Custom error hierarchy for precise error handling

## Key Concepts

### FontEngine Class

Central orchestrator managing all editing functionality:

```typescript
const engine = new FontEngine();

// Reactive state - auto-updates UI
effect(() => {
  const snapshot = engine.snapshot.value;
  renderGlyph(snapshot);
});

// Manager access
engine.session.startEditSession(65);
engine.editing.addPoint(100, 200, 'onCurve', false);
```

### Shared Context

All managers receive identical context for coordination:

```typescript
const ctx = {
  native: window.shiftFont,           // NAPI bindings
  hasSession: () => session.isActive(), // Session check
  emitSnapshot: (s) => snapshot.set(s), // State updates
};
```

### Segment Parsing

Converts snapshot points to renderable path segments:

```typescript
const segments = parseSegments(contour.points, contour.closed);
// Returns: LineSegment | QuadSegment | CubicSegment[]
```

## API Reference

### FontEngine
- `snapshot: WritableSignal<GlyphSnapshot | null>` - Reactive glyph state
- `editing: EditingManager` - Point/contour operations
- `editEngine: EditEngine` - Unified edits with rules
- `session: SessionManager` - Session lifecycle
- `info: InfoManager` - Font metadata
- `history: HistoryManager` - Undo/redo
- `io: IOManager` - File I/O

### EditingManager
- `addPoint(x, y, type, smooth): PointId`
- `addContour(): ContourId`
- `movePoints(ids, dx, dy): void`
- `removePoints(ids): void`
- `toggleSmooth(id): void`

### SessionManager
- `startEditSession(unicode): void`
- `endEditSession(): void`
- `isActive(): boolean`

### InfoManager
- `getMetadata(): FontMetadata`
- `getMetrics(): FontMetrics`
- `getGlyphCount(): number`

### Errors
- `FontEngineError` - Base error class
- `NoEditSessionError` - Operation requires session
- `NativeOperationError` - Rust operation failed

## Usage Examples

### Basic Workflow
```typescript
const engine = createFontEngine();

// Load and start editing
engine.io.loadFont('/path/to/font.ufo');
engine.session.startEditSession(65);

// React to changes
effect(() => {
  const snapshot = engine.snapshot.value;
  if (snapshot) redraw(snapshot);
});

// Add geometry
const contourId = engine.editing.addContour();
const pointId = engine.editing.addPoint(100, 200, 'onCurve', false);

// Apply rule-driven edits
const affected = engine.editEngine.applyEdits(
  new Set([pointId]),
  50, 0
);
```

### Segment Rendering
```typescript
const snapshot = engine.snapshot.value;
const segmentMap = parseGlyphSegments(snapshot.contours);

for (const [contourId, segments] of segmentMap) {
  for (const segment of segments) {
    switch (segment.type) {
      case 'line': drawLine(segment.start, segment.end); break;
      case 'quad': drawQuad(segment.start, segment.cp, segment.end); break;
      case 'cubic': drawCubic(segment.start, segment.cp1, segment.cp2, segment.end); break;
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
Validate Session (ctx.hasSession())
    ↓
Call Native (ctx.native.addPoint())
    ↓
Parse JSON CommandResult
    ↓
Emit Snapshot (ctx.emitSnapshot())
    ↓
Signal Notifies Subscribers
    ↓
UI Updates Automatically
```

## Related Systems

- [shift-node](../../../crates/shift-node/docs/DOCS.md) - Native NAPI bindings
- [preload](../../preload/docs/DOCS.md) - Context bridge exposure
- [reactive](../lib/reactive/docs/DOCS.md) - Signal system
- [editor](../lib/editor/docs/DOCS.md) - Canvas rendering
