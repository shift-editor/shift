# shift-font

First-class Rust font object model for Shift.

## Architecture Invariants

- **Architecture Invariant:** `shift-font` owns Shift authoring concepts and semantic validation, never format/compiler DTOs.
- **Architecture Invariant:** Stable IDs are identity. Names, tags, Unicode assignments, and coordinates remain editable authoring values.
- **Architecture Invariant:** Named instances own complete external locations but no source or geometry. Sources own design-space locations.
- **Architecture Invariant:** Mapping edits never rewrite external named-instance intent.

## Codemap

```text
crates/shift-font/src/
  ir/              -- font entities, IDs, axes, mappings, instances, glyph data
  intents.rs       -- atomic authoring intents and semantic application
  changes.rs       -- replace-grade semantic change records
  layer_edit.rs    -- glyph-layer geometry mutations
  variation.rs     -- external-to-design mapping evaluation
  interpolation.rs -- source compatibility, glyph values, variation models
  projection.rs    -- location-bound resolved glyph views
  composite.rs     -- recursive component flattening
```

## Key Types

- `Font` owns glyphs, sources, axes, axis mappings, named instances, metadata, and font-level data.
- `Axis` has stable identity, an external/internal role, a continuous or discrete kind, and optional external/user-space value labels.
- `AxisLabel` has font-wide stable identity so UI rows and later instance recipes survive renames and reordering.
- `AxisMapping` owns an ordered set of mapping points. Independent mappings transform one external axis; the optional cross-axis group maps one design-space location to another.
- `NamedInstance` is an explicit named product preset at a complete external location. It owns no source, layer, or compiler representation.
- `Source` is an editable designspace position with a name and location.
- `Glyph` is a glyph concept identified by `GlyphId`.
- `GlyphLayer` is authored editable data for one glyph at one source.
- `GlyphInterpolation` is a reusable model built from one glyph's compatible authored source layers. Its default-source template owns topology; its regions and deltas own native interpolation semantics.
- `FontProjection` is a read-only, location-bound view that reuses resolved component layers across one or many glyph requests.
- `ResolvedGlyph` is derived, flattened geometry plus x advance. An existing blank glyph resolves to an empty contour list; a missing glyph resolves to `None`.
- `Contour` and `Point` describe outline geometry inside a glyph layer.

## Identity

Stable IDs are identity. Names and Unicode values are editable metadata.

- `GlyphId` identifies a glyph.
- `SourceId` identifies a source.
- `LayerId` identifies a glyph layer: the authored data for one glyph at one source.
- `AxisMappingId` identifies a font-owned mapping independently of its editable name.
- `AxisLabelId` identifies an axis value label independently of its editable name or position.
- `NamedInstanceId` identifies an explicit product preset independently of its editable name and location.

## How it works

- Own font authoring data structures such as `Font`, `Glyph`, `GlyphLayer`, `Contour`, `Point`, `Source`, and `Axis`.
- Keep object-level mutation behavior near the objects it mutates.
- Provide model-native helpers for layer editing, component resolution, variation behavior, axis mapping evaluation, and geometry-derived behavior.
- Own canonical glyph interpolation value ordering, source compatibility, variation-model construction, interpolation evaluation, and location-bound glyph resolution.
- Stay independent of TypeScript, NAPI, and bridge DTOs.

`Font::glyph_interpolation(glyph_id)` builds a reusable model from compatible master-source layers. The default source defines structural topology. Incompatible non-default layers and nonviable models do not become transport errors; callers receive `None` and may use their documented authored-layer fallback.

`Font::projection(location)` expects an internal authoring location. Apply external axis mappings before creating the projection. Resolution prefers an exact authored layer, then compatible interpolation, then the default or preferred authored layer. Component branches resolve at the same location and are flattened into each `ResolvedGlyph`.

## Boundaries

`shift-font` should not expose TypeScript-facing wire contracts. Those belong in `shift-wire`.

`shift-wire` may translate native interpolation regions and deltas into transport DTOs, but it must not rebuild source samples, define topology compatibility, or evaluate variation models.

`shift-font` should not perform SQLite persistence. Durable working-store reads and writes belong in `shift-store`.

`shift-font` should not own Electron, NAPI, or editor state. The TypeScript editor owns UI interaction, selection, hover, camera, tools, and command history.

`shift-font` should not expose Designspace records, fontir values, OpenType name IDs, Fixed 16.16 coordinates, or `avar`/STAT DTOs. Backends derive those interchange and compiler shapes from Shift's authoring concepts.

## Editing Shape

Mutations should live on the model object being mutated:

```rust
layer.add_empty_contour();
layer.add_point_to_contour(contour_id, x, y, point_type, smooth)?;
layer.remove_points(&point_ids)?;
layer.apply_bulk_node_positions(updates)?;
```

Transport and workspace layers should pass stable identity to find the model object, then call these methods. They should not introduce hidden native edit sessions.

## Verification

```bash
cargo fmt --all --check
cargo test -p shift-font
```

## Related

- `shift-source` -- stable `.shift` package projection.
- `shift-store` -- SQLite working-state persistence.
- `shift-workspace` -- mutation, ledger, and source/store coordination.
- `shift-backends` -- import and compiler adapters.
- `shift-wire` -- transport DTO projection.
