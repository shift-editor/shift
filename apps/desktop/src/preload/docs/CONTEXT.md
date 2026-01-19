# Preload - LLM Context

## Quick Facts

- **Purpose**: Electron contextBridge exposing native FontEngine to renderer
- **Language**: TypeScript
- **Key Files**: `preload.ts`
- **Dependencies**: shift-node, Electron
- **Dependents**: renderer/engine

## File Structure

```
src/preload/
└── preload.ts    # Single file, ~100 lines
```

## Core Abstractions

### API Exposure (preload.ts)

```typescript
const { contextBridge } = require("electron");
const { FontEngine } = require("shift-node");

const fontEngineInstance = new FontEngine();

const fontEngineAPI = {
  // Font Loading
  loadFont: (path: string) => fontEngineInstance.loadFont(path),

  // Font Info
  getMetadata: () => fontEngineInstance.getMetadata(),
  getMetrics: () => fontEngineInstance.getMetrics(),
  getGlyphCount: () => fontEngineInstance.getGlyphCount(),

  // Session Management
  startEditSession: (unicode: number) =>
    fontEngineInstance.startEditSession(unicode),
  endEditSession: () => fontEngineInstance.endEditSession(),
  hasEditSession: () => fontEngineInstance.hasEditSession(),
  getEditingUnicode: () => fontEngineInstance.getEditingUnicode(),

  // Snapshots
  getSnapshot: () => fontEngineInstance.getSnapshot(),
  getSnapshotData: () => fontEngineInstance.getSnapshotData(),

  // Contour Operations
  addEmptyContour: () => fontEngineInstance.addEmptyContour(),
  addContour: () => fontEngineInstance.addContour(),
  getActiveContourId: () => fontEngineInstance.getActiveContourId(),
  closeContour: () => fontEngineInstance.closeContour(),

  // Point Operations
  addPoint: (x, y, pointType, smooth) =>
    fontEngineInstance.addPoint(x, y, pointType, smooth),
  addPointToContour: (contourId, x, y, pointType, smooth) =>
    fontEngineInstance.addPointToContour(contourId, x, y, pointType, smooth),
  movePoints: (pointIds, dx, dy) =>
    fontEngineInstance.movePoints(pointIds, dx, dy),
  removePoints: (pointIds) => fontEngineInstance.removePoints(pointIds),
  insertPointBefore: (beforePointId, x, y, pointType, smooth) =>
    fontEngineInstance.insertPointBefore(
      beforePointId,
      x,
      y,
      pointType,
      smooth,
    ),
  toggleSmooth: (pointId) => fontEngineInstance.toggleSmooth(pointId),

  // Unified Edit
  applyEditsUnified: (pointIds, dx, dy) =>
    fontEngineInstance.applyEditsUnified(pointIds, dx, dy),
};

contextBridge.exposeInMainWorld("shiftFont", fontEngineAPI);
```

### Type Export (preload.ts)

```typescript
export type FontEngineAPI = typeof fontEngineAPI;
```

## Key Patterns

### Explicit Method Wrapping

```typescript
// Each method explicitly wrapped
addPoint: (x, y, pointType, smooth) =>
  fontEngineInstance.addPoint(x, y, pointType, smooth),

// NOT dynamic proxy (security)
// NOT spread operator
```

### Single Instance

```typescript
// One FontEngine for entire app
const fontEngineInstance = new FontEngine();
// All API calls go through this instance
```

### Controlled Namespace

```typescript
// All APIs under single namespace
contextBridge.exposeInMainWorld("shiftFont", fontEngineAPI);
// Renderer accesses via window.shiftFont
```

## API Surface

| Category  | Methods                                                                                | Return Type         |
| --------- | -------------------------------------------------------------------------------------- | ------------------- |
| Loading   | loadFont                                                                               | void                |
| Info      | getMetadata, getMetrics, getGlyphCount                                                 | object/number       |
| Session   | startEditSession, endEditSession, hasEditSession, getEditingUnicode                    | void/boolean/number |
| Snapshots | getSnapshot, getSnapshotData                                                           | string/object       |
| Contours  | addEmptyContour, addContour, getActiveContourId, closeContour                          | string              |
| Points    | addPoint, addPointToContour, movePoints, removePoints, insertPointBefore, toggleSmooth | string              |
| Edit      | applyEditsUnified                                                                      | string              |

## Common Operations

### Basic usage in renderer

```typescript
// window.shiftFont available after preload
window.shiftFont.loadFont("/path/to/font.ufo");
window.shiftFont.startEditSession(65);

const result = JSON.parse(
  window.shiftFont.addPoint(100, 200, "onCurve", false),
);
```

### Check availability

```typescript
if (typeof window.shiftFont !== "undefined") {
  // Safe to use
}
```

### Type-safe access

```typescript
// engine/native.ts
export function getNative(): NativeFontEngine {
  if (!window.shiftFont) throw new Error("Native not available");
  return window.shiftFont;
}
```

## Build Configuration

### Vite Preload Config (vite.preload.config.ts)

```typescript
{
  plugins: [externalizeDepsPlugin()],
  // shift-node loaded via require, not bundled
}
```

### Main Process Config

```typescript
webPreferences: {
  preload: path.join(__dirname, 'preload.js'),
  sandbox: false,  // Required for NAPI
}
```

## Security Considerations

1. **Explicit Surface**: Only FontEngine methods exposed
2. **No Node Access**: Renderer can't access Node.js directly
3. **No IPC Channels**: Uses contextBridge instead of ipcRenderer
4. **Single Namespace**: Contained under `window.shiftFont`
5. **Sandbox Disabled**: Required for NAPI, increases trust responsibility

## Constraints and Invariants

1. **Single Instance**: One FontEngine shared across all calls
2. **Sync Methods**: All methods are synchronous (NAPI blocking)
3. **String Returns**: Most mutations return JSON strings
4. **No Error Wrapping**: Errors thrown directly from NAPI
5. **Build Order**: Must build shift-node before preload
