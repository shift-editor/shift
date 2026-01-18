# Engine - LLM Context

## Quick Facts
- **Purpose**: TypeScript facade wrapping native Rust FontEngine with reactive state
- **Language**: TypeScript
- **Key Files**: `FontEngine.ts`, `editing.ts`, `session.ts`, `segments.ts`, `native.ts`
- **Dependencies**: lib/reactive (signals), shift-node (via preload)
- **Dependents**: lib/editor, lib/tools, views

## File Structure
```
src/renderer/src/engine/
├── index.ts           # Public exports barrel
├── FontEngine.ts      # Main orchestrator class
├── editing.ts         # EditingManager (point/contour ops)
├── session.ts         # SessionManager (lifecycle)
├── info.ts            # InfoManager (metadata)
├── history.ts         # HistoryManager (undo/redo)
├── io.ts              # IOManager (file ops)
├── segments.ts        # Contour → segment parsing
├── errors.ts          # Custom error classes
├── native.ts          # Native interface types
└── mock.ts            # Mock implementation for testing
```

## Core Abstractions

### FontEngine (FontEngine.ts:25-60)
```typescript
export class FontEngine {
  readonly snapshot: WritableSignal<GlyphSnapshot | null>;
  readonly editing: EditingManager;
  readonly editEngine: EditEngine;
  readonly session: SessionManager;
  readonly info: InfoManager;
  readonly history: HistoryManager;
  readonly io: IOManager;
}
```

### Manager Context (FontEngine.ts:35-45)
```typescript
interface ManagerContext {
  native: NativeFontEngine;
  hasSession: () => boolean;
  emitSnapshot: (snapshot: GlyphSnapshot | null) => void;
}
```

### NativeFontEngine (native.ts)
```typescript
interface NativeFontEngine {
  loadFont(path: string): void;
  startEditSession(unicode: number): void;
  endEditSession(): void;
  getSnapshotData(): NativeGlyphSnapshot;
  addPoint(x, y, pointType, smooth): string;
  movePoints(pointIds, dx, dy): string;
  applyEditsUnified(pointIds, dx, dy): string;
  // ...more methods
}
```

### Segment Types (segments.ts)
```typescript
type LineSegment = { type: 'line'; start: Point2D; end: Point2D }
type QuadSegment = { type: 'quad'; start: Point2D; cp: Point2D; end: Point2D }
type CubicSegment = { type: 'cubic'; start: Point2D; cp1: Point2D; cp2: Point2D; end: Point2D }
type Segment = LineSegment | QuadSegment | CubicSegment
```

## Key Patterns

### Manager Pattern with Shared Context
```typescript
// FontEngine passes same context to all managers
const ctx = {
  native: this.#native,
  hasSession: () => this.session.isActive(),
  emitSnapshot: (s) => this.snapshot.set(s),
};

this.editing = new EditingManager(ctx);
this.session = new SessionManager(ctx);
```

### Session Validation
```typescript
class EditingManager {
  #requireSession(): void {
    if (!this.#ctx.hasSession()) {
      throw new NoEditSessionError();
    }
  }

  addPoint(x, y, type, smooth): PointId {
    this.#requireSession();
    const result = JSON.parse(this.#ctx.native.addPoint(x, y, type, smooth));
    this.#ctx.emitSnapshot(result.snapshot);
    return asPointId(result.affectedPointIds[0]);
  }
}
```

### Native Access Pattern
```typescript
// Native accessor with availability check
export function getNative(): NativeFontEngine {
  if (!window.shiftFont) throw new Error('Native not available');
  return window.shiftFont;
}

export function hasNative(): boolean {
  return typeof window.shiftFont !== 'undefined';
}
```

## API Surface

| Class | Method | Return |
|-------|--------|--------|
| FontEngine | constructor() | FontEngine |
| EditingManager | addPoint(x, y, type, smooth) | PointId |
| EditingManager | addContour() | ContourId |
| EditingManager | movePoints(ids, dx, dy) | void |
| EditingManager | removePoints(ids) | void |
| SessionManager | startEditSession(unicode) | void |
| SessionManager | endEditSession() | void |
| SessionManager | isActive() | boolean |
| InfoManager | getMetadata() | FontMetadata |
| InfoManager | getMetrics() | FontMetrics |
| EditEngine | applyEdits(selected, dx, dy) | PointId[] |

## Common Operations

### Initialize and track state
```typescript
const engine = new FontEngine();

effect(() => {
  const snapshot = engine.snapshot.value;
  console.log('Glyph changed:', snapshot?.name);
});
```

### Edit workflow
```typescript
engine.io.loadFont('/path/to/font.ufo');
engine.session.startEditSession(65);

const contourId = engine.editing.addContour();
const p1 = engine.editing.addPoint(0, 0, 'onCurve', false);
const p2 = engine.editing.addPoint(100, 200, 'offCurve', false);

engine.editing.movePoints([p1, p2], 50, 0);
engine.session.endEditSession();
```

### Parse segments for rendering
```typescript
const segments = parseSegments(contour.points, contour.closed);
for (const seg of segments) {
  if (seg.type === 'cubic') {
    ctx.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.end.x, seg.end.y);
  }
}
```

## Constraints and Invariants

1. **Session Required**: EditingManager methods throw NoEditSessionError without active session
2. **Single Signal**: All state flows through `snapshot` signal
3. **ID Types**: PointId and ContourId are branded strings (type safety)
4. **JSON Parse**: Native returns JSON strings, managers parse them
5. **Context Sharing**: All managers share same context object
6. **Native Availability**: `getNative()` throws if preload not ready
