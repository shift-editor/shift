# Tools - LLM Context

## Quick Facts

- **Purpose**: State machine-based editing tools (Pen, Select, Hand, Shape)
- **Language**: TypeScript
- **Key Files**: `core/BaseTool.ts`, `core/ToolManager.ts`, `core/GestureDetector.ts`, `pen/Pen.ts`, `select/Select.ts`
- **Dependencies**: lib/reactive, lib/editor, lib/commands
- **Dependents**: views/Editor.tsx, components/InteractiveScene.tsx

## File Structure

```
src/renderer/src/lib/tools/
├── core/
│   ├── BaseTool.ts           # Abstract base class for tools
│   ├── GestureDetector.ts    # Converts pointer events to semantic events
│   ├── ToolManager.ts        # Tool orchestration and switching
│   ├── createContext.ts      # ToolContext factory
│   ├── DrawAPI.ts            # Interactive drawing API
│   └── index.ts
├── pen/
│   ├── Pen.ts                # Pen tool class
│   ├── intents.ts            # Pen cursor logic
│   └── index.ts
├── select/
│   ├── Select.ts             # Select tool class
│   ├── cursor.ts             # Select cursor logic
│   ├── types.ts              # SelectState types
│   ├── utils.ts              # Pure utility functions
│   └── index.ts
├── hand/
│   ├── Hand.ts               # Pan tool
│   └── index.ts
├── shape/
│   ├── Shape.ts              # Rectangle tool
│   └── index.ts
├── tools.ts                  # Tool name types
├── Pen.test.ts
├── Select.test.ts
└── docs/
    ├── CONTEXT.md
    └── DOCS.md
```

## Core Abstractions

### BaseTool<S, Settings> (core/BaseTool.ts)

```typescript
abstract class BaseTool<S extends ToolState, Settings = Record<string, never>> {
  abstract readonly id: ToolName;
  state: S;
  settings: Settings;
  protected ctx: ToolContext;

  abstract initialState(): S;
  abstract transition(state: S, event: ToolEvent): S;

  onTransition?(prev: S, next: S, event: ToolEvent): void;
  render?(renderer: IRenderer): void;
  activate?(): void;
  deactivate?(): void;

  handleEvent(event: ToolEvent): void;
  handleModifier(key: string, pressed: boolean): boolean;

  protected batch<T>(name: string, fn: () => T): T;
  protected beginPreview(): void;
  protected commitPreview(label: string): void;
  protected cancelPreview(): void;
}
```

### ToolEvent (core/GestureDetector.ts)

```typescript
type ToolEvent =
  | { type: "pointerMove"; point: Point2D }
  | { type: "click"; point: Point2D; shiftKey: boolean; altKey: boolean }
  | { type: "doubleClick"; point: Point2D }
  | { type: "dragStart"; point: Point2D; screenPoint: Point2D; shiftKey: boolean; altKey: boolean }
  | { type: "drag"; point: Point2D; screenPoint: Point2D; origin: Point2D; ... }
  | { type: "dragEnd"; point: Point2D; screenPoint: Point2D; origin: Point2D; ... }
  | { type: "dragCancel" }
  | { type: "keyDown"; key: string; shiftKey: boolean; altKey: boolean; metaKey: boolean }
  | { type: "keyUp"; key: string };
```

### ToolManager (core/ToolManager.ts)

```typescript
class ToolManager {
  activate(tool: BaseTool): void;
  handlePointerDown(point: Point2D, screenPoint: Point2D, modifiers: Modifiers): void;
  handlePointerMove(point: Point2D, screenPoint: Point2D, modifiers: Modifiers): void;
  handlePointerUp(point: Point2D, screenPoint: Point2D): void;
  handleKeyDown(event: KeyboardEvent): void;
  handleKeyUp(event: KeyboardEvent): void;

  requestTemporary(name: ToolName, options?: { onActivate?, onReturn? }): void;
  returnFromTemporary(): void;
}
```

### PenState (pen/Pen.ts)

```typescript
type PenState =
  | { type: "idle" }
  | { type: "ready"; mousePos: Point2D }
  | { type: "anchored"; anchor: AnchorData }
  | { type: "dragging"; anchor: AnchorData; handles: HandleData; mousePos: Point2D };
```

### SelectState (select/types.ts)

```typescript
type SelectState =
  | { type: "idle" }
  | { type: "ready"; hoveredPointId: PointId | null }
  | { type: "selecting"; selection: SelectionData }
  | { type: "selected"; hoveredPointId: PointId | null }
  | { type: "dragging"; drag: DragData }
  | { type: "resizing"; resize: ResizeData };

interface DragData {
  anchorPointId: PointId;
  startPos: Point2D;
  lastPos: Point2D;
  totalDelta: Point2D;
  draggedPointIds: PointId[];
}

interface ResizeData {
  edge: BoundingRectEdge;
  startPos: Point2D;
  lastPos: Point2D;
  initialBounds: Rect2D;
  anchorPoint: Point2D;
  draggedPointIds: PointId[];
  initialPositions: Map<PointId, Point2D>;
  uniformScale: boolean;
}
```

## Key Patterns

### Tool State Machine

```typescript
class Select extends BaseTool<SelectState> {
  readonly id: ToolName = "select";

  initialState(): SelectState {
    return { type: "idle" };
  }

  transition(state: SelectState, event: ToolEvent): SelectState {
    switch (state.type) {
      case "ready":
        return this.transitionReady(state, event);
      case "selected":
        return this.transitionSelected(state, event);
      // ... other states
    }
    return state;
  }

  onTransition(prev: SelectState, next: SelectState, event: ToolEvent): void {
    // Handle side effects after state changes
    if (prev.type === "dragging" && next.type === "selected") {
      this.commitPreview("Move Points");
    }
  }
}
```

### GestureDetector Event Conversion

```typescript
// InteractiveScene.tsx handles raw pointer events
<canvas
  onPointerDown={(e) => {
    toolManager.handlePointerDown(upmPoint, screenPoint, {
      shiftKey: e.shiftKey,
      altKey: e.altKey,
    });
  }}
/>

// GestureDetector converts to semantic events
// click (no drag), drag sequence, double-click
```

### ToolContext Dependency Injection

```typescript
interface ToolContext {
  screen: ScreenService;
  selection: SelectionService;
  hover: HoverService;
  edit: EditService;
  preview: PreviewService;
  transform: TransformService;
  cursor: CursorService;
  render: RenderService;
  viewport: ViewportService;
  hitTest: HitTestService;
  commands: CommandHistory;
  tools: ToolSwitchService;
}
```

## API Surface

| Tool   | States                                           | Key Features                                      |
| ------ | ------------------------------------------------ | ------------------------------------------------- |
| Select | idle, ready, selecting, selected, dragging, resizing | Point/segment selection, drag, resize, nudge      |
| Pen    | idle, ready, anchored, dragging                  | Bezier curves, contour close/continue/split       |
| Hand   | idle, ready, dragging                            | Canvas panning, Space bar activation              |
| Shape  | idle, ready, dragging                            | Rectangle creation                                |

## Common Operations

### Create a new tool

```typescript
class MyTool extends BaseTool<MyState> {
  readonly id: ToolName = "myTool";

  initialState(): MyState {
    return { type: "idle" };
  }

  transition(state: MyState, event: ToolEvent): MyState {
    // Pure state transition logic
    return state;
  }

  onTransition(prev: MyState, next: MyState, event: ToolEvent): void {
    // Side effects: cursor updates, preview commit, etc.
  }

  activate(): void {
    this.state = { type: "ready" };
    this.ctx.cursor.set({ type: "crosshair" });
  }
}
```

### Testing tools with ToolEventSimulator

```typescript
import { ToolEventSimulator, createMockToolContext, createToolMouseEvent } from "@/testing";

const ctx = createMockToolContext();
const tool = new Select(ctx);
const sim = new ToolEventSimulator(tool);

sim.setReady();
sim.onMouseDown(createToolMouseEvent(100, 100));
sim.onMouseMove(createToolMouseEvent(150, 150));
sim.onMouseUp(createToolMouseEvent(150, 150));

expect(tool.getState().type).toBe("selected");
```

## Constants

```typescript
// GestureDetector
const DRAG_THRESHOLD = 3; // Screen pixels before drag starts
const DOUBLE_CLICK_TIME = 300; // ms
const DOUBLE_CLICK_DISTANCE = 5; // pixels

// Nudge amounts
const NUDGES_VALUES = { small: 1, medium: 10, large: 100 };
```

## Constraints and Invariants

1. **Pure Transitions**: `transition()` returns new state, side effects in `onTransition()`
2. **State in State Machine**: No shadow state outside state variants
3. **Idle on Deactivate**: Tools transition to 'idle' when deactivated
4. **UPM Coordinates**: All tool operations work in UPM space
5. **Single Active Tool**: Only one tool receives events at a time
6. **Keyboard Shortcuts**: V=Select, P=Pen, H=Hand, S=Shape
