# shift-edit

Editing logic and composite helpers for the Shift font editor.

## Architecture Invariants

**Architecture Invariant:** `EditSession` operates on a `GlyphLayer`, not a full `Glyph`. A session holds one editable layer plus glyph metadata. WHY: layers are the unit of editing in font design.

**Architecture Invariant:** Core data types (`Font`, `Glyph`, `GlyphLayer`, `Contour`, `Point`, entity IDs) live in `shift-ir`, not here. `shift-edit` re-exports them from `shift_ir` for convenience.

**Architecture Invariant:** State restore uses `GlyphStructure + values`, not old bridge snapshots. The structure owns stable entity ordering; values are the flat numeric payload in that order.

**Architecture Invariant:** `shift-edit` must not export TypeScript types. Bridge DTOs live in `shift-wire`; TypeScript declarations are generated from `shift-bridge/index.d.ts` into `@shift/types/bridge`.

**Architecture Invariant:** Composite resolution is read-only. `flatten_component_contours_for_layer` and `resolve_component_instances_for_layer` produce derived geometry and never mutate source glyphs.

## Codemap

```
src/
  lib.rs               -- public API and shift-ir re-exports
  edit_session.rs      -- mutable glyph-layer editing context
  state.rs             -- GlyphStructure/values restore helpers and flat value extraction
  composite.rs         -- composite glyph resolution and derived contours
  dependency_graph.rs  -- component dependency index
  curve.rs             -- tight curve bounds helpers
  vec2.rs              -- 2D vector math
```

## Key Types

- `EditSession` -- mutable editing context wrapping a `GlyphLayer` with glyph metadata.
- `BulkNodePositionUpdates` -- typed-array-friendly absolute position update payload for hot path sync.
- `EditableNode` -- point/anchor reference enum for editable node operations.
- `GlyphStructure` / values -- state restore and bridge-facing edit result shape, owned canonically by `shift-wire`.
- `DependencyGraph` -- bidirectional component dependency index.
- `ResolvedContour` -- derived contour from composite flattening.

## Editing Flow

1. Caller creates an `EditSession` from a glyph name, unicode, and `GlyphLayer`.
2. The session mutates contours, points, anchors, width, and bulk node positions.
3. Bridge methods convert the session layer into `shift-wire` structure/value change DTOs.
4. Undo/redo restore rebuilds layer content from `GlyphStructure + values`.
5. The session is consumed via `into_layer()` when the bridge commits the active edit back to the font.

## Workflow Recipes

### Add a new editing operation to EditSession

1. Add the method to `EditSession` in `edit_session.rs`.
2. If it returns results to JS, create or reuse a DTO in `shift-wire`.
3. Wire the method through `shift-bridge` NAPI bindings.
4. Rebuild `shift-bridge` declarations.
5. Run `pnpm generate:bridge-types`.
6. Run `cargo test -p shift-edit` and `cargo test -p shift-bridge`.

### Add a new bridge field

1. Add the canonical DTO field in `shift-wire`.
2. Add the NAPI adapter field in `shift-wire/src/bridges/napi`.
3. Rebuild `shift-bridge` declarations.
4. Run `pnpm generate:bridge-types` to update `@shift/types/bridge`.

## Gotchas

- `apply_boolean_op` removes both input contours even if the boolean operation produces zero output contours.
- Point lookup across contours is linear. For hot paths with many points, prefer bulk position APIs that iterate contours once.
- Composite-derived points are render-time artifacts, not editable identities.

## Verification

```bash
cargo test -p shift-edit
cargo clippy -p shift-edit
```

## Related

- `shift-ir` -- canonical Rust data model.
- `shift-wire` -- bridge DTOs and NAPI adapter wrappers.
- `shift-bridge` -- NAPI bridge exposing edit/session/persistence operations.
