# NativeBridge

Reactive wrapper over the Rust NAPI bindings that owns the `Glyph` lifecycle and provides the sole API boundary between the JS editor and the native font engine.

## Architecture Invariants

- **Architecture Invariant:** All glyph mutations must go through `Glyph.apply` for the JS-side reactive model. Direct signal writes on `Contour` or `Glyph` internals will bypass the path/bounds recomputation pipeline.
- **Architecture Invariant:** **CRITICAL**: `GlyphDraft.setPositions` must only call `Glyph.apply` -- never `NativeBridge` methods. Crossing the NAPI boundary on every drag frame kills performance. Rust sync happens once on `GlyphDraft.finish`.
- **Architecture Invariant:** **CRITICAL**: `#syncPositions` passes `null` (not a zero-length `Float64Array`) when a category has no updates. napi-rs panics on zero-length `Float64Array`.
- **Architecture Invariant:** `$glyph` is an identity signal (`equals: () => false`). It fires on glyph open/close, not on data changes. Render effects must track `Glyph` internal signals (`contours`, `anchors`, `path`) to respond to mutations.
- **Architecture Invariant:** `Glyph` holds a back-reference to `NativeBridge` so it can delegate structural mutation methods (`addPoint`, `removePoints`, etc.) directly. This keeps callers from needing both a bridge and a glyph reference.
- **Architecture Invariant:** Snapshot restore validates via `ValidateSnapshot.isGlyphSnapshot` before sending to Rust. Invalid snapshots throw `NativeOperationError` without touching native state.

## Codemap

```
bridge/
  NativeBridge.ts     — NAPI wrapper, session lifecycle, mutation dispatch
  native.ts           — cached `window.shiftFont` accessor (FontEngineAPI)
  errors.ts           — FontEngineError, NoEditSessionError, NativeOperationError
  index.ts            — re-exports NativeBridge, Glyph, Contour, errors
```

## Key Types

- `NativeBridge` -- owns `#raw` (FontEngineAPI) and `#$glyph` (WritableSignal). All font queries and mutations live here.
- `Glyph` -- reactive mirror of a Rust glyph with per-contour signal granularity. Property getters auto-unwrap signals. All mutations enter through `Glyph.apply`.
- `Contour` -- reactive contour with `#points`, `#closed`, computed `#path` and `#bounds`. Updated via `_update` (snapshot) or `_setPoints` (position patch).
- `GlyphChange` -- union of `GlyphSnapshot | NodePositionUpdateList`. Snapshot for structural edits; update list for position-only changes.
- `GlyphDraft` -- interface with `setPositions`, `finish`, `discard`. Created by `Editor.createDraft`, implements immer-style preview/commit separation.
- `NodePositionUpdateList` -- `readonly NodePositionUpdate[]`, each entry is a `NodeRef` (point, anchor, or guideline) with absolute x/y.
- `FontEngineAPI` -- derived from the napi-rs generated `FontEngine` class, exposed via `window.shiftFont` through Electron's contextBridge.
- `NoEditSessionError` / `NativeOperationError` -- thrown when an operation requires a session or the Rust side fails.

## How it works

### Two-tier mutation model

The bridge separates JS-side reactivity from Rust-side persistence. Not every mutation crosses the NAPI boundary immediately.

**Tier 1 -- JS-only (`Glyph.apply`):** Updates reactive signals (`#contours`, `#anchors`). Render effects auto-track these signals and schedule redraws. Rust is untouched. Used by `GlyphDraft.setPositions` during drag (every frame).

**Tier 2 -- Rust sync (`NativeBridge.sync`):** Pushes a `GlyphChange` to Rust without updating the JS model (already correct from Tier 1). Position updates go through `#syncPositions` (flat `Float64Array` arrays); snapshots go through `restoreSnapshot` (JSON). Used by `GlyphDraft.finish` on drag end (once).

**Combined -- JS + Rust:** Methods like `setNodePositions` and `restoreSnapshot` update both sides atomically. Used by commands (`SetNodePositionsCommand`, `SnapshotCommand`) and sidebar edits where the mutation is immediate.

### Dispatch pipeline

`#dispatch` / `#dispatchVoid` are the standard Rust command path for structural mutations (addPoint, removePoints, closeContour, etc.):

1. Call NAPI method, receive JSON string
2. `#execute` parses JSON, checks `success`, extracts `CommandResponse` (snapshot + affectedPointIds)
3. `#syncFromResponse` applies the returned snapshot to the reactive `Glyph` via `Glyph.apply`

### NAPI position sync

`#syncPositions` converts `NodePositionUpdateList` into four flat arrays (pointIds, pointCoords, anchorIds, anchorCoords) packed as `Float64Array`, then calls `#raw.setPositions`. Cost is proportional to the number of changed nodes, not the glyph size.

### GlyphDraft lifecycle

Created by `Editor.createDraft`. Captures a base snapshot, then:

- `setPositions(updates)` -- calls `Glyph.apply(updates)` (JS-only, no Rust)
- `finish(label)` -- calls `NativeBridge.sync(updates)` for Rust sync, then records a `SetNodePositionsCommand` for undo (stores the diff, not two full snapshots)
- `discard()` -- calls `Glyph.apply(base)` to revert JS state (Rust was never touched)

A `finished` flag prevents double-finish or post-finish mutation.

### Glyph reactive model

`Glyph` wraps each data dimension in its own signal. Computed signals (`#path`, `#bbox`) derive from these automatically. `Glyph.apply` dispatches on change type:

- Snapshot: `#syncFromSnapshot` reconciles contours by ID (reuses existing `Contour` instances, creates new ones as needed), updates all scalar signals inside a `batch`.
- Position updates: `#patchPositions` maps point/anchor IDs to new coordinates and patches only the affected `Contour` instances.

## Workflow recipes

### Add a new NAPI-backed mutation

1. Add the `#[napi]` method in Rust, rebuild -- it appears on `FontEngineAPI` automatically
2. Add a public method on `NativeBridge` that calls `#dispatch` or `#dispatchVoid` with the raw result
3. If callers should access it through `Glyph`, add a delegation method on `Glyph` that calls `this.#bridge.<method>`

### Add a new position-based operation

1. Build a `NodePositionUpdateList` with the target absolute positions
2. For immediate apply: call `NativeBridge.setNodePositions(updates)`
3. For draft-based (drag): call `GlyphDraft.setPositions(updates)` per frame, then `GlyphDraft.finish(label)` on end

### Support undo for a structural edit

Wrap the mutation in a `SnapshotCommand` -- capture a before-snapshot, execute the bridge method, the after-snapshot is the current state.

## Gotchas

- `Float64Array` of length 0 panics napi-rs. `#syncPositions` guards this by passing `null` instead.
- `$glyph` has `equals: () => false`, so every `.set()` fires subscribers even if the instance is the same. This is intentional for session open/close detection, but means you should never use `$glyph` as a change-tracking signal for data.
- `Glyph.apply` with a snapshot reconciles contours by ID. If a Rust mutation changes contour IDs (e.g., boolean operations), old `Contour` instances are dropped and new ones created. Effects holding stale `Contour` references will read the old signals.
- `getPath` for the currently-editing glyph returns the reactive `Glyph.path` (computed from JS signals), not a fresh Rust SVG path. This ensures composites render with live edits.
- `#execute` throws `NativeOperationError` if the Rust response has `success: false` or is missing a snapshot. Callers of `#dispatch` do not need to check for errors -- they propagate as exceptions.

## Verification

```bash
# Unit tests (draft lifecycle, position sync)
npx vitest run apps/desktop/src/renderer/src/lib/editor/draft.test.ts

# Type check
npx tsc --noEmit -p apps/desktop/tsconfig.json
```

## Related

- `Editor.createDraft` -- constructs `GlyphDraft` instances and records undo via `SetNodePositionsCommand`
- `SetNodePositionsCommand` / `SnapshotCommand` -- undo/redo primitives that call back into `NativeBridge`
- `FontEngineAPI` -- the NAPI type surface, derived from `shift-node`
- `ValidateSnapshot` -- validates `GlyphSnapshot` shape before Rust restore
- `constrainDrag` -- smart edit rules invoked by `NativeBridge.applySmartEdits`
- `TestEditor` -- test harness that wraps `NativeBridge` with a mock `FontEngineAPI`
