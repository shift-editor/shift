# Tools

State machine-based tool implementations for the Shift font editor.

## Overview

The tools library provides editing tools (Pen, Select, Hand, Shape, Text) built on a state machine pattern using `BaseTool`. Each tool manages its own state via discriminated unions, handles semantic events from `GestureDetector`, and renders interactive overlays. Tools are coordinated by `ToolManager` with keyboard shortcuts.

## Architecture

```
BaseTool<S, Settings>
├── id: ToolName
├── state: S
├── editor: EditorAPI
├── behaviors: Behavior<S>[]  (abstract)
├── initialState(): S
├── transition(state, event): S              (owns behavior loop)
├── preTransition?(state, event): { state: S } | null
├── onStateChange?(prev, next, event): void
├── render?(renderer): void
├── renderBelowHandles?(renderer): void
├── activate?() / deactivate?()
└── handleEvent(event): boolean

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

1. **State Machine Pattern**: Tools use discriminated union states and ordered behavior handlers
2. **Explicit Side Effects**: Side effects live in behavior handlers/hooks and `onStateChange`
3. **GestureDetector**: Converts raw pointer events to semantic events (click, drag, doubleClick)
4. **Editor Injection**: Tools receive the `Editor` instance, accessing services via `this.editor.serviceName`
5. **Behavior Pattern**: Complex tools delegate to behavior classes for cleaner separation
6. **Semantic Editor API**: Behaviors call explicit editor methods; command details stay in editor-layer operations
7. **High-frequency edits**: For drag-like gestures that run every frame (e.g. marquee rect), avoid expensive global writes on every event; commit once on dragEnd (or throttle) to keep the hot path cheap.

### Performance

- **Pointer → rAF**: Pointer handlers store input and request one rAF; projection, hit-test, and tool events run in the rAF callback so the synchronous handler stays minimal. Mouse position and other high-fan-out signals update at most once per frame.
- **Commit on end**: For drag-like gestures (e.g. marquee selection), commit global state changes on drag end, not on every drag event. Use local tool state for visual feedback during the gesture.
- **Signal → React boundary**: Effects that subscribe to signals and call React `setState` should only update when the displayed value actually changes (e.g. compare to previous or use a guarded setState) to avoid unnecessary re-renders.
- **Stable state references and cheap cursor**: Return the same state object reference when the logical state has not changed so commit hooks are not invoked unnecessarily. Keep `getCursor` and other code on the cursor path cheap and minimal in signal reads.

## Key Concepts

### BaseTool

Abstract base class all tools extend:

```typescript
abstract class BaseTool<S extends ToolState, Settings = Record<string, never>> {
  abstract readonly id: ToolName;
  abstract readonly behaviors: Behavior<S>[];
  readonly $cursor: ComputedSignal<CursorType>; // from getCursor(activeToolState)
  state: S;
  protected editor: EditorAPI;

  getCursor(state: S): CursorType; // default: { type: "default" }; override for state-based cursor
  abstract initialState(): S;

  // Optional hooks
  protected preTransition?(state: S, event: ToolEvent): { state: S } | null;
  protected onStateChange?(prev: S, next: S, event: ToolEvent): void;

  render?(renderer: DrawAPI): void;
  renderBelowHandles?(renderer: DrawAPI): void;
  activate?(): void;
  deactivate?(): void;

  handleEvent(event: ToolEvent): boolean;

  // Helpers
  protected batch<T>(name: string, fn: () => T): T;
}
```

BaseTool owns behavior dispatch. Tools do NOT override dispatch internals; they declare `behaviors` and optionally override hooks.

The `transition()` method in BaseTool:

1. Returns early if state is `"idle"`
2. Calls `preTransition()` if defined (short-circuit before behaviors)
3. Iterates `behaviors` in array order and dispatches by event-type handler (`onClick`, `onDrag`, etc.)
4. First handler returning `true` wins
5. Returns the resulting state

The `handleEvent()` method commits and notifies:

1. Runs behavior dispatch and computes `next` state
2. If state changed: calls all `onStateExit` hooks
3. Commits state and updates `editor.setActiveToolState(next)`
4. Calls all `onStateEnter` hooks
5. Calls `onStateChange(prev, next, event)` if defined
### ToolEvent

Semantic events produced by GestureDetector:

```typescript
type ToolEvent =
  | { type: "pointerMove"; point: Point2D }
  | { type: "click"; point: Point2D; shiftKey: boolean; altKey: boolean; metaKey: boolean }
  | { type: "doubleClick"; point: Point2D }
  | {
      type: "dragStart";
      point: Point2D;
      screenPoint: Point2D;
      shiftKey: boolean;
      altKey: boolean;
      metaKey: boolean;
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
      metaKey: boolean;
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

Use **getNodeAt(pos)** to answer "what's under this position?" with consistent priority: contour endpoint → middle point → point → segment. It returns a `HitResult`; use type guards (`isPointHit`, `isSegmentHit`, `isContourEndpointHit`, `isMiddlePointHit`) and read `hit.point`, `hit.segment`, `hit.segmentId`, `hit.pointId` from the result. For point-like hits (point, contour endpoint, middle point) use **getPointIdFromHit(hit)** to get `pointId`. Do not call **getSegmentById** when you already have a segment from a hit (e.g. `isSegmentHit(hit)` → use `hit.segment`). Use **getSegmentById(segmentId)** only when you have a segment id from state or persisted ids, not from a position hit.

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
| `behaviors` (abstract)              | Array of `Behavior<S>` tried in order; first handler returning `true` wins                                                                                                                                                                            |
| `preTransition(state, event)`       | Optional hook to short-circuit before behaviors run; return `{ state }` or `null`                                                                                                                                                                    |
| `onStateChange(prev, next, event)`  | Optional hook for tool-specific post-transition logic                                                                                                                                                                                                 |
| `render(renderer)`                  | Draw interactive overlays                                                                                                                                                                                                                             |
| `renderBelowHandles(renderer)`      | Draw overlays below handles                                                                                                                                                                                                                           |
| `activate()`                        | Called when tool becomes active                                                                                                                                                                                                                       |
| `deactivate()`                      | Called when tool becomes inactive                                                                                                                                                                                                                     |
| `handleEvent(event)`                | Process a ToolEvent                                                                                                                                                                                                                                   |
| `batch(name, fn)`                   | Execute commands in a batch                                                                                                                                                                                                                           |

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

BaseTool owns `transition()` and `handleEvent()` internals — tools do not override dispatch internals. Instead, tools declare `behaviors` and optionally override `preTransition` and `onStateChange`.

### Behavior semantics

Behaviors are tried in **array order**. For the current event type, BaseTool calls the matching handler (`onClick`, `onDragStart`, etc.). The first handler that returns `true` wins. Handler logic can mutate editor state directly and/or update tool state via `ctx.setState(...)`.

### Behavior interface and createBehavior

All tools (Hand, Shape, Pen, Select) use the same behavior pattern. The core exports `Behavior<S>` and `createBehavior(impl)`. Behaviors handle events and state transitions; tools own rendering in `render()` / `renderBelowHandles()`.

### Behavior Pattern

Complex tools delegate state-specific logic to behavior classes or objects from `createBehavior`:

```typescript
import { createBehavior, type Behavior } from "../core";

type MyBehavior = Behavior<MyState>;

class MyTool extends BaseTool<MyState> {
  readonly behaviors: MyBehavior[] = [HoverBehavior, TranslateBehavior];

  // No need to override transition()/handleEvent() internals —
  // BaseTool handles the behavior loop and state commit hooks.
}
```

For behaviors with side effects, call semantic EditorAPI methods directly:

```typescript
type MyBehavior = Behavior<MyState>;

class MyTool extends BaseTool<MyState> {
  readonly behaviors: MyBehavior[] = [SomeBehavior, OtherBehavior];
}
```

### Adding a state

1. Add a variant to the state union (e.g. `| { type: "newState"; data: Data }`).
2. Add the state to `stateSpec.states` and add transitions to/from it in `stateSpec.transitions`.
3. Add event handlers in a behavior for the new state/event combination.
4. If the behavior needs a new domain operation, add a semantic method on `EditorAPI` and implement it in `Editor`.

### Adding a behavior

1. Implement event handlers (`onClick`, `onDragStart`, `onDrag`, `onKeyDown`, etc.) and optional `onStateExit` / `onStateEnter`.
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
2. **Create tool class**: implement `id`, `behaviors`, `initialState`; optionally override `getCursor(state)` (default `{ type: "default" }`), plus `activate`, `deactivate`, `onStateChange`, `render`, `stateSpec`.
3. **Register**: in `tools.ts` call `editor.registerTool({ id, ToolClass, icon, tooltip, shortcut? })` so the tool and its shortcut are registered in one place.
4. **Shortcut** (optional): pass `shortcut: "m"` in the registerTool descriptor; Editor binds it via getToolShortcuts(), no separate key handler needed.
5. **When to use behaviors**: All tools use the behavior pattern. Use `createBehavior` for simple state machines (Hand, Shape); use class-based behaviors for many (state, event) handlers or split-by-concern (Pen, Select).
6. **When to add Editor methods**: Add a new semantic `EditorAPI` method when behavior logic would otherwise instantiate low-level commands directly or duplicate mutation rules across tools.

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
- **BaseTool.handleEvent**: runs behavior dispatch → if state changed, calls `onStateExit` hooks, commits state, calls `onStateEnter` hooks, then `onStateChange`
- Redraw: **editor.requestRedraw()**; overlay: **tool.render(draw)**

So: "Where does X happen?" — pointer handling in ToolManager/GestureDetector, state dispatch in BaseTool, side effects in behavior handlers/hooks plus `onStateChange`.

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
tool.transition(state, event) → next state (behavior loop only)
      ↓
tool.handleEvent(event) commit → behavior onStateExit/onStateEnter + onStateChange
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
