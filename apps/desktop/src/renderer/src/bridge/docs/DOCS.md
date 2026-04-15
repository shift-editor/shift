# Bridge

Single class wrapping the native Rust NAPI bindings with a reactive `Glyph` model.

## Architecture

```
NativeBridge
├── #raw: FontEngineAPI          (NAPI bindings via contextBridge)
├── #$glyph: WritableSignal      (reactive Glyph instance)
│
├── Mutation paths:
│   ├── #dispatch / #dispatchVoid   (Rust command → snapshot → JS sync)
│   ├── setNodePositions            (JS + Rust via #syncPositions)
│   ├── sync(change)                (Rust-only, used by draft finish)
│   └── restoreSnapshot             (JS + Rust, full snapshot)
│
└── Glyph model (reactive):
    ├── #contours: Signal<Contour[]>
    ├── #anchors: Signal<Anchor[]>
    ├── #path: Computed<Path2D>     (lazy — only computed when read)
    └── apply(change: GlyphChange)  (snapshot or position updates)
```

## Two-tier mutation model

The bridge separates JS-side reactivity from Rust-side persistence. Not every mutation needs to cross the NAPI boundary immediately.

### Tier 1: JS-only (`glyph.apply`)

Updates the reactive Glyph model. Fires internal signals (`#contours`, `#anchors`). Render effects see the change and schedule redraws. Rust is not touched.

Used by: `GlyphDraft.setPositions()` during drag (every frame).

### Tier 2: Rust sync (`bridge.sync`)

Pushes a change to Rust without updating the JS model (already correct from Tier 1). Accepts `GlyphChange` — position updates go through `#syncPositions` (flat `Vec<f64>` arrays), snapshots go through `restoreSnapshot` (JSON).

Used by: `GlyphDraft.finish()` on drag end (once).

### Combined: JS + Rust

Methods like `setNodePositions` and `restoreSnapshot` update both sides. Used by commands (`SetNodePositionsCommand`, `SnapshotCommand`) and sidebar edits where the mutation is immediate, not draft-based.

## Key methods

### `sync(change: GlyphChange)`

Rust-side mirror of `glyph.apply()`. Dispatches based on change type:

- **Position updates** → `#syncPositions` → `#raw.setPositions(pointIds, pointCoords, anchorIds, anchorCoords)`. Flat `Vec<f64>` arrays. Cost proportional to what changed.
- **Snapshots** → `#raw.restoreSnapshot(JSON.stringify(snapshot))`. Full JSON round-trip. For structural changes only.

### `setNodePositions(updates)`

Updates JS reactive model + syncs to Rust. Used by commands and sidebar, not by draft hot path.

```
glyph.apply(updates)    → JS reactive model
#$glyph.set(glyph)      → trigger $glyph signal
#syncPositions(updates)  → Rust via flat arrays
```

### `restoreSnapshot(snapshot)`

Full JS + Rust sync from a snapshot. Used by undo/redo (SnapshotCommand) and clipboard commands.

### `#dispatch / #dispatchVoid`

Standard Rust command path. Calls NAPI method → parses JSON CommandResult → syncs JS model from the returned snapshot. Used by structural mutations (addPoint, removePoints, closeContour, etc.).

## $glyph signal

`$glyph` is the **identity** signal — it fires when the Glyph instance changes (new glyph opened/closed). It has `equals: () => false` for historical reasons but should not be used as a change notification mechanism.

Render effects track the Glyph's internal signals (`glyph.contours`, `glyph.anchors`) for data changes. This allows `glyph.apply()` to trigger redraws without `$glyph` firing — critical for the draft's JS-only hot path.

## GlyphDraft (immer-style)

Created via `Editor.createDraft()`. Separates preview (every frame) from persistence (once at end).

```
setPositions(updates)   → glyph.apply(updates)     JS-only, no Rust
finish(label)           → bridge.sync(updates)      Rust sync + undo record
discard()               → glyph.apply(base)         JS-only, Rust untouched
```

The draft tracks the latest updates passed to `setPositions`. On `finish()`:

1. `bridge.sync(latestUpdates)` — sends only the diff to Rust
2. `SetNodePositionsCommand.fromBaseGlyphAndUpdates(...)` — stores the diff for undo (not two full snapshots)

**NEVER call bridge methods from the draft hot path.** `setPositions` must only call `glyph.apply()`.

## NAPI position sync path

`#syncPositions` splits updates into point IDs/coords and anchor IDs/coords, packs them as flat `number[]` arrays, and calls `#raw.setPositions(...)`. The Rust side (`set_positions`) takes `Option<Float64Array>` params (null for empty arrays — napi-rs panics on zero-length Float64Array).

```
JS: NodePositionUpdateList
  → split into pointIds[], pointCoords[], anchorIds[], anchorCoords[]
  → #raw.setPositions(Float64Array | null, ...)
Rust: Option<Float64Array> → &[f64] slice → Vec<NodePositionUpdate> → session.set_node_positions()
```

Cost is proportional to the number of changed points, not the glyph size.

## Errors

- `NoEditSessionError` — operation requires an active edit session
- `NativeOperationError` — Rust operation failed (thrown by `#dispatch`)

## Data flow summary

```
Drag frame:      glyph.apply(updates) → signals fire → render effect → redraw
Drag finish:     bridge.sync(updates) → Rust set_positions → undo record
Drag cancel:     glyph.apply(base)    → signals fire → render effect → redraw
Command:         bridge.setNodePositions(updates) → JS + Rust + signals
Structural edit: bridge.#dispatch(raw.addPoint(...)) → Rust → snapshot → JS sync
Undo/redo:       glyph.restoreSnapshot(snapshot) → bridge.restoreSnapshot → JS + Rust
```
