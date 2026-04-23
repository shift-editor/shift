# shift-core

Editing logic, composite resolution, and font I/O orchestration for the Shift font editor.

## Architecture Invariants

**Architecture Invariant:** `EditSession` operates on a `GlyphLayer`, not a `Glyph`. A session holds a single layer plus glyph metadata (name, unicode). This means multi-layer editing requires separate sessions per layer, and callers must extract/reinsert layers via `into_layer()`. WHY: Layers are the unit of editing in font design; glyphs are just named containers. Operating at the layer level avoids ambiguity about which layer is being mutated.

**Architecture Invariant:** Core data types (`Font`, `Glyph`, `GlyphLayer`, `Contour`, `Point`, entity IDs) live in `shift-ir`, not here. `shift-core` re-exports them from `shift_ir` for convenience. WHY: `shift-ir` is the canonical IR shared across backends; `shift-core` adds editing/resolution logic on top. If you need to change a data structure, change it in `shift-ir`.

**CRITICAL:** `restore_from_snapshot` clears all contours and anchors before rebuilding from the snapshot. If the snapshot is stale or partial, geometry is silently lost. WHY: Snapshots are the undo/redo transport format -- they must represent complete state, not diffs.

**Architecture Invariant:** Composite resolution is read-only. `flatten_component_contours_for_layer` and `resolve_component_instances_for_layer` produce derived `ResolvedContour` geometry with regenerated `PointId`s. They never mutate source glyphs. WHY: Resolved points are render-time artifacts, not editable identities. Mixing them with source IDs would corrupt selection state.

**Architecture Invariant:** Component anchor attachment uses a stack-based "most recently placed" rule. `_top` in a mark component attaches to the latest `top` anchor seen so far in processing order. Components are processed in stable `ComponentId::raw` order, so anchor stacking is deterministic. WHY: This mirrors the OpenType mark-to-mark attachment model and ensures predictable composite glyph layout.

**Architecture Invariant:** Snapshot types use `#[ts(export)]` and serialize to `packages/types/src/generated/`. They are the contract between Rust and TypeScript. Field names use `camelCase` via `#[serde(rename_all = "camelCase")]`. Adding/removing snapshot fields is a cross-language breaking change. WHY: ts-rs generates TypeScript interfaces at build time; any mismatch causes runtime deserialization failures on the JS side.

## Codemap

```
src/
  lib.rs               -- Re-exports from shift-ir and shift-backends; defines public API surface
  edit_session.rs       -- EditSession: mutable glyph-layer editing context (move/add/remove/paste/boolean ops)
  snapshot.rs           -- GlyphSnapshot, CommandResult, and related types for Rust-to-TypeScript serialization
  composite.rs          -- Composite glyph resolution: anchor attachment, component flattening, SVG path gen, bbox
  dependency_graph.rs   -- DependencyGraph: forward/reverse component dependency index
  font_loader.rs        -- FontLoader: pluggable format dispatch (UFO, Glyphs, TTF/OTF)
  binary.rs             -- BytesFontAdaptor (skrifa-based TTF/OTF loading), ShiftPen, compile_font (via fontc)
  curve.rs              -- Tight bounding box computation for line/quad/cubic curve segments
  vec2.rs               -- Vec2: 2D vector math utilities
  constants.rs          -- PIXEL, DEFAULT_X_ADVANCE constants
```

## Key Types

- `EditSession` -- Mutable editing context wrapping a `GlyphLayer` with glyph metadata. All point/anchor/contour mutation goes through this.
- `NodeRef` -- Enum unifying `Point`, `Anchor`, and `Guideline` references for batch move/transform operations.
- `NodePositionUpdate` -- Absolute position update for a `NodeRef`, used by `set_node_positions`.
- `GlyphSnapshot` -- Serializable glyph state sent to TypeScript. Includes contours, anchors, composite contours, and active contour ID.
- `CommandResult` -- Standardized success/error response wrapping a `GlyphSnapshot` with undo/redo flags.
- `FontLoader` -- Format-dispatching font reader/writer using `FontAdaptor` trait objects.
- `GlyphLayerProvider` -- Trait for composite resolution layer lookup; `FontLayerProvider` is the default impl backed by `Font`.
- `DependencyGraph` -- Bidirectional component dependency index (`uses` / `used_by`) with transitive dependent query.
- `ResolvedContour` -- Derived contour from composite flattening, with regenerated point IDs.
- `Vec2` -- Lightweight 2D vector with arithmetic ops.

## How it works

### Editing flow

1. Caller creates an `EditSession` from a glyph name, unicode, and `GlyphLayer`.
2. The session provides mutation methods: `add_point`, `move_points`, `move_nodes`, `transform_nodes`, `set_node_positions`, `apply_boolean_op`, `paste_contours`, etc.
3. `NodeRef` unifies points and anchors so batch operations (move, transform) work across entity types in a single call.
4. After editing, `GlyphSnapshot::from_edit_session` serializes the current state for the TypeScript UI.
5. For undo, `restore_from_snapshot` replaces all layer content with a previous snapshot.
6. The session is consumed via `into_layer()` to return the layer to the glyph.

### Composite resolution

1. `resolve_component_instances_for_layer` walks components in stable ID order.
2. For each component, it resolves the final transform: explicit affine matrix, then anchor-based offset if a `_name` anchor matches a previously placed `name` anchor.
3. `flatten_component_named` recurses into nested components. Cycles are handled branch-locally (cyclic branches are skipped; non-cyclic siblings still contribute geometry).
4. Resolved contours get new `PointId`s and are used for SVG path generation (`layer_to_svg_path`) and bounding box computation (`layer_bbox`).

### Font loading

`FontLoader` dispatches by file extension to `FontAdaptor` implementations:
- UFO -> `UfoFontAdaptor` (via `shift-backends::UfoReader`)
- .glyphs/.glyphspackage -> `GlyphsFontAdaptor` (via `shift-backends::GlyphsReader`)
- TTF/OTF -> `BytesFontAdaptor` (skrifa outline extraction with `ShiftPen`)

Binary loading auto-detects smooth points using a collinearity heuristic (`SMOOTH_ANGLE_TOLERANCE` = ~2.9 degrees). Writing is only supported for UFO format.

## Workflow recipes

### Add a new editing operation to EditSession

1. Add the method to `EditSession` in `edit_session.rs`.
2. If it returns results to JS, create or reuse a snapshot type in `snapshot.rs` with `#[derive(TS)]` and `#[ts(export)]`.
3. Wire the method through `shift-node` NAPI bindings.
4. Run `cargo test -p shift-core` and `cargo test -p shift-node`.

### Add a new font format for reading

1. Add a variant to `FontFormat` in `font_loader.rs`.
2. Implement `FontAdaptor` for it.
3. Register it in `FontLoader::new()`.
4. Add extension mapping in `format_from_extension`.

### Add a new snapshot field

1. Add the field to the snapshot struct in `snapshot.rs` with `#[serde(default)]` if it must be backwards-compatible.
2. Update `from_edit_session` (or the relevant `From` impl) to populate it.
3. If used in undo, update `restore_from_snapshot`.
4. Run `cargo test -p shift-core` then regenerate TS types.

## Gotchas

- `add_point` without an active contour silently creates a new contour and sets it active. This is intentional but can surprise callers who expect an error.
- `apply_boolean_op` removes both input contours even if the boolean operation produces zero output contours (valid for subtraction).
- `find_point_contour` does a linear scan across all contours. For hot paths with many points, prefer `set_node_positions` which iterates contours once.
- Binary font loading (`BytesFontAdaptor`) produces contours from skrifa's outline pen, which decomposes composites into simple outlines. Component structure is lost.
- `compile_font` delegates to `fontc` and writes to a build directory. It takes a `.ufo` source path, not a `Font` struct.
- `layer_complexity` is a heuristic (contours + components count). It picks the "primary" layer for rendering but may not match user expectations for sparse multi-layer glyphs.

## Verification

```bash
cargo test -p shift-core        # Unit tests for all modules
cargo clippy -p shift-core      # Lint check
```

## Related

- `shift-ir` -- Canonical data model (`Font`, `Glyph`, `GlyphLayer`, `Contour`, `Point`, entity IDs, `CurveSegment`)
- `shift-backends` -- Format-specific readers/writers (`UfoReader`, `UfoWriter`, `GlyphsReader`, `FontReader`, `FontWriter`)
- `shift-node` -- NAPI bridge that exposes `EditSession` and snapshot types to JavaScript via `FontEngine`
