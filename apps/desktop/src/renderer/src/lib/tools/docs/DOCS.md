# Tools

State machine-based tool implementations for the Shift font editor.

## Overview

The tools library provides editing tools (Pen, Select, Hand, Shape, Text) built on a state machine pattern using `BaseTool`. Each tool manages its own state via discriminated unions, handles semantic events from `GestureDetector`, and renders interactive overlays. Tools are coordinated by `ToolManager` with keyboard shortcuts.

## Architecture

```
BaseTool<S, A>
├── id: ToolName
├── state: S
├── editor: ToolContext
├── behaviors: Behavior<S, ToolEvent, A>[]  (abstract)
├── initialState(): S
├── transition(state, event): S              (owns behavior loop)
├── preTransition?(state, event): TransitionResult | null
├── executeAction?(action, prev, next): void
├── onStateChange?(prev, next, event): void
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
│   └── actions.ts
├── select/                  # Point selection and manipulation
│   ├── Select.ts
│   ├── behaviors/           # State-specific behavior handlers
│   ├── cursor.ts
│   ├── actions.ts
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
6. **Action Pattern**: State transitions produce actions, executed by BaseTool in `onTransition` via `executeAction`
7. **High-frequency actions**: For drag-like gestures that run every frame (e.g. marquee rect), avoid emitting actions that update selection or other global signals on every event; commit once on dragEnd (or throttle) to keep the hot path cheap.

### Performance

- **Pointer → rAF**: Pointer handlers store input and request one rAF; projection, hit-test, and tool events run in the rAF callback so the synchronous handler stays minimal. Mouse position and other high-fan-out signals update at most once per frame.
- **Action commit on end**: For drag-like gestures (e.g. marquee selection), emit actions that update global state (e.g. selection) only on gesture end (e.g. dragEnd), not on every drag event. Use local/transition state for visual feedback during the gesture.
- **Signal → React boundary**: Effects that subscribe to signals and call React `setState` should only update when the displayed value actually changes (e.g. compare to previous or use a guarded setState) to avoid unnecessary re-renders.
- **Stable state references and cheap cursor**: Return the same state object reference when the logical state has not changed so `setActiveToolState` and `onTransition` are not invoked unnecessarily. Keep `getCursor` and other code on the cursor path cheap and minimal in signal reads.

## Key Concepts

### BaseTool

Abstract base class all tools extend:

```typescript
abstract class BaseTool<S extends ToolState, A = never, Settings = Record<string, never>> {
  abstract readonly id: ToolName;
  abstract readonly behaviors: Behavior<S, ToolEvent, A>[];
  readonly $cursor: ComputedSignal<CursorType>; // from getCursor(activeToolState)
  state: S;
  protected editor: ToolContext;

  getCursor(state: S): CursorType; // default: { type: "default" }; override for state-based cursor
  abstract initialState(): S;

  // Optional hooks
  protected preTransition?(state: S, event: ToolEvent): { state: S; action?: A } | null;
  protected executeAction?(action: A, prev: S, next: S): void;
  protected onStateChange?(prev: S, next: S, event: ToolEvent): void;

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

BaseTool owns the behavior loop and action mediation internally. Tools do NOT manually write `transition()` or manage `#pendingAction` — they declare `behaviors` and optionally override the hooks above.

The `transition()` method in BaseTool:

1. Returns early if state is `"idle"`
2. Calls `preTransition()` if defined (short-circuit before behaviors)
3. Iterates `behaviors` in array order; first `canHandle` match wins
4. Stores `result.action` internally as `#pendingAction`
5. Returns `result.state`

The `onTransition()` method in BaseTool:

1. If `#pendingAction` exists and `executeAction` is defined, calls `executeAction(action, prev, next)`
2. Calls `onTransition` on each behavior
3. Calls `onStateChange(prev, next, event)` if defined

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
      key: ToolKey | (string & {});
      shiftKey: boolean;
      altKey: boolean;
      metaKey: boolean;
    }
  | { type: "keyUp"; key: ToolKey | (string & {}) };
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

### Hit testing

Use **getNodeAt(pos)** to answer "what's under this position?" with consistent priority: contour endpoint → middle point → point → segment. It returns a `HitResult`; use type guards (`isPointHit`, `isSegmentHit`, `isContourEndpointHit`, `isMiddlePointHit`) and read `hit.point`, `hit.segment`, `hit.segmentId`, `hit.pointId` from the result. For point-like hits (point, contour endpoint, middle point) use **getPointIdFromHit(hit)** to get `pointId`. Do not call **getSegmentById** when you already have a segment from a hit (e.g. `isSegmentHit(hit)` → use `hit.segment`). Use **getSegmentById(segmentId)** only when you have a segment id from elsewhere (e.g. from an action payload), not from a position hit.

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
             │        │ translating │   │  resizing  │   │
             │        │             │   │            │   │
             │        └──────┬──────┘   └─────┬──────┘   │
             │               │                │          │
             │               │ dragEnd        │ dragEnd  │
             └───────────────┴────────────────┴──────────┘
```

#### States

| State         | Description                                  | Data                      |
| ------------- | -------------------------------------------- | ------------------------- |
| `idle`        | Tool not active                              | -                         |
| `ready`       | Waiting for interaction, no selection        | -                         |
| `selecting`   | Drawing marquee rectangle                    | `startPos`, `currentPos`  |
| `selected`    | Points selected, can translate/resize/rotate | -                         |
| `translating` | Moving selected points                       | `startPos`, `totalDelta`  |
| `resizing`    | Scaling via bounding box handles             | `edge`, `anchor`, `scale` |
| `rotating`    | Rotating via corner zones                    | `center`, `angle`         |

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

| Method                              | Description                                                                                                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getCursor(state)`                  | Return cursor for state (default: `{ type: "default" }`); override for state-based cursor. May read `editor.hoveredPointId`, `editor.hoveredSegmentId`, `editor.hoveredBoundingBoxHandle`, and `editor.currentModifiers` for reactive cursor updates. |
| `initialState()`                    | Return the initial state                                                                                                                                                                                                                              |
| `behaviors` (abstract)              | Array of `Behavior<S, ToolEvent, A>` tried in order; first `canHandle` match wins                                                                                                                                                                     |
| `preTransition(state, event)`       | Optional hook to short-circuit before behaviors run; return `{ state, action? }` or `null`                                                                                                                                                            |
| `executeAction(action, prev, next)` | Optional hook for action side effects (action-aware tools like Pen, Select)                                                                                                                                                                           |
| `onStateChange(prev, next, event)`  | Optional hook for tool-specific post-transition logic                                                                                                                                                                                                 |
| `render(renderer)`                  | Draw interactive overlays                                                                                                                                                                                                                             |
| `activate()`                        | Called when tool becomes active                                                                                                                                                                                                                       |
| `deactivate()`                      | Called when tool becomes inactive                                                                                                                                                                                                                     |
| `handleEvent(event)`                | Process a ToolEvent                                                                                                                                                                                                                                   |
| `batch(name, fn)`                   | Execute commands in a batch                                                                                                                                                                                                                           |
| `beginPreview()`                    | Start preview mode                                                                                                                                                                                                                                    |
| `commitPreview(label)`              | Commit preview as command                                                                                                                                                                                                                             |
| `cancelPreview()`                   | Cancel preview, restore state                                                                                                                                                                                                                         |

### ToolContext (cursor and hover)

Tools receive `this.editor` (ToolContext). For cursor and hover feedback, the context exposes:

| Member                     | Description                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `hoveredBoundingBoxHandle` | `Signal<BoundingBoxHitResult>` -- handle under cursor when selection has bounding box   |
| `hoveredPointId`           | `Signal<PointId \| null>` -- point under cursor                                         |
| `hoveredSegmentId`         | `Signal<SegmentIndicator \| null>` -- segment under cursor                              |
| `isHoveringNode`           | `Signal<boolean>` -- true when over a point or segment (outline node)                   |
| `currentModifiers`         | `Signal<Modifiers>` -- current shift/alt/meta state (updated on pointer and key events) |
| `setCurrentModifiers?`     | Optional; used by ToolManager to update modifier state (implementers only)              |

Reading these signals inside `getCursor(state)` makes the cursor computed re-run when hover or modifiers change.

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
  readonly behaviors: Behavior<MyState, ToolEvent>[] = [];

  initialState(): MyState {
    return { type: "idle" };
  }

  activate(): void {
    this.state = { type: "ready", lastPoint: { x: 0, y: 0 } };
  }
}
```

BaseTool owns `transition()` and `onTransition()` — tools do not override them. Instead, tools declare `behaviors` and optionally override `preTransition`, `executeAction`, and `onStateChange`.

### Behavior semantics

Behaviors are tried in **array order**. The first behavior for which `canHandle(state, event)` is true wins; its `transition()` returns a `TransitionResult<S, A>` containing both the next state and an optional action. BaseTool unwraps the result internally: it uses `result.state` as the next state and stores `result.action` in an internal `#pendingAction` field. Actions are executed in `onTransition` via BaseTool calling `executeAction(action, prev, next)` — Pen implements `executeAction` to run pen-specific side effects; Select implements `executeAction` to dispatch select actions. This ensures "where are actions run?" is in one place (`executeAction`). State types carry no `action` field — actions flow through `TransitionResult`, not through state.

### Behavior interface and createBehavior

All tools (Hand, Shape, Pen, Select) use the same behavior pattern. The core exports a generic `Behavior<S, E, A>` interface, `TransitionResult<S, A>` type, and `createBehavior(impl)` helper. Behaviors are state-transition only — they do NOT render. Tools own all rendering in their `render()` method. Hand and Shape use `createBehavior` for ReadyBehavior and DraggingBehavior (see `hand/behaviors/`, `shape/behaviors/`); Pen and Select use class-based behaviors. Use `createBehavior<MyState>({ canHandle, transition, onTransition? })` for object-style behaviors.

### Behavior Pattern

Complex tools delegate state-specific logic to behavior classes or objects from `createBehavior`:

```typescript
import { createBehavior, type Behavior, type TransitionResult } from "../core";

type MyBehavior = Behavior<MyState, ToolEvent>;

class MyTool extends BaseTool<MyState> {
  readonly behaviors: MyBehavior[] = [HoverBehavior, TranslateBehavior];

  // No need to override transition() — BaseTool handles the behavior loop.
  // No need to override onTransition() — BaseTool calls behavior.onTransition
  // and then onStateChange() for tool-specific logic.
}
```

For action-aware tools (Pen, Select), implement `executeAction`:

```typescript
type MyAction = { type: "doSomething"; data: Data } | { type: "doOther" };
type MyBehavior = Behavior<MyState, ToolEvent, MyAction>;

class MyTool extends BaseTool<MyState, MyAction> {
  readonly behaviors: MyBehavior[] = [SomeBehavior, OtherBehavior];

  protected executeAction(action: MyAction, prev: MyState, next: MyState): void {
    switch (action.type) {
      case "doSomething":
        this.editor.doSomething(action.data);
        break;
      case "doOther":
        this.editor.doOther();
        break;
    }
  }
}
```

### Adding a state

1. Add a variant to the state union (e.g. `| { type: "newState"; data: Data }`).
2. Add the state to `stateSpec.states` and add transitions to/from it in `stateSpec.transitions`.
3. Add transition branches in a new behavior that `canHandle` the new state/event.
4. If there are side effects, add an action type and a case in `executeAction`.

### Adding a behavior

1. Implement the behavior interface: `canHandle(state, event)`, `transition(state, event, editor)` returning `TransitionResult<S, A> | null`, and optionally `onTransition`.
2. Insert the behavior in the tool's `behaviors` array at the right position (first match wins).
3. Behaviors are state-only — they do NOT render. All rendering belongs in the tool's `render()` method.

### Preview Pattern for Drag Operations

```typescript
protected onStateChange(prev: SelectState, next: SelectState, event: ToolEvent): void {
  // Start preview when drag begins
  if (prev.type === "selected" && next.type === "translating") {
    this.editor.beginPreview();
  }

  // Commit when translate ends with actual movement
  if (prev.type === "translating" && next.type === "selected") {
    if (event.type === "dragEnd") {
      const { totalDelta, draggedPointIds } = prev.translate;
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
2. **Create tool class**: implement `id`, `behaviors`, `initialState`; optionally override `getCursor(state)` for state-based cursor (default is `{ type: "default" }`), and `activate`, `deactivate`, `executeAction`, `onStateChange`, `render`, `stateSpec`.
3. **Register**: in `tools.ts` call `editor.registerTool({ id, ToolClass, icon, tooltip, shortcut? })` so the tool and its shortcut are registered in one place.
4. **Shortcut** (optional): pass `shortcut: "m"` in the registerTool descriptor; Editor binds it via getToolShortcuts(), no separate key handler needed.
5. **When to use behaviors**: All tools use the behavior pattern. Use `createBehavior` for simple state machines (Hand, Shape); use class-based behaviors for many (state, event) handlers or split-by-concern (Pen, Select).
6. **When to use actions**: Use actions when the same state change can trigger different side effects (e.g. close vs continue contour); transition returns state with optional action, BaseTool calls `executeAction` with the action.

Minimal example (add to ToolName, then):

```typescript
class MyTool extends BaseTool<MyState> {
  readonly id: ToolName = "myTool";
  readonly behaviors: Behavior<MyState, ToolEvent>[] = [];

  initialState(): MyState {
    return { type: "idle" };
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
- **BaseTool.handleEvent**: calls `transition(state, event)` → updates state and `setActiveToolState(next)` → calls **onTransition(prev, next, event)** (runs `executeAction`, behavior `onTransition`, and `onStateChange`)
- Redraw: **editor.requestRedraw()**; overlay: **tool.render(draw)**

So: "Where does X happen?" — pointer handling in ToolManager/GestureDetector, state change in BaseTool.transition (behavior loop), side effects and actions in onTransition (executeAction + onStateChange).

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
tool.transition(state, event) → new state (behavior loop + action capture)
      ↓
tool.onTransition(prev, next, event) → executeAction + behavior hooks + onStateChange
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
