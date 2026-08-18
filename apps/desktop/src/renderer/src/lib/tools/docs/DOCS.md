# Tools

<!-- reviewed: 2026-08-18 -->

State machine-based tool system for the Shift font editor: translates pointer/keyboard input into tool-specific state transitions and rendering.

## Architecture Invariants

- **Architecture Invariant:** Every tool must call `activate()` to leave `"idle"` state. `BaseTool` skips the behavior loop entirely when `state.type === "idle"`, so a tool that forgets `activate()` will silently ignore all events.

- **Architecture Invariant:** Lifecycle methods mutate tool state through `BaseTool.setState()`, never by assigning `this.state`. The method publishes one coherent value to `state` and `stateCell`; `Editor.toolCell` pulls the active instance's `stateCell`. Direct assignment leaves editor tool state, cursor, and editing computations stale.

- **Architecture Invariant:** A temporary override masks the resident primary tool without deactivating or reactivating it. Returning from Hand must preserve tool-local editing scope such as Pen's active open contour. Replacing or removing the primary is a different, permanent transition and calls `deactivate()` followed by `dispose()`.

- **Architecture Invariant:** A `ToolRegistration` exclusively owns one installed ID. Unrelated duplicate IDs are rejected; `replace()` keeps the ownership and selected ID, while `dispose()` is permanent and idempotent. Consumers must retain this handle for runtime update or removal.

- **Architecture Invariant:** Behaviors are tried in **array order**; first handler that returns `true` wins. Reordering the `behaviors` array changes tool semantics. **CRITICAL**: placing a broad handler (e.g. `Selection`) before a narrow one (e.g. `ToggleSmooth`) will shadow the narrow handler.

- **Architecture Invariant:** Behaviors are stateless transition rules. All mutable state lives in the tool state union `S` or on `Editor`. A behavior may retain an edit across drag events only when it registers rollback through `ToolContext.onCancel()` and dismisses that rollback after a successful commit.

- **Architecture Invariant:** Behaviors do NOT render. All rendering belongs in the tool's `drawOverlay` / `drawScene` / `drawBackground` methods.

- **Architecture Invariant:** `ToolManager` coalesces pointer-move events via `requestAnimationFrame`. The synchronous pointer handler only stores input; projection, hit-test, and tool dispatch run in the rAF callback. **CRITICAL**: reading layout-dependent state synchronously in the pointer handler will see stale data.

- **Architecture Invariant:** `ToolContext.setState` inside a behavior's event handler updates a local `nextState` variable, not `this.state` on the tool. `BaseTool` commits the new state and fires lifecycle hooks (`onStateExit`, `onStateEnter`, `onStateChange`) only after the behavior loop returns. Calling `setState` multiple times within one handler is legal; only the final value is committed.

- **Architecture Invariant:** Continuous position transforms use operation-specific fluent edits from `GlyphLayer.positions`: `move`, `rotate`, or `scale`. Arbitrary position patches such as BendCurve use `GlyphLayer.beginEdit()` directly. Every drag-owned edit registers `discard`/`cancel` through `ToolContext.onCancel()`; successful `commit`/`finish` dismisses that rollback.

- **Architecture Invariant:** `ToolEvent` pointer events carry a `coords: Coordinates` bundle (`screen`, `scene`). Use `event.coords.scene` for scene-space hit-testing and resolve node-local coordinates from the hit target when a tool needs them.

## Codemap

```
tools/
  core/
    BaseTool.ts          — abstract base class; owns behavior loop and state lifecycle
    Behavior.ts          — Behavior<S, TTool> interface and createBehavior helper
    GestureDetector.ts   — pointer+timing -> ToolEvent (click, drag, doubleClick, ...)
    ToolManager.ts       — tool orchestration, contribution ownership, replacement
    ToolManifest.ts      — ToolManifest registration descriptor
    ToolRegistration.ts  — ownership handle for replace/remove lifecycle
    StateDiagram.ts      — defineStateDiagram for declarative tool state specs
    ToolStateMap.ts      — union map of all built-in tool states
    createContext.ts     — ToolName, ToolState, BUILT_IN_TOOL_IDS
  hand/                  — canvas panning (createBehavior style)
  pen/                   — bezier curve drawing (class-based behaviors)
  select/                — selection, translate/resize/rotate/bend; TranslateInteraction owns movement
  shape/                 — rectangle creation (createBehavior style)
  text/                  — text run editing
  tools.ts               — registerBuiltInTools (wires all tools + shortcuts)
```

## Key Types

- `BaseTool<S, Settings>` — abstract base class all tools extend. Declares `id`, `behaviors`, `initialState`. Optional overrides: `preTransition`, `onStateChange`, `getCursor`, `activate`, `deactivate`, `drawOverlay`, `drawScene`, `drawBackground`. Permanent `dispose()` releases base computed signals after deactivation.
- `Behavior<S, TTool>` — interface with optional per-event handlers (`onClick`, `onDrag`, `onDragStart`, `onDragEnd`, `onDragCancel`, `onPointerMove`, `onDoubleClick`, `onKeyDown`, `onKeyUp`) plus lifecycle hooks (`onStateExit`, `onStateEnter`). Each handler receives `(state, ctx, event)` and returns `boolean` (true = handled).
- `ToolContext<S, TTool>` — `{ editor, tool, getState, setState, onCancel }`. `tool: TTool` gives class-style behaviors access to their owning tool instance (e.g. `PenStroke.active(ctx.tool)`). `onCancel(callback)` registers rollback for the active drag and returns a function that dismisses it after successful completion.
- `ToolEvent` — discriminated union of semantic events: `pointerMove`, `click`, `doubleClick`, `dragStart`, `drag`, `dragEnd`, `dragCancel`, `keyDown`, `keyUp`, `selectionChanged`. Pointer events include `coords: Coordinates`.
- `DragStartEvent` / `DragEvent` / `DragEndEvent` — concrete targeted pointer-event contracts used by drag handlers.
- `ToolManager` — owns installed manifests, resident tool instances, `GestureDetector`, rAF pointer coalescing, replacement, removal, and temporary tool switching.
- `ActiveTool<Id>` — editor-facing `{ id, state }` snapshot. `Editor.toolIf(id)` narrows built-in state through `ToolStateMap`; runtime IDs fall back to `ToolState`.
- `GestureDetector` — stateful recognizer: drag threshold, double-click timing. Fed raw `pointerDown`/`Move`/`Up`, emits `ToolEvent[]`.
- `ToolManifest` — `{ id, create, icon, tooltip, shortcut? }`. Registration descriptor passed to `editor.registerTool`.
- `ToolRegistration` — exclusive ownership handle returned by `editor.registerTool`; exposes `replace(manifest)` and idempotent `dispose()`.
- `StateDiagram` — `{ states, initial, transitions }`. Declarative spec for compliance testing.
- `ToolName` — `string` (not a fixed union; extensible for plugins).
- `ToolState` — `{ type: string }` base interface for all tool state unions.
- `Coordinates` — `{ screen, scene }` bundle on pointer events.
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
  -> renderer dependency effects observe changed state
  -> tool.drawOverlay / drawScene / drawBackground
```

### Drag lifecycle invariant

- Crossing the screen-space threshold emits `dragStart` at the pointer-down origin, immediately followed by the first `drag` sample.
- Every `drag.delta` is cumulative from pointer-down; the threshold classifies the gesture but does not become a new origin.
- Pointer-up drains queued movement and emits the final `drag` sample before `dragEnd`.
- Behaviors initialize on `dragStart`, register rollback with `ctx.onCancel()`, preview from `drag`, and commit on `dragEnd` before dismissing rollback.
- `BaseTool` runs any rollback left active at `dragEnd`, `dragCancel`, tool disposal, or after a handler throws.

### Pen curve authoring invariant

- `PenContext.activeEndpoint` is the Pen tool's continuation truth, including while its latest authored point is still awaiting a workspace echo.
- A corner endpoint has no authored outgoing tangent; extending it as a cubic seeds the untouched control one third of the way toward the new anchor. A smooth endpoint carries its outgoing handle position explicitly and never receives that default.
- `Pen.resolveCurve()` on the tool itself is the single resolver from speculative `PenCurve` state to the exact cubic. `PenStroke` topology edits and `HandleBehavior` drag previews both call it, so previewed and committed geometry cannot diverge.
- `anchored -> dragging` begins a `GlyphLayerEdit` and immediately adds one complete cubic to the reactive authored layer. Outline, control-line, bounds, and handle rendering therefore derive from one current topology throughout the gesture.
- `dragEnd` finishes that already-visible edit as one pending workspace transaction; it does not replace preview geometry. `dragCancel` cancels the edit and restores the latest accepted topology, including when an older workspace echo arrived during the drag.
- Current and confirmed open-contour topology always ends on an on-curve point. The latest endpoint's outgoing handle remains Pen interaction state until a following segment consumes it; `PenOverlay` draws only that non-topological handle plus ready-state cursor chrome.

### Behavior loop (`#runBehaviors`)

1. If `state.type === "idle"`, return immediately (no handling).
2. If `preTransition` is defined and returns non-null, short-circuit with that state.
3. Create a `ToolContext` with a local `nextState` variable and access to the current drag's rollback scope.
4. Iterate `behaviors` in array order. For each behavior, look up the handler matching `event.type` (e.g. `onClick` for a `"click"` event). If the handler exists and returns `true`, stop iteration.
5. Return `{ state: nextState, handled }`.

### State commit (`handleEvent`)

After `#runBehaviors`, if `next !== prev` (reference equality):

1. **Batch** all side effects inside a single reactive `batch()`.
2. Call `onStateExit` on every behavior (receives `prev`, `next`, a pre-commit context).
3. Commit through `setState(next)`, publishing `state` and `stateCell` together. `Editor.toolCell` invalidates through its direct dependency on the active tool's `stateCell`.
4. Call `onStateEnter` on every behavior (receives `prev`, `next`, a post-commit context where `setState` updates `this.state`).
5. Call `onStateChange(prev, next, event)` if defined on the tool.

### Pointer coalescing

`ToolManager.handlePointerMove` stores the latest screen point and schedules a single `requestAnimationFrame`. The rAF callback (`flushPointerMove`) does coordinate projection, feeds `GestureDetector`, dispatches resulting events, updates hover (when not dragging), and requests an overlay redraw.

### Temporary tool override

`ToolManager.requestTemporary(toolId, options?)` activates an override tool (e.g. Hand via Space bar). The primary instance remains resident and unchanged while masked. `returnFromTemporary()` disposes the override and reveals that same primary instance without another lifecycle transition. Requests are blocked during an active drag.

### Runtime contribution lifecycle

`editor.registerTool(manifest)` installs metadata and returns its `ToolRegistration`. `replace()` publishes new metadata immediately. Inactive tools use the new factory on their next activation; resident instances are reconstructed immediately unless they own an active drag, in which case reconstruction waits for `dragEnd` or `dragCancel`. Removing an active contribution cancels its gesture before disposal and falls back to Select when available. `Editor.destroy()` permanently disposes all resident instances and their computed signals.

### Local edit patterns for drag mutations

Position transforms call `editor.positionSelection(ids)` once at interaction start, then create `selection.layer.positions.move(selection.targets)`, `.rotate(...)`, or `.scale(...)`. The behavior immediately registers `edit.discard()` with `ctx.onCancel()`. Preview methods always resolve from the operation's frozen position base; after `commit()` finishes the active `GlyphLayerEdit`, the behavior calls the returned function to dismiss rollback.

Pen topology and non-affine position patches use `GlyphLayer.beginEdit()` directly and register `edit.cancel()` through the same drag scope. Pen constructs cubic point sequences with the generic `GlyphLayerEdit.addPoints()` primitive; `setPointSmooth()` and `setPositions()` mutate the ordinary reactive layer immediately. `finish(label)` restores the latest accepted base and replays the final operations through one workspace transaction in the same reactive batch; after finishing, the behavior dismisses rollback. An undismissed rollback restores the base without sending an intent.

### Rendering layers

Tools can implement up to three rendering hooks, each tied to a different redraw frequency:

- `drawBackground(canvas)` — layer 0, redraws on viewport/font change (e.g. text runs).
- `drawScene(canvas)` — layer 1, redraws on edit/selection/hover change (e.g. guides, handles).
- `drawOverlay(canvas)` — layer 2, redraws every mouse move (e.g. selection marquee, pen preview).

All three receive a `Canvas` instance.

### Cursor

`BaseTool.cursorCell` is a computed signal derived from `getCursor(state)`. Override `getCursor` to return state-dependent cursors. Inside `getCursor`, reading `editor.getHoveredBoundingBoxHandle()`, `editor.getCurrentModifiers()`, or `editor.getIsHoveringNode()` makes the cursor reactive to hover and modifier changes.

## Workflow recipes

### Creating a new tool

1. Define a state union type (must extend `ToolState`): `type MyState = { type: "idle" } | { type: "ready" } | ...`.
2. Create the tool class extending `BaseTool<MyState>`:
   - Set `readonly id: ToolName = "myTool"`.
   - Declare `readonly behaviors: Behavior<MyState>[] = [...]`.
   - Implement `initialState()` returning `{ type: "idle" }`.
   - Implement `activate()` with `this.setState({ type: "ready" })`.
3. Optionally add `static stateSpec = defineStateDiagram(...)` for compliance testing.
4. Register in `registerBuiltInTools` (`tools.ts`): `editor.registerTool({ id, create, icon, tooltip, shortcut? })`.

### Adding a behavior (createBehavior style)

For simple tools (Hand, Shape):

```typescript illustrative
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

```typescript illustrative
export class MyBehavior implements Behavior<MyState> {
  onDragStart(state: MyState, ctx: ToolContext<MyState>, event: DragStartEvent): boolean {
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

### Using a fluent position edit for drag mutations

```typescript illustrative
onDragStart(state, ctx) {
  if (state.type !== "ready") return false;
  const selection = ctx.editor.positionSelection(ctx.editor.selection.ids);
  if (!selection) return false;

  const edit = selection.layer.positions.move(selection.targets);
  this.#edit = edit;
  this.#done = ctx.onCancel(() => edit.discard());
  ctx.setState({ type: "translating", totalDelta: { x: 0, y: 0 } });
  return true;
}

onDrag(state, ctx, event) {
  if (state.type !== "translating" || !this.#edit) return false;
  const feedback = this.#edit.preview(event.delta.scene);
  ctx.setState({ ...state, totalDelta: feedback.delta });
  return true;
}

onDragEnd(state, ctx) {
  if (state.type !== "translating") return false;
  this.#edit?.commit();
  if (this.#done) this.#done();
  this.#edit = null;
  this.#done = null;
  ctx.setState({ type: "ready" });
  return true;
}

onDragCancel(state, ctx) {
  if (state.type !== "translating") return false;
  this.#edit = null;
  this.#done = null;
  ctx.setState({ type: "ready" });
  return true;
}
```

## Gotchas

- **`preTransition` short-circuits the entire behavior loop.** If it returns non-null, no behavior sees the event. Use sparingly for events that must be handled before any behavior (e.g. `selectionChanged` in Select, `pointerMove` in Pen ready state).

- **Behavior handler return value matters.** Returning `false` (or `undefined`) means "I did not handle this"; the loop continues to the next behavior. Returning `true` stops the loop. Forgetting to return `true` after calling `ctx.setState` means another behavior may also handle the event and overwrite the state.

- **State identity is reference equality.** `handleEvent` only fires lifecycle hooks when `next !== prev`. If a behavior calls `ctx.setState(state)` with the same object reference, no hooks fire. For no-op transitions, simply return `true` without calling `setState`.

- **`onStateExit` / `onStateEnter` run on ALL behaviors**, not just the one that handled the event. Guard on the state types you care about.

- **`ToolContext.onCancel()` is drag-only.** Register while handling `dragStart` or `drag`; calling it from click, key, drag-end, or cancellation events throws. Call the returned function only after successful commit.

- **`ToolName` is `string`, not a fixed union.** The `BUILT_IN_TOOL_IDS` constant lists known IDs (`select`, `pen`, `hand`, `shape`, `text`, `disabled`) but the type is open for plugin tools.

## Verification

- `pnpm vitest run apps/desktop/src/renderer/src/lib/tools/` — unit tests.
- `GestureDetector.test.ts` — drag threshold, double-click timing, event emission.
- `ToolManager.test.ts` — tool activation, temporary override, rAF coalescing, modifier forwarding.
- Per-tool tests: `hand/Hand.test.ts`, `shape/Shape.test.ts`, `Pen.test.ts`, `Select.test.ts`, `Text.test.ts`.

## Related

- `Editor` — provides all services tools access via `this.editor` (hit-testing, selection, hover, commands, viewport, glyph).
- `Canvas` — rendering target passed to `drawOverlay` / `drawScene` / `drawBackground`.
- `PositionEdits` — creates standalone or scoped fluent move, rotate, and scale interactions over normalized position targets.
- `GlyphLayerEdit` — active preview/finish/cancel owner used by fluent edits and arbitrary BendCurve patches.
- `Coordinates` — `{ screen, scene }` coordinate bundle on pointer events.
- `TextTool` — text input tool backed by the editor's active text run.
- `KeyboardRouter` — binds tool shortcuts registered via `getToolShortcuts`.
