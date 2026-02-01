# Tools

State machine-based tool implementations for the Shift font editor.

## Overview

The tools library provides editing tools (Pen, Select, Hand, Shape) built on a state machine pattern using `BaseTool`. Each tool manages its own state via discriminated unions, handles semantic events from `GestureDetector`, and renders interactive overlays. Tools are coordinated by `ToolManager` with keyboard shortcuts.

## Architecture

```
BaseTool<TState>
├── id: ToolName
├── state: TState
├── editor: Editor
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
│   ├── DrawAPI.ts           # Rendering API
│   └── Behavior.ts          # Behavior interface, createBehavior helper
├── pen/                     # Bezier curve drawing
│   ├── Pen.ts
│   ├── behaviors/           # State-specific behavior handlers
│   └── intents.ts
├── select/                  # Point selection and manipulation
│   ├── Select.ts
│   ├── behaviors/           # State-specific behavior handlers
│   ├── cursor.ts
│   ├── intents.ts
│   ├── types.ts
│   └── utils.ts
├── hand/                    # Canvas panning
│   ├── Hand.ts
│   ├── types.ts
│   └── behaviors/
├── shape/                   # Rectangle creation
│   ├── Shape.ts
│   ├── types.ts
│   └── behaviors/
└── tools.ts                 # ToolName type
```

### Key Design Decisions

1. **State Machine Pattern**: Tools use discriminated union states with pure transitions
2. **Side Effects in onTransition**: State changes trigger side effects after transition
3. **GestureDetector**: Converts raw pointer events to semantic events (click, drag, doubleClick)
4. **Editor Injection**: Tools receive the `Editor` instance, accessing services via `this.editor.serviceName`
5. **Behavior Pattern**: Complex tools delegate to behavior classes for cleaner separation
6. **Intent Pattern**: State transitions produce intents, executed in `onTransition` for side effects

## Key Concepts

### BaseTool

Abstract base class all tools extend:

```typescript
abstract class BaseTool<S extends ToolState, Settings = Record<string, never>> {
  abstract readonly id: ToolName;
  readonly $cursor: ComputedSignal<CursorType>; // from getCursor(activeToolState)
  state: S;
  protected editor: ToolContext;

  getCursor(state: S): CursorType; // default: { type: "default" }; override for state-based cursor
  abstract initialState(): S;
  abstract transition(state: S, event: ToolEvent): S;

  onTransition?(prev: S, next: S, event: ToolEvent): void;
  render?(renderer: DrawAPI): void;
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
  | {
      type: "dragStart";
      point: Point2D;
      screenPoint: Point2D;
      shiftKey: boolean;
      altKey: boolean;
    }
  | {
      type: "drag";
      point: Point2D;
      screenPoint: Point2D;
      origin: Point2D;
      screenOrigin: Point2D;
      delta: Point2D;
      screenDelta: Point2D;
      shiftKey: boolean;
      altKey: boolean;
    }
  | {
      type: "dragEnd";
      point: Point2D;
      screenPoint: Point2D;
      origin: Point2D;
      screenOrigin: Point2D;
    }
  | { type: "dragCancel" }
  | {
      type: "keyDown";
      key: string;
      shiftKey: boolean;
      altKey: boolean;
      metaKey: boolean;
    }
  | { type: "keyUp"; key: string };
```

### Editor Services

Tools access services via the `Editor` instance:

```typescript
// In a tool or behavior:
this.editor.selectPoints(ids);
this.editor.setCursor({ type: "crosshair" });
this.editor.getPointAt(pos);
```

Available services:

| Service     | Description                         |
| ----------- | ----------------------------------- |
| `screen`    | Coordinate conversion, hit radius   |
| `selection` | Point/segment selection state       |
| `hover`     | Hover state management              |
| `edit`      | Glyph editing operations            |
| `preview`   | Preview mode for drag operations    |
| `transform` | Transform operations                |
| `cursor`    | Cursor management                   |
| `render`    | Redraw requests                     |
| `viewport`  | Pan/zoom                            |
| `hitTest`   | Point/segment hit testing           |
| `commands`  | Command history (undo/redo)         |
| `tools`     | Temporary tool switching            |
| `zone`      | Focus zone (canvas/sidebar/toolbar) |

## Tool Implementations

### Select Tool

Point selection and manipulation with resize and rotate support.

#### State Machine

```
                      ┌──────────────────┐
                      │                  │
          activate    │      idle        │
         ──────────►  │                  │
                      └────────┬─────────┘
                               │ pointerMove
                               ▼
                      ┌──────────────────┐
                      │                  │◄────────────────┐
                      │      ready       │                 │
                      │                  │─────────────────┤ dragEnd (no selection)
                      └────────┬─────────┘                 │
                               │                           │
                ┌──────────────┼──────────────┐           │
                │ dragStart    │ click        │           │
                │ (empty)      │ (on point)   │           │
                ▼              ▼              │           │
       ┌────────────┐  ┌─────────────┐       │           │
       │            │  │             │       │           │
       │ selecting  │  │  selected   │◄──────┘           │
       │ (marquee)  │  │             │                    │
       └─────┬──────┘  └──────┬──────┘                    │
             │                │                           │
             │ dragEnd        ├─────────────────┐        │
             │                │                 │        │
             │                ▼                 ▼        │
             │        ┌─────────────┐   ┌────────────┐   │
             │        │             │   │            │   │
             │        │  dragging   │   │  resizing  │   │
             │        │             │   │            │   │
             │        └──────┬──────┘   └─────┬──────┘   │
             │               │                │          │
             │               │ dragEnd        │ dragEnd  │
             └───────────────┴────────────────┴──────────┘
```

#### States

| State       | Description                             | Data                      |
| ----------- | --------------------------------------- | ------------------------- |
| `idle`      | Tool not active                         | -                         |
| `ready`     | Waiting for interaction, no selection   | `hoveredPointId`          |
| `selecting` | Drawing marquee rectangle               | `startPos`, `currentPos`  |
| `selected`  | Points selected, can drag/resize/rotate | `hoveredPointId`          |
| `dragging`  | Moving selected points                  | `startPos`, `totalDelta`  |
| `resizing`  | Scaling via bounding box handles        | `edge`, `anchor`, `scale` |
| `rotating`  | Rotating via corner zones               | `center`, `angle`         |

#### Features

- Click to select point
- Shift+click for multi-select
- Click segment to select
- Drag to move selected points
- Rectangle marquee selection
- Resize via bounding box edge/corner handles
- Rotate via corner zones (outside handles)
- Arrow keys for nudging (small/medium/large)
- Double-click to toggle smooth
- Escape to clear selection

### Pen Tool

Bezier curve drawing with automatic handle creation.

#### States

| State      | Description                            |
| ---------- | -------------------------------------- |
| `idle`     | Tool not active                        |
| `ready`    | Waiting for click to place point       |
| `anchored` | Point placed, detecting drag threshold |
| `dragging` | Creating bezier handles by dragging    |

#### Features

- Click to place anchor point
- Drag to create bezier handles
- Automatic handle mirroring
- Click first point to close contour
- Escape to abandon contour
- Continue contour: Click endpoint of existing open contour
- Split segment: Click on a segment to insert point

### Hand Tool

Canvas panning.

#### States

| State      | Description        |
| ---------- | ------------------ |
| `idle`     | Tool not active    |
| `ready`    | Waiting for drag   |
| `dragging` | Panning the canvas |

#### Features

- Drag to pan canvas
- Space bar activation (temporary tool switch from any tool)

### Shape Tool

Rectangle creation.

#### States

| State      | Description       |
| ---------- | ----------------- |
| `idle`     | Tool not active   |
| `ready`    | Waiting for drag  |
| `dragging` | Drawing rectangle |

#### Features

- Drag to create rectangle
- Auto-closes contour

## API Reference

### BaseTool Methods

| Method                            | Description                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `getCursor(state)`                | Return cursor for state (default: `{ type: "default" }`); override for state-based cursor |
| `initialState()`                  | Return the initial state                                                                  |
| `transition(state, event)`        | Pure state transition logic                                                               |
| `onTransition(prev, next, event)` | Side effects after state change                                                           |
| `render(renderer)`                | Draw interactive overlays                                                                 |
| `activate()`                      | Called when tool becomes active                                                           |
| `deactivate()`                    | Called when tool becomes inactive                                                         |
| `handleEvent(event)`              | Process a ToolEvent                                                                       |
| `batch(name, fn)`                 | Execute commands in a batch                                                               |
| `beginPreview()`                  | Start preview mode                                                                        |
| `commitPreview(label)`            | Commit preview as command                                                                 |
| `cancelPreview()`                 | Cancel preview, restore state                                                             |

### ToolManager Methods

| Method                            | Description                                 |
| --------------------------------- | ------------------------------------------- |
| `activate(tool)`                  | Set the primary active tool                 |
| `handlePointerDown/Move/Up()`     | Route pointer events to GestureDetector     |
| `handleKeyDown/Up()`              | Route key events to active tool             |
| `requestTemporary(name, options)` | Switch to temporary tool (e.g., Space+Hand) |
| `returnFromTemporary()`           | Return to primary tool                      |

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
      this.editor.setCursor({ type: "crosshair" });
    }
  }

  activate(): void {
    this.state = { type: "ready" };
    this.editor.setCursor({ type: "default" });
  }
}
```

### Behavior semantics

Behaviors are tried in **array order**. The first behavior for which `canHandle(state, event)` is true wins; its `transition()` is used. Order matters when multiple behaviors could handle the same (state, event) pair. Intents are executed in `onTransition`: Pen runs intents in the tool’s `onTransition`; Select uses a shared `executeIntent(next.intent, context)`. Both patterns ensure “where are intents run?” is in one place (onTransition).

### Behavior interface and createBehavior

All tools (Hand, Shape, Pen, Select) use the same behavior pattern. The core exports a generic `Behavior<S, E>` interface and `createBehavior(impl)` helper. Hand and Shape use `createBehavior` for ReadyBehavior and DraggingBehavior (see `hand/behaviors/`, `shape/behaviors/`); Pen and Select use class-based behaviors. Use `createBehavior<MyState>({ canHandle, transition, onTransition?, render? })` for object-style behaviors.

### Behavior Pattern

Complex tools delegate state-specific logic to behavior classes or objects from `createBehavior`:

```typescript
import { createBehavior, type Behavior } from "../core";

type MyBehavior = Behavior<MyState, ToolEvent>;

class MyTool extends BaseTool<MyState> {
  private behaviors: MyBehavior[] = [HoverBehavior, DragBehavior];

  transition(state: MyState, event: ToolEvent): MyState {
    if (state.type === "idle") return state;
    for (const behavior of this.behaviors) {
      if (behavior.canHandle(state, event)) {
        const result = behavior.transition(state, event, this.editor);
        if (result !== null) return result;
      }
    }
    return state;
  }
}
```

### Adding a state

1. Add a variant to the state union (e.g. `| { type: "newState"; data: Data }`).
2. Add the state to `stateSpec.states` and add transitions to/from it in `stateSpec.transitions`.
3. Add transition branches in the tool’s `transition()` (or in a new behavior that canHandle the new state/event).
4. If there are side effects, add an onTransition branch or an intent and a case in executeIntent.

### Adding a behavior

1. Implement the behavior interface: `canHandle(state, event)`, `transition(state, event, editor)`, and optionally `onTransition`, `render`.
2. Insert the behavior in the tool’s `behaviors` array at the right position (first match wins).

### Preview Pattern for Drag Operations

```typescript
onTransition(prev: SelectState, next: SelectState, event: ToolEvent): void {
  // Start preview when drag begins
  if (prev.type === "selected" && next.type === "dragging") {
    this.editor.beginPreview();
  }

  // Commit when drag ends with actual movement
  if (prev.type === "dragging" && next.type === "selected") {
    if (event.type === "dragEnd") {
      const { totalDelta, draggedPointIds } = prev.drag;
      if ((totalDelta.x !== 0 || totalDelta.y !== 0) && draggedPointIds.length > 0) {
        this.editor.commitPreview("Move Points");
      } else {
        this.editor.cancelPreview();
      }
    } else {
      this.editor.cancelPreview();
    }
  }
}
```

## Creating a new tool

Checklist:

1. **Add tool id to ToolName** in `createContext.ts` (e.g. add `"myTool"` to the union), or document self-registration if introduced.
2. **Create tool class**: implement `id`, `initialState`, `transition`; optionally override `getCursor(state)` for state-based cursor (default is `{ type: "default" }`), and `activate`, `deactivate`, `onTransition`, `render`, `handleModifier`, `stateSpec`.
3. **Register**: in `tools.ts` call `editor.registerTool({ id, ToolClass, icon, tooltip, shortcut? })` so the tool and its shortcut are registered in one place.
4. **Shortcut** (optional): pass `shortcut: "m"` in the registerTool descriptor; Editor binds it via getToolShortcuts(), no separate key handler needed.
5. **When to use behaviors**: All tools use the behavior pattern. Use `createBehavior` for simple state machines (Hand, Shape); use class-based behaviors for many (state, event) handlers or split-by-concern (Pen, Select).
6. **When to use intents**: Use intents when the same state change can trigger different side effects (e.g. close vs continue contour); transition returns state with optional intent, onTransition executes the intent.

Minimal example (add to ToolName, then):

```typescript
class MyTool extends BaseTool<MyState> {
  readonly id: ToolName = "myTool";

  initialState(): MyState {
    return { type: "idle" };
  }

  transition(state: MyState, event: ToolEvent): MyState {
    if (state.type === "idle") return state;
    if (state.type === "ready" && event.type === "click") {
      return { type: "ready", lastPoint: event.point };
    }
    return state;
  }

  activate(): void {
    this.state = { type: "ready", lastPoint: { x: 0, y: 0 } };
  }
}
// In tools.ts: editor.registerTool({ id: "myTool", ToolClass: MyTool, icon: MyIcon, tooltip: "My Tool (M)", shortcut: "m" });
// No separate shortcut wiring; Editor uses getToolShortcuts() to bind keys.
```

Cursor defaults to `{ type: "default" }`; override `getCursor(state): CursorType` for state-based cursors.

Implement `activate()` so the tool enters a state that reacts to events (e.g. `"ready"`); otherwise the tool stays idle and will not handle events.

## Event flow (one-pager)

Where things happen:

- **Pointer** → InteractiveScene (React) → **ToolManager.handlePointerDown / handlePointerMove / handlePointerUp**
- ToolManager → **GestureDetector** (pointer → semantic events)
- GestureDetector emits **ToolEvent[]** (click, dragStart, drag, dragEnd, pointerMove, keyDown, etc.)
- ToolManager dispatches to **activeTool.handleEvent(event)**
- **BaseTool.handleEvent**: calls `transition(state, event)` → updates state and `setActiveToolState(next)` → calls **onTransition(prev, next, event)** (and intent execution)
- Redraw: **editor.requestRedraw()**; overlay: **tool.render(draw)**

So: “Where does X happen?” — pointer handling in ToolManager/GestureDetector, state change in tool.transition, side effects and intents in onTransition.

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
editor.requestRedraw()
      ↓
tool.render(renderer) → draw overlays
```

## Related Systems

- [editor](../editor/docs/DOCS.md) - Provides Editor services
- [commands](../commands/docs/DOCS.md) - Command execution and undo
- [reactive](../reactive/docs/DOCS.md) - Signals for state
- [graphics](../graphics/docs/DOCS.md) - Interactive rendering

## Plans

- [DrawAPI unification](DRAW_API_UNIFICATION.md) - Screen-stable drawing for tool overlays (zoom-correct line width, handle/cursor sizes)
