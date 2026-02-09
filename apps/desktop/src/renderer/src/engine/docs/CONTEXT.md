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
├── FontEngine.ts      # Main orchestrator class (implements per-manager dep interfaces)
├── editing.ts         # EditingManager (point/contour ops, smart edits)
├── session.ts         # SessionManager (lifecycle)
├── info.ts            # InfoManager (metadata)
├── io.ts              # IOManager (file ops)
├── segments.ts        # Contour → segment parsing
├── errors.ts          # Custom error classes
├── native.ts          # Native interface types
└── mock.ts            # Mock implementation for testing
```

## Core Abstractions

### Per-Manager Dep Interfaces

Each manager declares its own focused deps interface:

- `EditingEngineDeps` (editing.ts) — raw API, session check, glyph access, snapshot ops, paste
- `SessionEngineDeps` (session.ts) — session lifecycle, snapshot, glyph emit
- `InfoEngineDeps` (info.ts) — metadata, metrics, glyph queries
- `IOEngineDeps` (io.ts) — load/save

### FontEngine (FontEngine.ts)

```typescript
export class FontEngine
  implements EditingEngineDeps, SessionEngineDeps, InfoEngineDeps, IOEngineDeps
{
  readonly editing: EditingManager;
  readonly session: SessionManager;
  readonly info: InfoManager;
  readonly io: IOManager;
}
```

### NativeFontEngine (native.ts)

```typescript
interface NativeFontEngine {
  loadFont(path: string): void;
  startEditSession(unicode: number): void;
  endEditSession(): void;
  getSnapshotData(): GlyphSnapshot;
  addPoint(x, y, pointType, smooth): string;
  movePoints(pointIds, dx, dy): string;
  // ...more methods
}
```

### Segment Types (segments.ts)

```typescript
type LineSegment = { type: "line"; start: Point2D; end: Point2D };
type QuadSegment = { type: "quad"; start: Point2D; cp: Point2D; end: Point2D };
type CubicSegment = {
  type: "cubic";
  start: Point2D;
  cp1: Point2D;
  cp2: Point2D;
  end: Point2D;
};
type Segment = LineSegment | QuadSegment | CubicSegment;
```

## Key Patterns

### Per-Manager Dep Interfaces

```typescript
// FontEngine implements all dep interfaces and passes `this` to each manager
class FontEngine implements EditingEngineDeps, SessionEngineDeps, InfoEngineDeps, IOEngineDeps {
  constructor(raw?: FontEngineAPI) {
    this.session = new SessionManager(this);
    this.editing = new EditingManager(this);
    this.info = new InfoManager(this);
    this.io = new IOManager(this);
  }
}

// Each manager accepts its focused dep interface
class EditingManager {
  #engine: EditingEngineDeps;
  constructor(engine: EditingEngineDeps) {
    this.#engine = engine;
  }
}
```

### Centralized Commit with Error Handling

```typescript
// commit() handles JSON parsing, error checking, and glyph emission
// Void operations (most common):
this.#engine.commit(() => this.#engine.native.closeContour());

// Extraction operations:
return this.#engine.commit(
  () => this.#engine.native.addContour(),
  (result) => asContourId(result.snapshot?.activeContourId ?? ""),
);

// commit() throws NativeOperationError on failure — callers never check success
```

### Session Validation

```typescript
class EditingManager {
  #requireSession(): void {
    if (!this.#engine.hasSession()) {
      throw new NoEditSessionError();
    }
  }

  addPoint(edit: PointEdit): PointId {
    this.#requireSession();
    return this.#engine.commit(
      () => this.#engine.native.addPoint(edit.x, edit.y, edit.pointType, edit.smooth),
      (result) => asPointId(result.affectedPointIds?.[0] ?? ""),
    );
  }
}
```

### Native Access Pattern

```typescript
// Native accessor with availability check
export function getNative(): NativeFontEngine {
  if (!window.shiftFont) throw new Error("Native not available");
  return window.shiftFont;
}

export function hasNative(): boolean {
  return typeof window.shiftFont !== "undefined";
}
```

## API Surface

| Class          | Method                            | Return                                   |
| -------------- | --------------------------------- | ---------------------------------------- |
| FontEngine     | constructor()                     | FontEngine                               |
| EditingManager | addPoint(edit)                    | PointId                                  |
| EditingManager | addContour()                      | ContourId                                |
| EditingManager | movePoints(ids, delta)            | PointId[]                                |
| EditingManager | removePoints(ids)                 | void                                     |
| EditingManager | applySmartEdits(selected, dx, dy) | PointId[]                                |
| SessionManager | startEditSession(unicode)         | void                                     |
| SessionManager | endEditSession()                  | void                                     |
| SessionManager | isActive()                        | boolean                                  |
| InfoManager    | getMetadata()                     | FontMetadata                             |
| InfoManager    | getMetrics()                      | FontMetrics                              |
| InfoManager    | getGlyphUnicodes()                | number[]                                 |
| InfoManager    | getGlyphSvgPath(unicode)          | string \| null                           |
| InfoManager    | getGlyphAdvance(unicode)          | number \| null                           |
| InfoManager    | getGlyphBbox(unicode)             | [number, number, number, number] \| null |

## Common Operations

### Initialize and track state

```typescript
const engine = new FontEngine();

effect(() => {
  const glyph = engine.$glyph.value;
  console.log("Glyph changed:", glyph?.name);
});
```

### Edit workflow

```typescript
engine.io.loadFont("/path/to/font.ufo");
engine.session.startEditSession(65);

const contourId = engine.editing.addContour();
const p1 = engine.editing.addPoint({
  id: "" as PointId,
  x: 0,
  y: 0,
  pointType: "onCurve",
  smooth: false,
});
const p2 = engine.editing.addPoint({
  id: "" as PointId,
  x: 100,
  y: 200,
  pointType: "offCurve",
  smooth: false,
});

engine.editing.movePoints([p1, p2], { x: 50, y: 0 });
engine.session.endEditSession();
```

### Smart edits (constraint-aware)

```typescript
// Uses Rust rule engine for constraint handling
const affectedIds = engine.editing.applySmartEdits(selectedPoints, dx, dy);
```

### Parse segments for rendering

```typescript
const segments = parseSegments(contour.points, contour.closed);
for (const seg of segments) {
  if (seg.type === "cubic") {
    ctx.bezierCurveTo(seg.cp1.x, seg.cp1.y, seg.cp2.x, seg.cp2.y, seg.end.x, seg.end.y);
  }
}
```

## Constraints and Invariants

1. **Session Required**: EditingManager methods throw NoEditSessionError without active session
2. **Single Signal**: All state flows through `$glyph` signal
3. **ID Types**: PointId and ContourId are branded strings (type safety)
4. **JSON Parse**: Native returns JSON strings, `commit()` parses and validates them
5. **Error at Boundary**: `commit()` throws `NativeOperationError` on failure — callers handle only the happy path
6. **Per-Manager DI**: Managers depend on focused dep interfaces, not `FontEngine` concrete class
7. **Native Availability**: `getNative()` throws if preload not ready
