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
│   ├── DrawAPI.ts            # Interactive drawing API
│   └── index.ts
├── pen/
│   ├── Pen.ts                # Pen tool class
│   ├── behaviors/            # State-specific behavior handlers
│   ├── intents.ts            # Intent resolution and execution
│   └── index.ts
├── select/
│   ├── Select.ts             # Select tool class
│   ├── behaviors/            # State-specific behavior handlers
│   ├── cursor.ts             # Select cursor logic
│   ├── intents.ts            # Intent resolution and execution
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
  protected editor: Editor;

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

  requestTemporary(name: ToolName, options?: { onActivate?; onReturn? }): void;
  returnFromTemporary(): void;
}
```

### PenState (pen/Pen.ts)

```typescript
type PenState =
  | { type: "idle" }
  | { type: "ready"; mousePos: Point2D }
  | { type: "anchored"; anchor: AnchorData }
  | {
      type: "dragging";
      anchor: AnchorData;
      handles: HandleData;
      mousePos: Point2D;
    };
```

### SelectState (select/types.ts)

```typescript
type SelectState =
  | { type: "idle"; intent?: SelectIntent }
  | { type: "ready"; hoveredPointId: PointId | null; intent?: SelectIntent }
  | { type: "selecting"; selection: SelectionData; intent?: SelectIntent }
  | { type: "selected"; hoveredPointId: PointId | null; intent?: SelectIntent }
  | { type: "dragging"; drag: DragData; intent?: SelectIntent }
  | { type: "resizing"; resize: ResizeData; intent?: SelectIntent }
  | { type: "rotating"; rotate: RotateData; intent?: SelectIntent };

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

### Behavior Pattern

Complex tools delegate to behavior classes for cleaner separation:

```typescript
class Select extends BaseTool<SelectState> {
  private behaviors: SelectBehavior[] = [
    new HoverBehavior(),
    new SelectionBehavior(),
    new DragBehavior(),
    new ResizeBehavior(),
    new RotateBehavior(),
  ];

  transition(state: SelectState, event: ToolEvent): SelectState {
    for (const behavior of this.behaviors) {
      if (behavior.canHandle(state, event)) {
        const result = behavior.transition(state, event, this.editor);
        if (result) return result;
      }
    }
    return state;
  }

  onTransition(prev: SelectState, next: SelectState, event: ToolEvent): void {
    if (next.intent) {
      executeIntent(next.intent, this.editor);
    }
    for (const behavior of this.behaviors) {
      behavior.onTransition?.(prev, next, event, this.editor);
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

### Editor Service Access

Tools access services through the Editor instance:

```typescript
// In a tool or behavior:
this.editor.selectPoints(ids);
this.editor.setCursor({ type: "crosshair" });
this.editor.getPointAt(pos);
this.editor.beginPreview();
this.editor.commands.execute(cmd);
```

## API Surface

| Tool   | States                                                         | Key Features                                         |
| ------ | -------------------------------------------------------------- | ---------------------------------------------------- |
| Select | idle, ready, selecting, selected, dragging, resizing, rotating | Point/segment selection, drag, resize, rotate, nudge |
| Pen    | idle, ready, anchored, dragging                                | Bezier curves, contour close/continue/split          |
| Hand   | idle, ready, dragging                                          | Canvas panning, Space bar activation                 |
| Shape  | idle, ready, dragging                                          | Rectangle creation                                   |

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
    this.editor.setCursor({ type: "crosshair" });
  }
}
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
