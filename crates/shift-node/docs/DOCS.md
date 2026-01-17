# shift-node

NAPI bindings exposing the Rust shift-core library to Node.js/Electron.

## Overview

shift-node provides a JavaScript-accessible FontEngine class that wraps shift-core's editing functionality. It uses NAPI-RS for efficient native bindings and supports both JSON serialization and native object passing for optimal performance.

## Architecture

```
JavaScript/TypeScript (Renderer)
         ↓
    window.shiftFont (contextBridge)
         ↓
    Preload Script
         ↓
    shift-node (NAPI)
         ↓
    FontEngine class
         ↓
    shift-core (Rust)
```

### Key Design Decisions

1. **Dual Serialization**: JSON strings for complex results, native objects for snapshots
2. **String IDs**: Entity IDs converted to strings for JavaScript interop
3. **Session-Based API**: All editing requires an active session
4. **CommandResult Pattern**: All mutations return success/error with affected state

## Key Concepts

### FontEngine Class

The main NAPI-exported class managing font state:

```typescript
class FontEngine {
  loadFont(path: string): void
  startEditSession(unicode: number): void
  endEditSession(): void
  getSnapshot(): string | null        // JSON
  getSnapshotData(): NativeGlyphSnapshot  // Native object
  addPoint(x, y, pointType, smooth): string
  movePoints(pointIds, dx, dy): string
  applyEditsUnified(pointIds, dx, dy): string
}
```

### Native vs JSON Serialization

Two approaches for different use cases:

| Method | Return Type | Use Case |
|--------|-------------|----------|
| `getSnapshot()` | JSON string | Full serialization needed |
| `getSnapshotData()` | Native object | Efficient frequent reads |

### CommandResult Format

All mutations return JSON with consistent structure:

```typescript
{
  success: boolean,
  snapshot: GlyphSnapshot | null,
  error: string | null,
  affectedPointIds: string[],
  canUndo: boolean,
  canRedo: boolean
}
```

## API Reference

### Font Loading
- `loadFont(path: string)` - Load font from filesystem

### Session Management
- `startEditSession(unicode: number)` - Begin editing glyph
- `endEditSession()` - Save and close session
- `hasEditSession(): boolean` - Check session state
- `getEditingUnicode(): number | null` - Current glyph

### Font Info
- `getMetadata(): FontMetadata` - Family, style, version
- `getMetrics(): FontMetrics` - UPM, ascender, descender, etc.
- `getGlyphCount(): number` - Total glyphs

### Contour Operations
- `addEmptyContour(): string` - Create contour, set active
- `addContour(): string` - Create contour
- `getActiveContourId(): string | null` - Current active
- `closeContour(): string` - Close active contour

### Point Operations
- `addPoint(x, y, pointType, smooth): string`
- `addPointToContour(contourId, x, y, pointType, smooth): string`
- `insertPointBefore(beforePointId, x, y, pointType, smooth): string`
- `movePoints(pointIds, dx, dy): string`
- `removePoints(pointIds): string`
- `toggleSmooth(pointId): string`

### Unified Edit
- `applyEditsUnified(pointIds, dx, dy): string` - Move + rule matching + application

## Usage Examples

### Basic Editing Flow
```typescript
const engine = new FontEngine();
engine.loadFont('/path/to/font.ufo');
engine.startEditSession(65); // 'A'

const result = JSON.parse(engine.addPoint(100, 200, 'onCurve', false));
if (result.success) {
  console.log('Added point:', result.affectedPointIds[0]);
}

engine.endEditSession();
```

### Moving Points with Rules
```typescript
const result = JSON.parse(
  engine.applyEditsUnified(['point-id-1', 'point-id-2'], 50, 0)
);

// Result includes:
// - snapshot: updated glyph state
// - affectedPointIds: all moved points including rule-affected handles
// - matchedRules: which rules were applied
```

## Data Flow

```
JavaScript: engine.movePoints(['id1'], 10, 5)
    ↓
NAPI: FontEngine::move_points(vec!["id1"], 10.0, 5.0)
    ↓
Parse IDs: PointId::from_raw(id.parse::<u128>())
    ↓
shift-core: session.move_points(ids, dx, dy)
    ↓
Create snapshot: GlyphSnapshot::from_edit_session()
    ↓
Serialize: serde_json::to_string(&CommandResult { ... })
    ↓
Return JSON string to JavaScript
```

## Related Systems

- [shift-core](../../shift-core/docs/DOCS.md) - Underlying Rust implementation
- [preload](../../../src/preload/docs/DOCS.md) - Electron bridge exposing this module
- [engine](../../../src/renderer/src/engine/docs/DOCS.md) - TypeScript wrapper layer
