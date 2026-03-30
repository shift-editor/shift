# RFC: Tool System Refactor (Clean Cut)

## Status

- Proposed
- Scope: `apps/desktop/src/renderer/src/lib/tools/*`

## Motivation

The current tool architecture mixes two different patterns:

1. Behaviors mutate editor state directly inside `transition`.
2. Behaviors emit `action`, then `executeAction` applies side effects.

This is especially confusing in Select:

- some actions are selection intents (`selectPoint`, `clearSelection`)
- some actions are drag finalization plumbing (`scalePoints`, `rotatePoints`)

While implementing bend, this split makes it unclear where drag lifecycle and undo boundaries should live.

## Goals

1. Make tool code intuitive to write: explicit input handlers (`dragStart`, `drag`, `dragEnd`, `dragCancel`).
2. Remove action dispatch from tools entirely.
3. Keep undo/redo fully command-based, but hidden behind an edit session API for drag workflows.
4. Use one drag lifecycle across Select/Pen/other interactive tools.

## Non-Goals

1. No compatibility layer with old `transition + action` API.
2. No nested statechart framework or external dependency.
3. No mandatory semantic intent union for every operation.

## Proposed Architecture

### 1) Behavior API (explicit handlers)

```ts
// tools/core/Behavior.ts
export interface Behavior<S> {
  onClick?(state: S, ctx: ToolContext<S>, event: ClickEvent): boolean;
  onDoubleClick?(state: S, ctx: ToolContext<S>, event: DoubleClickEvent): boolean;
  onPointerMove?(state: S, ctx: ToolContext<S>, event: PointerMoveEvent): boolean;
  onDragStart?(state: S, ctx: ToolContext<S>, event: DragStartEvent): boolean;
  onDrag?(state: S, ctx: ToolContext<S>, event: DragEvent): boolean;
  onDragEnd?(state: S, ctx: ToolContext<S>, event: DragEndEvent): boolean;
  onDragCancel?(state: S, ctx: ToolContext<S>, event: DragCancelEvent): boolean;
  onKeyDown?(state: S, ctx: ToolContext<S>, event: KeyDownEvent): boolean;
  onKeyUp?(state: S, ctx: ToolContext<S>, event: KeyUpEvent): boolean;

  onStateExit?(prev: S, next: S, ctx: ToolContext<S>, event: ToolEvent): void;
  onStateEnter?(prev: S, next: S, ctx: ToolContext<S>, event: ToolEvent): void;
}
```

Rules:

- return `true` if handled, `false`/`undefined` otherwise.
- first behavior that handles wins.
- no `action` return type.

### 2) Tool context

```ts
// tools/core/ToolContext.ts
export interface ToolContext<S> {
  readonly editor: EditorAPI;
  getState(): S;
  setState(next: S): void;
}
```

### 3) BaseTool dispatch model

- `BaseTool.handleEvent(event)` dispatches by event type.
- ordered behavior list, first handler returning `true` wins.
- if state changed:
  - call `onStateExit` for all behaviors
  - commit state
  - call `onStateEnter` for all behaviors
- remove `executeAction`, `preTransition`, and `transition` from tool contract.

### 4) Drag editing API

```ts
// tools/core/EditorAPI.ts
export interface InteractionSession {
  apply(updates: NodePositionUpdateList): void;
  hasChanges(): boolean;
  commit(): void;
  cancel(): void;
}

export interface Editing {
  // existing editing APIs...
  beginInteractionSession(label: string): InteractionSession;
}
```

Semantics:

- `beginInteractionSession(label)` starts one reversible drag transaction.
- `apply` performs live updates and tracks before/after for touched nodes.
- `commit` records one command (compact node patch).
- `cancel` restores touched nodes to drag-start.

### 5) Command integration

Add compact patch command:

```ts
// commands/primitives/NodePositionPatchCommand.ts
type NodePatchEntry = {
  node: NodeRef; // point or anchor
  before: { x: number; y: number };
  after: { x: number; y: number };
};
```

- `execute/redo`: apply `after`
- `undo`: apply `before`
- command name = session label (e.g. `"Bend curve"`)

No drag-finalization actions required.

## Bend API (post-refactor)

```ts
// dragStart
state.bend.session = editor.beginInteractionSession("Bend curve");

// drag
state.bend.session.apply([
  { node: { kind: "point", id: c1Id }, x: x1, y: y1 },
  { node: { kind: "point", id: c2Id }, x: x2, y: y2 },
]);

// dragEnd
if (state.bend.session.hasChanges()) state.bend.session.commit();
else state.bend.session.cancel();

// dragCancel
state.bend.session.cancel();
```

## Example: Bend behavior shape

```ts
export class BendCurveBehavior implements Behavior<SelectState> {
  onDragStart(state, ctx, event) {
    if ((state.type !== "ready" && state.type !== "selected") || !event.metaKey) return false;
    const hit = ctx.editor.getNodeAt(event.coords);
    if (!hit || hit.type !== "segment" || hit.segment.type !== "cubic") return false;

    const c1 = hit.segment.points.control1;
    const c2 = hit.segment.points.control2;

    ctx.setState({
      type: "bending",
      bend: {
        session: ctx.editor.beginInteractionSession("Bend curve"),
        t: hit.t,
        startPos: hit.closestPoint,
        c1Id: c1.id,
        c2Id: c2.id,
        baseC1: { x: c1.x, y: c1.y },
        baseC2: { x: c2.x, y: c2.y },
      },
    });
    return true;
  }

  onDrag(state, event) {
    if (state.type !== "bending") return false;
    const { bend } = state;
    const t = Math.max(0.001, Math.min(0.999, bend.t));
    const denom = 3 * t * (1 - t);
    if (Math.abs(denom) < 1e-6) return true;

    const dx = event.coords.glyphLocal.x - bend.startPos.x;
    const dy = event.coords.glyphLocal.y - bend.startPos.y;
    const dcp = { x: dx / denom, y: dy / denom };

    bend.session.apply([
      {
        node: { kind: "point", id: bend.c1Id },
        x: bend.baseC1.x + dcp.x,
        y: bend.baseC1.y + dcp.y,
      },
      {
        node: { kind: "point", id: bend.c2Id },
        x: bend.baseC2.x + dcp.x,
        y: bend.baseC2.y + dcp.y,
      },
    ]);
    return true;
  }

  onDragEnd(state, ctx) {
    if (state.type !== "bending") return false;
    if (state.bend.session.hasChanges()) state.bend.session.commit();
    else state.bend.session.cancel();
    ctx.setState({ type: "selected" });
    return true;
  }

  onDragCancel(state, ctx) {
    if (state.type !== "bending") return false;
    state.bend.session.cancel();
    ctx.setState({ type: "selected" });
    return true;
  }
}
```

## Select action model after refactor

- Delete `SelectAction` and `select/actions.ts`.
- Behavior code calls editor APIs directly.
- Undoable edits happen via:
  - `editor.commands.execute(...)` for discrete operations
  - `beginInteractionSession/apply/commit/cancel` for drag operations

## Migration Plan

### Phase 1: Core contracts

1. Replace `Behavior` interface with handler-based interface.
2. Replace `BaseTool` event dispatch to handler model.
3. Remove action plumbing from `BaseTool`.

### Phase 2: Editor editing sessions

1. Add `beginInteractionSession(label)` to `EditorAPI`.
2. Implement session internals in Editor.
3. Add `NodePositionPatchCommand`.

### Phase 3: Select migration

1. Remove `SelectAction` union and executor.
2. Migrate behaviors to direct handlers.
3. Convert resize/rotate/translate/bend to edit sessions.

### Phase 4: Pen and Text migration

1. Remove pen/text action files.
2. Move existing action logic into behavior handlers.
3. Keep command batching where needed (e.g. pen contour workflows).

### Phase 5: Cleanup

1. Delete old action tests.
2. Add new handler-level tests and drag-session tests.
3. Update `CONTEXT.md`, `DOCS.md`, `TESTING.md`.

## Testing Strategy

1. Unit test `NodePositionPatchCommand` (point + anchor updates, undo/redo).
2. Unit test `InteractionSession` (coalescing, no-op commit, cancel restore).
3. Outcome tests per behavior:
   - dragStart enters state and opens session
   - drag applies expected updates
   - dragEnd commits one history item
   - dragCancel restores and records no history

## Risks

1. Large API break across all tools.
2. Event dispatch regressions if handler coverage is incomplete.
3. Existing tests tied to action dispatch will need rewrite.

## Decision

Proceed with a clean-cut refactor:

- explicit handlers
- no action dispatch
- edit sessions for drag commits
- command pattern retained as the undo/redo foundation
