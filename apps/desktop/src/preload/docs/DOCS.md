# Preload

Electron preload script bridging native Rust FontEngine to the renderer process.

## Overview

The preload script uses Electron's contextBridge to safely expose the shift-node FontEngine to the renderer. It creates a controlled API surface under `window.shiftFont`, enabling the renderer to call native Rust functions without direct Node.js access.

## Architecture

```
Renderer Process
    ↓
window.shiftFont (contextBridge)
    ↓
fontEngineAPI (preload wrapper)
    ↓
FontEngine instance (shift-node)
    ↓
Rust implementation (shift-core)
```

### Key Design Decisions

1. **Explicit API Surface**: Only FontEngine methods exposed, nothing else
2. **Single Instance**: One FontEngine instance shared across all calls
3. **Controlled Namespace**: All APIs under `window.shiftFont`
4. **Method Wrapping**: Each method explicitly wrapped (no dynamic proxies)

## Key Concepts

### Context Bridge

Secure IPC replacement using Electron's contextBridge:

```typescript
const { contextBridge } = require('electron');
const { FontEngine } = require('shift-node');

const fontEngineInstance = new FontEngine();

contextBridge.exposeInMainWorld('shiftFont', fontEngineAPI);
```

### API Categories

The exposed API is organized into functional groups:

| Category | Methods |
|----------|---------|
| Font Loading | `loadFont` |
| Font Info | `getMetadata`, `getMetrics`, `getGlyphCount` |
| Session | `startEditSession`, `endEditSession`, `hasEditSession`, `getEditingUnicode` |
| Snapshots | `getSnapshot`, `getSnapshotData` |
| Contours | `addEmptyContour`, `addContour`, `getActiveContourId`, `closeContour` |
| Points | `addPoint`, `addPointToContour`, `movePoints`, `removePoints`, `insertPointBefore`, `toggleSmooth` |
| Unified Edit | `applyEditsUnified` |

## API Reference

### Font Loading
- `loadFont(path: string): void`

### Font Info
- `getMetadata(): FontMetadata`
- `getMetrics(): FontMetrics`
- `getGlyphCount(): number`

### Session Management
- `startEditSession(unicode: number): void`
- `endEditSession(): void`
- `hasEditSession(): boolean`
- `getEditingUnicode(): number | null`

### Snapshots
- `getSnapshot(): string | null` - JSON string
- `getSnapshotData(): NativeGlyphSnapshot` - Native object

### Contour Operations
- `addEmptyContour(): string`
- `addContour(): string`
- `getActiveContourId(): string | null`
- `closeContour(): string`

### Point Operations
- `addPoint(x, y, pointType, smooth): string`
- `addPointToContour(contourId, x, y, pointType, smooth): string`
- `movePoints(pointIds, dx, dy): string`
- `removePoints(pointIds): string`
- `insertPointBefore(beforePointId, x, y, pointType, smooth): string`
- `toggleSmooth(pointId): string`

### Unified Edit
- `applyEditsUnified(pointIds, dx, dy): string`

## Usage Examples

### Renderer Access
```typescript
// In renderer (after preload runs)
const engine = window.shiftFont;

engine.loadFont('/path/to/font.ufo');
engine.startEditSession(65);

const result = JSON.parse(engine.addPoint(100, 200, 'onCurve', false));
if (result.success) {
  console.log('Added point:', result.affectedPointIds[0]);
}
```

### Type Safety
```typescript
// types/electron.d.ts provides types
declare global {
  interface Window {
    shiftFont: NativeFontEngine;
  }
}
```

### Engine Wrapper Access
```typescript
// engine/native.ts provides safe access
import { getNative, hasNative } from '@/engine/native';

if (hasNative()) {
  const native = getNative();
  native.loadFont(path);
}
```

## Data Flow

```
Renderer calls window.shiftFont.addPoint(...)
    ↓
contextBridge forwards to preload
    ↓
fontEngineAPI.addPoint(...) called
    ↓
fontEngineInstance.addPoint(...) (NAPI)
    ↓
Rust FontEngine::add_point(...) executes
    ↓
CommandResult serialized to JSON
    ↓
String returned to renderer
    ↓
Renderer parses JSON result
```

## Related Systems

- [shift-node](../../../crates/shift-node/docs/DOCS.md) - Native module
- [main](../main/docs/DOCS.md) - Loads preload script
- [engine](../renderer/src/engine/docs/DOCS.md) - TypeScript wrapper
