# shift-font

First-class Rust font object model for Shift.

## Architecture Invariants

- **Architecture Invariant:** `shift-font` owns Shift authoring concepts and semantic validation, never format/compiler DTOs.
- **Architecture Invariant:** Stable IDs are identity. Names, tags, Unicode assignments, and coordinates remain editable authoring values.
- **Architecture Invariant:** Glyph-structure IDs are font-wide within their entity type. Contours, points, components, anchors, and glyph-layer guidelines are never addressed by a layer-qualified identity.
- **Architecture Invariant:** Ordered, identity-addressable authoring collections use `EntityList`. Its iteration, equality, and serialization preserve authored order; its private backing container is not part of the model contract.
- **Architecture Invariant:** Named instances own complete external locations but no source or geometry. Sources own design-space locations.
- **Architecture Invariant:** Mapping edits never rewrite external named-instance intent.
- **Architecture Invariant:** Authored metadata and font metrics are independent. Metadata edits replace the complete metadata snapshot without rewriting metrics.
- **Architecture Invariant:** UPM is font-global. Metric identities and semantic roles are font-owned; positions, overshoots, and optional technical metrics are authored on master sources.

## Codemap

```text
crates/shift-font/src/
  ir/              -- font entities, IDs, axes, mappings, instances, glyph data
    collection.rs  -- semantic ordered identity collections
  intents.rs       -- atomic authoring intents and semantic application
  changes.rs       -- replace-grade semantic change records
  layer_edit.rs    -- glyph-layer geometry mutations
  variation.rs     -- external-to-design mapping evaluation
  interpolation.rs -- source compatibility, reusable bases, source values
  projection.rs    -- location-independent glyph payloads and resolved views
  composite.rs     -- recursive component flattening
```

## Key Types

- `Font` owns glyphs, sources, axes, axis mappings, named instances, metadata, and font-level data.
- `EntityList` owns stable-ID lookup and authoring order for glyphs, contours, components, and future ordered entity collections.
- `FontMetadata` is the complete authored naming and attribution snapshot replaced by `UpdateFontMetadata`.
- `Axis` has stable identity, an external/internal role, a continuous or discrete kind, and optional external/user-space value labels.
- `AxisLabel` has font-wide stable identity so UI rows and later instance recipes survive renames and reordering.
- `AxisMapping` owns an ordered set of mapping points. Independent mappings transform one external axis; the optional cross-axis group maps one design-space location to another.
- `NamedInstance` is an explicit named product preset at a complete external location. It owns no source, layer, or compiler representation.
- `MetricDefinition` gives one metric row stable identity and a standard or custom semantic role.
- `Source` is an editable designspace position with a name, location, complete metric values, and optional technical metrics.
- `SourceMetricInterpolation` owns metric identity, optional technical-field participation, variation regions, and delta ordering for source-owned metrics.
- `Glyph` is a glyph concept identified by `GlyphId`.
- `GlyphLayer` is authored editable data for one glyph at one source.
- `InterpolationBasis` is coordinate-independent variation math for an ordered source set. It contains normalized supports and source coefficient rows, never glyph coordinates or metrics.
- `GlyphInterpolation` combines a reusable basis with one glyph's compatible authored source values. Its default-source template owns topology.
- `GlyphProjection` is a compact location-independent glyph payload: fallback shape, optional compatible interpolation, exact-source shapes for incompatible topology, and component identities.
- `FontProjection` is a read-only, location-bound view that reuses resolved component layers across one or many glyph requests.
- `ResolvedGlyph` is derived, flattened geometry plus x advance. An existing blank glyph resolves to an empty contour list; a missing glyph resolves to `None`.
- `Contour` and `Point` describe outline geometry inside a glyph layer.

## Identity

Stable IDs are identity. Names and Unicode values are editable metadata.

- `GlyphId` identifies a glyph.
- `SourceId` identifies a source.
- `LayerId` identifies a glyph layer: the authored data for one glyph at one source.
- `ContourId`, `PointId`, `ComponentId`, `AnchorId`, and glyph-layer `GuidelineId` identify one authored node anywhere in the font; authoring operations mint them rather than accepting user-chosen values.
- `AxisMappingId` identifies a font-owned mapping independently of its editable name.
- `AxisLabelId` identifies an axis value label independently of its editable name or position.
- `NamedInstanceId` identifies an explicit product preset independently of its editable name and location.
- `MetricId` identifies an authored metric row independently of its editable name, order, and source-local values.

## How it works

- Own font authoring data structures such as `Font`, `Glyph`, `GlyphLayer`, `Contour`, `Point`, `Source`, and `Axis`.
- Keep object-level mutation behavior near the objects it mutates.
- Provide model-native helpers for layer editing, component resolution, variation behavior, axis mapping evaluation, and geometry-derived behavior.
- Own canonical glyph and source-metric interpolation value ordering, variation-model construction, interpolation evaluation, and location-bound glyph resolution.
- Stay independent of TypeScript, NAPI, and bridge DTOs.

`Font::glyph_interpolation(glyph_id)` builds compatible source values over an `InterpolationBasis`. The default source defines structural topology. The basis depends only on axes and ordered source locations, so the same mechanism can interpolate other numeric domains without copying glyph concepts into them.

`Font::glyph_projection(glyph_id)` preserves the preferred fallback, compatible interpolation, and incompatible authored source shapes without resolving a location. The fallback is normally the default-source layer and uses the glyph's preferred layer when the default source has no layer for that glyph. A renderer can retain this compact payload and combine its basis with current authored source signals. No arbitrary location result is persisted.

`Font::source_metric_interpolation()` combines the same coordinate-independent basis with complete master-source metric vectors. Optional technical fields participate only when every master authors them, so interpolation does not invent sparse values.

`Font::projection(location)` expects an internal authoring location. Apply external axis mappings before constructing it. Resolution prefers an exact authored layer/shape, then compatible interpolation, then the default or preferred fallback. A globally authored source with no glyph layer is not blank by definition: it uses interpolation/fallback while remaining non-editable at that source. Component branches resolve at the same location and are flattened into each `ResolvedGlyph`.

## Boundaries

`shift-font` should not expose TypeScript-facing wire contracts. Those belong in `shift-wire`.

`shift-wire` may translate native bases, source values, and projections into transport DTOs, but it must not rebuild source samples, define value ordering or topology compatibility, or evaluate variation models.

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
