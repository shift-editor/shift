# Tools

State machine-based tool implementations for the Shift font editor.

## Overview

The tools library provides editing tools (Pen, Select, Hand, Shape) built on a state machine pattern using `BaseTool`. Each tool manages its own state via discriminated unions, handles semantic events from `GestureDetector`, and renders interactive overlays. Tools are coordinated by `ToolManager` with keyboard shortcuts.

## Architecture

```
BaseTool<TState>
├── id: ToolName
├── state: TState
├── ctx: ToolContext
├── initialState(): TState
├── transition(state, event): TState
├── onTransition?(prev, next, event): void
├── render?(renderer): void
├── activate?() / deactivate?()
└── handleEvent(event): void

ToolManager
├── activate(tool): void
├── handlePointerDown/Move/Up()
├── handleKeyDown/Up()
├── requestTemporary(name)
└── returnFromTemporary()

GestureDetector
├── pointerDown/Move/Up()
└── Converts raw events → ToolEvent
```

### File Organization

```
tools/
├── core/                    # Infrastructure
│   ├── BaseTool.ts          # Abstract base class
│   ├── GestureDetector.ts   # Pointer → semantic events
│   ├── ToolManager.ts       # Tool orchestration
│   ├── createContext.ts     # ToolContext factory
│   └── DrawAPI.ts           # Rendering API
├── pen/                     # Bezier curve drawing
│   ├── Pen.ts
│   └── intents.ts
├── select/                  # Point selection and manipulation
│   ├── Select.ts
│   ├── cursor.ts
│   ├── types.ts
│   └── utils.ts
├── hand/                    # Canvas panning
│   └── Hand.ts
├── shape/                   # Rectangle creation
│   └── Shape.ts
└── tools.ts                 # ToolName type
```

### Key Design Decisions

1. **State Machine Pattern**: Tools use discriminated union states with pure transitions
2. **Side Effects in onTransition**: State changes trigger side effects after transition
3. **GestureDetector**: Converts raw pointer events to semantic events (click, drag, doubleClick)
4. **ToolContext Injection**: Tools receive services via context, enabling testing
5. **State in State Machine**: All state lives in state variants, no shadow state

## Key Concepts

### BaseTool

Abstract base class all tools extend:

```typescript
abstract class BaseTool<S extends ToolState, Settings = Record<string, never>> {
  abstract readonly id: ToolName;
  state: S;
  protected ctx: ToolContext;

  abstract initialState(): S;
  abstract transition(state: S, event: ToolEvent): S;

  onTransition?(prev: S, next: S, event: ToolEvent): void;
  render?(renderer: IRenderer): void;
  activate?(): void;
  deactivate?(): void;

  handleEvent(event: ToolEvent): void;

  // Helpers
  protected batch<T>(name: string, fn: () => T): T;
  protected beginPreview(): void;
  protected commitPreview(label: string): void;
  protected cancelPreview(): void;
}
```

### ToolEvent

Semantic events produced by GestureDetector:

```typescript
type ToolEvent =
  | { type: "pointerMove"; point: Point2D }
  | { type: "click"; point: Point2D; shiftKey: boolean; altKey: boolean }
  | { type: "doubleClick"; point: Point2D }
  | { type: "dragStart"; point: Point2D; screenPoint: Point2D; shiftKey: boolean; altKey: boolean }
  | { type: "drag"; point: Point2D; screenPoint: Point2D; origin: Point2D; screenOrigin: Point2D; delta: Point2D; screenDelta: Point2D; shiftKey: boolean; altKey: boolean }
  | { type: "dragEnd"; point: Point2D; screenPoint: Point2D; origin: Point2D; screenOrigin: Point2D }
  | { type: "dragCancel" }
  | { type: "keyDown"; key: string; shiftKey: boolean; altKey: boolean; metaKey: boolean }
  | { type: "keyUp"; key: string };
```

### ToolContext

Services provided to tools:

```typescript
interface ToolContext {
  screen: ScreenService;        // Coordinate conversion, hit radius
  selection: SelectionService;  // Point/segment selection state
  hover: HoverService;          // Hover state management
  edit: EditService;            // Glyph editing operations
  preview: PreviewService;      // Preview mode for drag operations
  transform: TransformService;  // Transform operations
  cursor: CursorService;        // Cursor management
  render: RenderService;        // Redraw requests
  viewport: ViewportService;    // Pan/zoom
  hitTest: HitTestService;      // Point/segment hit testing
  commands: CommandHistory;     // Undo/redo
  tools: ToolSwitchService;     // Temporary tool switching
}
```

## Tool Implementations

### Select Tool

Point selection and manipulation:

```
States: idle → ready ↔ selected ↔ dragging
                ↓         ↓
             selecting  resizing
```

Features:
- Click to select point
- Shift+click for multi-select
- Click segment to select
- Drag to move selected points
- Rectangle selection
- Resize selection via bounding box handles
- Arrow keys for nudging (small/medium/large)
- Double-click to toggle smooth

### Pen Tool

Bezier curve drawing:

```
States: idle → ready → anchored → dragging → ready
```

Features:
- Click to place anchor point
- Drag to create bezier handles
- Automatic handle mirroring
- Click first point to close contour
- Escape to abandon contour
- Continue contour: Click endpoint of existing open contour
- Split contour: Click middle point of existing contour

### Hand Tool

Canvas panning:

```
States: idle → ready → dragging
```

Features:
- Drag to pan canvas
- Space bar activation (temporary tool switch)

### Shape Tool

Rectangle creation:

```
States: idle → ready → dragging
```

Features:
- Drag to create rectangle
- Auto-closes contour

## API Reference

### BaseTool Methods

| Method | Description |
| ------ | ----------- |
| `initialState()` | Return the initial state |
| `transition(state, event)` | Pure state transition logic |
| `onTransition(prev, next, event)` | Side effects after state change |
| `render(renderer)` | Draw interactive overlays |
| `activate()` | Called when tool becomes active |
| `deactivate()` | Called when tool becomes inactive |
| `handleEvent(event)` | Process a ToolEvent |
| `batch(name, fn)` | Execute commands in a batch |
| `beginPreview()` | Start preview mode |
| `commitPreview(label)` | Commit preview as command |
| `cancelPreview()` | Cancel preview, restore state |

### ToolManager Methods

| Method | Description |
| ------ | ----------- |
| `activate(tool)` | Set the primary active tool |
| `handlePointerDown/Move/Up()` | Route pointer events to GestureDetector |
| `handleKeyDown/Up()` | Route key events to active tool |
| `requestTemporary(name, options)` | Switch to temporary tool (e.g., Space+Hand) |
| `returnFromTemporary()` | Return to primary tool |

### Keyboard Shortcuts

- `V` - Select tool
- `P` - Pen tool
- `H` - Hand tool
- `S` - Shape tool
- `Escape` - Cancel current operation
- `Space` (hold) - Temporary Hand tool

## Usage Examples

### Creating a Tool

```typescript
class MyTool extends BaseTool<MyState> {
  readonly id: ToolName = "myTool";

  initialState(): MyState {
    return { type: "idle" };
  }

  transition(state: MyState, event: ToolEvent): MyState {
    if (state.type === "ready" && event.type === "click") {
      return { type: "active", point: event.point };
    }
    return state;
  }

  onTransition(prev: MyState, next: MyState, event: ToolEvent): void {
    if (next.type === "active") {
      this.ctx.cursor.set({ type: "crosshair" });
    }
  }

  activate(): void {
    this.state = { type: "ready" };
    this.ctx.cursor.set({ type: "default" });
  }
}
```

### Testing with ToolEventSimulator

```typescript
import { ToolEventSimulator, createMockToolContext, createToolMouseEvent } from "@/testing";

describe("MyTool", () => {
  let tool: MyTool;
  let sim: ToolEventSimulator;
  let ctx: MockToolContext;

  beforeEach(() => {
    ctx = createMockToolContext();
    tool = new MyTool(ctx);
    sim = new ToolEventSimulator(tool);
    sim.setReady();
  });

  it("should activate on click", () => {
    sim.onMouseDown(createToolMouseEvent(100, 100));
    sim.onMouseUp(createToolMouseEvent(100, 100));
    expect(tool.getState().type).toBe("active");
  });

  it("should handle drag", () => {
    sim.onMouseDown(createToolMouseEvent(100, 100));
    sim.onMouseMove(createToolMouseEvent(150, 150));
    expect(tool.getState().type).toBe("dragging");
  });

  it("should handle keyboard", () => {
    sim.keyDown("ArrowRight");
    expect(ctx.mocks.edit.movePoints).toHaveBeenCalled();
  });
});
```

### Preview Pattern for Drag Operations

```typescript
onTransition(prev: SelectState, next: SelectState, event: ToolEvent): void {
  // Start preview when drag begins
  if (prev.type === "selected" && next.type === "dragging") {
    this.beginPreview();
  }

  // Commit when drag ends with actual movement
  if (prev.type === "dragging" && next.type === "selected") {
    if (event.type === "dragEnd") {
      const { totalDelta, draggedPointIds } = prev.drag;
      if ((totalDelta.x !== 0 || totalDelta.y !== 0) && draggedPointIds.length > 0) {
        this.commitPreview("Move Points");
      } else {
        this.cancelPreview();
      }
    } else {
      this.cancelPreview();
    }
  }
}
```

## Data Flow

```
User Interaction
      ↓
InteractiveScene (React)
      ↓
ToolManager.handlePointerDown/Move/Up()
      ↓
GestureDetector.pointerDown/Move/Up()
      ↓
ToolEvent (click | drag | doubleClick | ...)
      ↓
BaseTool.handleEvent(event)
      ↓
tool.transition(state, event) → new state
      ↓
tool.onTransition(prev, next, event) → side effects
      ↓
ctx.render.requestRedraw()
      ↓
tool.render(renderer) → draw overlays
```

## Related Systems

- [editor](../editor/docs/DOCS.md) - Provides ToolContext services
- [commands](../commands/docs/DOCS.md) - Command execution and undo
- [reactive](../reactive/docs/DOCS.md) - Signals for state
- [graphics](../graphics/docs/DOCS.md) - Interactive rendering
