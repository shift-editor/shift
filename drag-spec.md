# Drag-to-Edit Simplification Spec (v2)

**Goal:** make Select drag behaviors easier to write and reason about, with one drag lifecycle and lightweight undo.

**Status:** proposal.

---

## 1. Problem Summary

Today we effectively have three paradigms:

1. **Translate**: Editor-managed drag session (`beginDrag`).
2. **Resize/Rotate**: live mutate + restore + action command (`scalePoints` / `rotatePoints`).
3. **Bend**: WIP with no established pattern.

This creates friction for tool authors:

- Different drag lifecycles per behavior.
- Action system is mixed with drag commit mechanics.
- Preview/undo strategy is unclear (snapshot vs compact commands).

---

## 2. Design Principles

1. **One drag lifecycle** for all glyph-mutating drags.
2. **Behavior code owns geometry math**, not undo plumbing.
3. **No restore+replay in behavior code**.
4. **Lightweight undo by default** (not full-glyph snapshots for simple transforms).
5. **Actions are for selection/mode intents**, not drag commit internals.

---

## 3. Proposed Architecture

### 3.1 `DragMutationSession` (shared helper)

Introduce a shared helper (Select-level utility or Editor API) used by Translate/Resize/Rotate/Bend.

Responsibilities:

- Apply live `setNodePositions(updates)` during drag.
- Lazily capture `before` positions for every touched node (point or anchor).
- Track latest `after` position per touched node.
- `cancel()` restores `before` positions.
- `commit(...)` records one undoable command using a selected strategy.

API sketch:

```ts
type DragCommitStrategy =
  | { type: "nodeDiff"; label: string }   // default, lightweight
  | { type: "snapshot"; label: string }   // fallback for complex cases
  | { type: "none" };                     // no-op drag

interface DragMutationSession {
  apply(updates: NodePositionUpdate[]): void;
  commit(strategy: DragCommitStrategy): void;
  cancel(): void;
}
```

### 3.2 Lightweight Undo: `NodePositionDiffCommand`

Add `NodePositionDiffCommand`:

- Stores only touched nodes: `before` and `after` maps.
- `undo` applies `before`; `redo/execute` applies `after`.
- Works for points and anchors.
- Memory cost scales with affected nodes, not whole glyph.

This is the default drag commit path. It replaces drag-time snapshot commands for common transforms.

### 3.3 Where existing commands fit

- Keep `ScalePointsCommand` / `RotatePointsCommand` for explicit non-drag operations (menus, shortcuts, scripted transforms).
- Drag behaviors no longer emit `scalePoints` / `rotatePoints` actions.
- Drag commit uses `NodePositionDiffCommand` (or snapshot fallback).

This keeps a clean separation:

- **Live drag math** in behavior.
- **Undo representation** in session commit strategy.

### 3.4 Optional snapshot fallback

Some operations may still need full snapshot commit (topology edits, many side-effects). For those, use `commit({ type: "snapshot" })`.

Snapshot becomes a fallback, not the default for simple point/anchor drags.

---

## 4. Behavior Authoring Contract

Every glyph-mutating drag behavior follows the same shape:

1. **dragStart**:
   - Hit-test.
   - Build drag-local data (`startPos`, `initialPositions`, IDs, snap session, etc.).
   - Create `DragMutationSession`.
   - Enter drag state.

2. **drag**:
   - Compute absolute target positions from drag-local data.
   - Call `session.apply(updates)`.
   - Update drag state.

3. **dragEnd**:
   - If no movement: `session.cancel()` (or `commit({ type: "none" })`).
   - Else: `session.commit({ type: "nodeDiff", label })`.
   - Exit drag state.

4. **dragCancel**:
   - `session.cancel()`.
   - Exit drag state.

This keeps drag behavior logic focused on geometry and state transitions.

---

## 5. Bend Tool Guidance (Now)

For `BendCurveBehaviour`, use this as first implementation target:

1. On dragStart (with modifier), hit-test cubic segment and capture:
   - `segmentId`, `t`, `startPos`
   - control point IDs
   - base control positions
   - `session`

2. On drag:
   - `delta = glyphLocal - startPos`
   - `denom = 3 * t * (1 - t)`; guard near zero
   - `deltaCp = delta / denom` (for constrained solution `dC1 = dC2`)
   - apply two point updates through `session.apply`

3. On dragEnd:
   - commit node diff with label `"Bend curve"` if changed; otherwise cancel

4. On dragCancel:
   - cancel session

No bend-specific action type is required.

---

## 6. Migration Plan

### Phase 0: Foundation

- [ ] Add `NodePositionDiffCommand`.
- [ ] Add `DragMutationSession` helper and tests.
- [ ] Add minimal API needed by commands to update both points and anchors cleanly (e.g. command-safe `setNodePositions` surface or equivalent).

### Phase 1: Bend first (pilot)

- [ ] Implement Bend on `DragMutationSession`.
- [ ] Remove/ignore `bendCurve` action for drag flow.
- [ ] Add bend tests: start/apply/commit/cancel.

### Phase 2: Resize + Rotate

- [ ] Migrate both to `DragMutationSession`.
- [ ] Remove restore+replay from behaviors.
- [ ] Remove drag usage of `scalePoints` / `rotatePoints` actions.

### Phase 3: Translate

- [ ] Replace `beginDrag` usage in select translate flow with `DragMutationSession`.
- [ ] Keep snapping behavior unchanged.
- [ ] Ensure rule-based secondary handle motion is captured by lazy touched-node tracking.

### Phase 4: Cleanup

- [ ] Narrow action union to selection/edit intents only.
- [ ] Update docs for the single drag lifecycle.
- [ ] Consider deprecating old drag APIs once no longer used by tools.

---

## 7. Why this is better

- One mental model for drag behaviors.
- Behavior code is smaller and geometry-first.
- Undo stays compact for typical transforms.
- No per-behavior restore+command boilerplate.
- Bend implementation becomes straightforward and consistent with other drags.
