# Service facade pattern for font editor

## Problem

The current `createContext()` function requires ~200 lines of manual wiring to bridge the Editor to the ToolContext. Every new method requires updating:

1. The service interface
2. The `createContext()` function
3. The underlying manager

This creates maintenance overhead and duplication.

## Solution

Replace the runtime-created context object with **service classes that live on the Editor**. Tools access services directly via `this.editor.serviceName.method()`.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                      Editor                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ selection   │  │ edit        │  │ screen      │  │
│  │ (Service)   │  │ (Service)   │  │ (Service)   │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │
│         │                │                │          │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐  │
│  │ Selection   │  │ FontEngine  │  │ Viewport    │  │
│  │ Manager     │  │             │  │ Manager     │  │
│  │ (private)   │  │ (private)   │  │ (private)   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Services** = public API for tools (thin facades)
**Managers** = internal implementation (stay private)

## Service design principles

### 1. Services are classes, not object literals

```typescript
class SelectionService {
  #manager: SelectionManager;

  constructor(manager: SelectionManager) {
    this.#manager = manager;
  }

  get selected() {
    return this.#manager.selectedPointIds.value;
  }
  add(id: PointId) {
    this.#manager.addPointToSelection(id);
  }
  clear() {
    this.#manager.clearSelection();
  }
}
```

### 2. Services live on the Editor as readonly properties

```typescript
class Editor {
  readonly selection: SelectionService;
  readonly edit: EditService;
  // ...

  constructor() {
    this.#selectionManager = new SelectionManager();
    this.selection = new SelectionService(this.#selectionManager);
  }
}
```

### 3. Tools access services directly

```typescript
class PenTool extends Tool {
  onPointerDown(e: PointerEvent) {
    const pos = this.editor.screen.toUpm(e.x, e.y);
    const id = this.editor.edit.addPoint(pos.x, pos.y, "curve");
    this.editor.selection.add(id);
  }
}
```

## Service breakdown

| Service     | Responsibility                            | Wraps                    |
| ----------- | ----------------------------------------- | ------------------------ |
| `selection` | Point/segment selection state             | SelectionManager         |
| `hover`     | Hover state for points, segments, handles | HoverManager             |
| `edit`      | Glyph mutations (add/move/remove points)  | FontEngine.editing       |
| `screen`    | Coordinate transforms, hit radius         | ViewportManager          |
| `viewport`  | Pan, zoom, viewport rect                  | ViewportManager          |
| `preview`   | Begin/commit/cancel preview sessions      | Editor preview state     |
| `transform` | Rotate, scale, reflect selection          | Transform commands       |
| `hitTest`   | Find points/segments at position          | Editor + ViewportManager |
| `cursor`    | Set cursor style                          | Editor cursor state      |
| `render`    | Request redraws, toggle modes             | GlyphRenderer            |
| `commands`  | Undo/redo history                         | CommandHistory           |

## Adding guards

Services can include safety checks internally:

```typescript
class EditService {
  addPoint(x: number, y: number, type: PointType) {
    if (this.#editor.isReadonly) return null; // Guard
    return this.#engine.editing.addPoint(x, y, type);
  }
}
```

Tools don't need to think about guards - the service handles it.

## Migration path

1. Create service classes in `lib/editor/services/`
2. Add services as readonly properties on Editor
3. Update Tool base class to receive Editor instead of ToolContext
4. Update tools to use `this.editor.service.method()` pattern
5. Remove `createContext()` and ToolContext interfaces

## File structure

```
lib/editor/
├── Editor.ts
├── services/
│   ├── SelectionService.ts
│   ├── EditService.ts
│   ├── HoverService.ts
│   ├── ScreenService.ts
│   ├── ViewportService.ts
│   ├── PreviewService.ts
│   ├── TransformService.ts
│   ├── HitTestService.ts
│   ├── CursorService.ts
│   ├── RenderService.ts
│   └── index.ts  (re-exports)
└── managers/
    ├── SelectionManager.ts
    ├── HoverManager.ts
    └── ViewportManager.ts
```

## Benefits

- **Single source of truth**: Add method to service class, done
- **No wiring boilerplate**: Services created once in Editor constructor
- **Guards centralized**: Safety logic lives in services, not scattered in tools
- **Type safety preserved**: Services have typed interfaces
- **Testable**: Services can be mocked independently
- **Discoverable**: `editor.` autocomplete shows all available services
