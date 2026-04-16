# Tools

State machine-based tool system for the Shift font editor: translates pointer/keyboard input into tool-specific state transitions and rendering.

## Architecture Invariants

- **Architecture Invariant:** Every tool must call `activate()` to leave `"idle"` state. `BaseTool` skips the behavior loop entirely when `state.type === "idle"`, so a tool that forgets `activate()` will silently ignore all events.

- **Architecture Invariant:** Behaviors are tried in **array order**; first handler that returns `true` wins. Reordering the `behaviors` array changes tool semantics. **CRITICAL**: placing a broad handler (e.g. `Selection`) before a narrow one (e.g. `ToggleSmooth`) will shadow the narrow handler.

- **Architecture Invariant:** Behaviors are stateless transition rules. All mutable state lives in the tool state union `S` or on `Editor`. Behaviors must not hold state that survives across events (private fields for long-lived resources like `GlyphDraft` or `DragSnapSession` are the exception, cleaned up in `onStateEnter`/`onStateExit`).

- **Architecture Invariant:** Behaviors do NOT render. All rendering belongs in the tool's `renderOverlay` / `renderScene` / `renderBackground` methods.

- **Architecture Invariant:** `ToolManager` coalesces pointer-move events via `requestAnimationFrame`. The synchronous pointer handler only stores input; projection, hit-test, and tool dispatch run in the rAF callback. **CRITICAL**: reading layout-dependent state synchronously in the pointer handler will see stale data.

- **Architecture Invariant:** `ToolContext.setState` inside a behavior's event handler updates a local `nextState` variable, not `this.state` on the tool. `BaseTool` commits the new state and fires lifecycle hooks (`onStateExit`, `onStateEnter`, `onStateChange`) only after the behavior loop returns. Calling `setState` multiple times within one handler is legal; only the final value is committed.

- **Architecture Invariant:** For drag operations that mutate the glyph (translate, resize, rotate, bend), use the draft pattern: `editor.createDraft()` on drag start, `draft.setPositions()` on each drag event, `draft.finish(label)` on drag end, `draft.discard()` on cancel. **CRITICAL**: forgetting `finish` or `discard` leaks the draft and leaves the glyph in preview state.

- **Architecture Invariant:** `ToolEvent` pointer events carry a `coords: Coordinates` bundle (`screen`, `scene`, `glyphLocal`). Use `event.coords` for hit-testing and layout; `event.point` is an alias for `coords.scene`. **CRITICAL**: using raw `event.point` when glyph-local coordinates are needed (e.g. pen cursor position) produces wrong results when draw offset is non-zero.

## Codemap

```
tools/
  core/
    BaseTool.ts          — abstract base class; owns behavior loop and state lifecycle
    Behavior.ts          — Behavior<S> interface and createBehavior helper
    GestureDetector.ts   — pointer+timing -> ToolEvent (click, drag, doubleClick, ...)
    ToolManager.ts       — tool orchestration, rAF coalescing, temporary tool override
    ToolManifest.ts      — ToolManifest registration descriptor
    StateDiagram.ts      — defineStateDiagram, transitionInDiagram for compliance tests
    ToolStateMap.ts      — union map of all built-in tool states
    createContext.ts     — ToolName, ToolState, BUILT_IN_TOOL_IDS
  hand/                  — canvas panning (createBehavior style)
  pen/                   — bezier curve drawing (class-based behaviors)
  select/                — point/segment selection, translate, resize, rotate, bend
  shape/                 — rectangle creation (createBehavior style)
  text/                  — text run editing
  tools.ts               — registerBuiltInTools (wires all tools + shortcuts)
```

## Key Types

- `BaseTool<S, Settings>` — abstract base class all tools extend. Declares `id`, `behaviors`, `initialState`. Optional overrides: `preTransition`, `onStateChange`, `getCursor`, `activate`, `deactivate`, `renderOverlay`, `renderScene`, `renderBackground`.
- `Behavior<S>` — interface with optional per-event handlers (`onClick`, `onDrag`, `onDragStart`, `onDragEnd`, `onDragCancel`, `onPointerMove`, `onDoubleClick`, `onKeyDown`, `onKeyUp`) plus lifecycle hooks (`onStateExit`, `onStateEnter`). Each handler receives `(state, ctx, event)` and returns `boolean` (true = handled).
- `ToolContext<S>` — `{ editor, getState, setState }`. Passed to behaviors during the event loop and lifecycle hooks.
- `ToolEvent` — discriminated union of semantic events: `pointerMove`, `click`, `doubleClick`, `dragStart`, `drag`, `dragEnd`, `dragCancel`, `keyDown`, `keyUp`, `selectionChanged`. Pointer events include `coords: Coordinates`.
- `ToolEventOf<T>` — utility type extracting a single variant from `ToolEvent` by its `type` string.
- `ToolManager` — owns the active tool, `GestureDetector`, rAF pointer coalescing, and temporary tool switching.
- `GestureDetector` — stateful recognizer: drag threshold, double-click timing. Fed raw `pointerDown`/`Move`/`Up`, emits `ToolEvent[]`.
- `ToolManifest` — `{ id, create, icon, tooltip, shortcut? }`. Registration descriptor passed to `editor.registerTool`.
- `StateDiagram` — `{ states, initial, transitions }`. Declarative spec for compliance testing.
- `ToolName` — `string` (not a fixed union; extensible for plugins).
- `ToolState` — `{ type: string }` base interface for all tool state unions.
- `Coordinates` — `{ screen, scene, glyphLocal }` bundle on pointer events.
- `Modifiers` — `{ shiftKey, altKey, metaKey? }`.

## How it works

### Event flow

```
User pointer/key
  -> InteractiveScene (React)
  -> ToolManager.handlePointerDown/Move/Up / handleKeyDown/Up
  -> GestureDetector (raw pointer -> ToolEvent[])
  -> BaseTool.handleEvent(event)
  -> #runBehaviors (behavior loop)
  -> state commit + lifecycle hooks
  -> editor.requestRedraw / requestOverlayRedraw
  -> tool.renderOverlay / renderScene / renderBackground
```

### Behavior loop (`#runBehaviors`)

1. If `state.type === "idle"`, return immediately (no handling).
2. If `preTransition` is defined and returns non-null, short-circuit with that state.
3. Create a `ToolContext` with a local `nextState` variable.
4. Iterate `behaviors` in array order. For each behavior, look up the handler matching `event.type` (e.g. `onClick` for a `"click"` event). If the handler exists and returns `true`, stop iteration.
5. Return `{ state: nextState, handled }`.

### State commit (`handleEvent`)

After `#runBehaviors`, if `next !== prev` (reference equality):

1. **Batch** all side effects inside a single reactive `batch()`.
2. Call `onStateExit` on every behavior (receives `prev`, `next`, a pre-commit context).
3. Commit: `this.state = next`, `editor.setActiveToolState(next)`.
4. Call `onStateEnter` on every behavior (receives `prev`, `next`, a post-commit context where `setState` updates `this.state`).
5. Call `onStateChange(prev, next, event)` if defined on the tool.

### Pointer coalescing

`ToolManager.handlePointerMove` stores the latest screen point and schedules a single `requestAnimationFrame`. The rAF callback (`flushPointerMove`) does coordinate projection, feeds `GestureDetector`, dispatches resulting events, updates hover (when not dragging), and requests an overlay redraw.

### Temporary tool override

`ToolManager.requestTemporary(toolId, options?)` activates an override tool (e.g. Hand via Space bar). `returnFromTemporary()` restores the primary tool. Blocked during an active drag.

### Draft pattern for drag mutations

Behaviors that move geometry (Translate, Resize, Rotate, BendCurve) use `GlyphDraft`:

1. `editor.createDraft()` on drag start -- snapshots the glyph.
2. `draft.setPositions(updates)` on each drag event -- applies deltas to the snapshot.
3. `draft.finish(label)` on drag end -- commits as an undoable command.
4. `draft.discard()` on drag cancel -- restores the original snapshot.

### Rendering layers

Tools can implement up to three rendering hooks, each tied to a different redraw frequency:

- `renderBackground(canvas)` — layer 0, redraws on viewport/font change (e.g. text runs).
- `renderScene(canvas)` — layer 1, redraws on edit/selection/hover change (e.g. guides, handles).
- `renderOverlay(canvas)` — layer 2, redraws every mouse move (e.g. selection marquee, pen preview).

All three receive a `Canvas` instance.

### Cursor

`BaseTool.$cursor` is a computed signal derived from `getCursor(state)`. Override `getCursor` to return state-dependent cursors. Inside `getCursor`, reading `editor.getHoveredBoundingBoxHandle()`, `editor.getCurrentModifiers()`, or `editor.getIsHoveringNode()` makes the cursor reactive to hover and modifier changes.

## Workflow recipes

### Creating a new tool

1. Define a state union type (must extend `ToolState`): `type MyState = { type: "idle" } | { type: "ready" } | ...`.
2. Create the tool class extending `BaseTool<MyState>`:
   - Set `readonly id: ToolName = "myTool"`.
   - Declare `readonly behaviors: Behavior<MyState>[] = [...]`.
   - Implement `initialState()` returning `{ type: "idle" }`.
   - Implement `activate()` setting `this.state = { type: "ready" }`.
3. Optionally add `static stateSpec = defineStateDiagram(...)` for compliance testing.
4. Register in `registerBuiltInTools` (`tools.ts`): `editor.registerTool({ id, create, icon, tooltip, shortcut? })`.

### Adding a behavior (createBehavior style)

For simple tools (Hand, Shape):

```typescript
export const MyReadyBehavior = createBehavior<MyState>({
  onDragStart(state, ctx, event) {
    if (state.type !== "ready") return false;
    ctx.setState({ type: "dragging", startPos: event.point });
    return true;
  },
});
```

### Adding a behavior (class style)

For complex tools (Select, Pen) where behaviors need private helper methods or hold resources:

```typescript
export class MyBehavior implements Behavior<MyState> {
  onDragStart(state: MyState, ctx: ToolContext<MyState>, event: ToolEventOf<"dragStart">): boolean {
    if (state.type !== "ready") return false;
    ctx.setState({ type: "dragging", startPos: event.point });
    return true;
  }

  onStateEnter(prev: MyState, next: MyState, ctx: ToolContext<MyState>): void {
    // cleanup when leaving the state this behavior manages
  }
}
```

### Adding a state

1. Add a variant to the state union: `| { type: "newState"; data: Data }`.
2. If using `stateSpec`, add the state to `states` and add transitions.
3. Create a behavior (or extend an existing one) with handlers that guard on `state.type === "newState"`.
4. Insert the behavior at the right position in the tool's `behaviors` array.

### Using the draft pattern for drag mutations

```typescript
onDragStart(state, ctx, event) {
  if (state.type !== "selected") return false;
  this.#draft = ctx.editor.createDraft();
  ctx.setState({ type: "translating", startPos: event.point, totalDelta: { x: 0, y: 0 } });
  return true;
}

onDrag(state, ctx, event) {
  if (state.type !== "translating") return false;
  this.#draft!.setPositions(buildUpdates(this.#draft!.base, event.delta));
  ctx.setState({ ...state, totalDelta: event.delta });
  return true;
}

onDragEnd(state, ctx) {
  if (state.type !== "translating") return false;
  this.#draft!.finish("Move Points");
  this.#draft = null;
  ctx.setState({ type: "selected" });
  return true;
}

onDragCancel(state, ctx) {
  if (state.type !== "translating") return false;
  this.#draft!.discard();
  this.#draft = null;
  ctx.setState({ type: "selected" });
  return true;
}
```

## Gotchas

- **`preTransition` short-circuits the entire behavior loop.** If it returns non-null, no behavior sees the event. Use sparingly for events that must be handled before any behavior (e.g. `selectionChanged` in Select, `pointerMove` in Pen ready state).

- **Behavior handler return value matters.** Returning `false` (or `undefined`) means "I did not handle this"; the loop continues to the next behavior. Returning `true` stops the loop. Forgetting to return `true` after calling `ctx.setState` means another behavior may also handle the event and overwrite the state.

- **State identity is reference equality.** `handleEvent` only fires lifecycle hooks when `next !== prev`. If a behavior calls `ctx.setState(state)` with the same object reference, no hooks fire. For no-op transitions, simply return `true` without calling `setState`.

- **`onStateExit` / `onStateEnter` run on ALL behaviors**, not just the one that handled the event. Guard on the state types you care about.

- **`ToolName` is `string`, not a fixed union.** The `BUILT_IN_TOOL_IDS` constant lists known IDs (`select`, `pen`, `hand`, `shape`, `text`, `disabled`) but the type is open for plugin tools.

## Verification

- `pnpm vitest run apps/desktop/src/renderer/src/lib/tools/` — unit and compliance tests.
- `StateDiagram.compliance.test.ts` — verifies every `transition()` result is a valid state in the tool's `stateSpec` and that state changes match declared transitions.
- `GestureDetector.test.ts` — drag threshold, double-click timing, event emission.
- `ToolManager.test.ts` — tool activation, temporary override, rAF coalescing, modifier forwarding.
- Per-tool tests: `Hand.outcome.test.ts`, `Shape.outcome.test.ts`, `Pen.test.ts`, `Select.test.ts`, `Text.test.ts`.

## Related

- `Editor` — provides all services tools access via `this.editor` (hit-testing, selection, hover, commands, viewport, glyph, snapping).
- `Canvas` — rendering target passed to `renderOverlay` / `renderScene` / `renderBackground`.
- `GlyphDraft` — preview-and-commit pattern for drag mutations (translate, resize, rotate, bend).
- `DragSnapSession` — snapping during point drags; created via `editor.createDragSnapSession`.
- `Coordinates` — `{ screen, scene, glyphLocal }` coordinate bundle on pointer events.
- `TextRunController` — text input controller used by Text tool.
- `KeyboardRouter` — binds tool shortcuts registered via `getToolShortcuts`.
