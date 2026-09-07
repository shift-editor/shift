# shift-font

<!-- reviewed: 2026-09-05 review-every: 90d -->

First-class Rust font object model for Shift.

## Architecture Invariants

- **Architecture Invariant:** `shift-font` owns Shift authoring concepts and semantic validation, never format/compiler DTOs.
- **Architecture Invariant:** Stable IDs are identity. Names, tags, Unicode assignments, and coordinates remain editable authoring values.
- **Architecture Invariant:** Glyph-structure IDs are font-wide within their entity type. Contours, points, components, anchors, and glyph-layer guidelines are never addressed by a layer-qualified identity.
- **Architecture Invariant:** Ordered, identity-addressable authoring collections use `EntityList`. Its iteration, equality, and serialization preserve authored order; its private backing container is not part of the model contract.
- **Architecture Invariant:** Glyph creation is append-only. Undo uses `Font::pop_glyph` and succeeds only for the matching directory tail; arbitrary glyph deletion has no authoring intent. Batched undo therefore pops glyphs in reverse creation order without reindexing a CJK-scale directory.
- **Architecture Invariant:** Named instances own complete external locations but no source or geometry. Sources own design-space locations.
- **Architecture Invariant:** The default source is the required master origin at the axes' default location, not an arbitrary fallback. `DeleteSource` rejects both the default source and the last source; replacing the default requires a future explicit atomic operation that preserves a valid origin.
- **Architecture Invariant:** Mapping edits never rewrite external named-instance intent.
- **Architecture Invariant:** Fontdrasil exclusively constructs variation sample order, supports, and numeric deltas. `shift-font` exposes compiled `VariationBasis` and `AxisMappingBasis` values; TypeScript and transport layers only evaluate or translate them.
- **Architecture Invariant:** Authored metadata and font metrics are independent. Metadata edits replace the complete metadata snapshot without rewriting metrics.
- **Architecture Invariant:** UPM is font-global. Metric identities and semantic roles are font-owned; positions, overshoots, and optional technical metrics are authored on master sources.
- **Architecture Invariant:** Point removal never leaves empty contour records. Removing a contour's final point prunes the contour and its stable identity from the font-wide structure index.

## Codemap

```text
crates/shift-font/src/
  ir/              -- font entities, IDs, axes, mappings, instances, glyph data
    collection.rs  -- semantic ordered identity collections
    variation.rs   -- external-to-design mapping evaluation
  intents.rs       -- atomic authoring intents and semantic application
  changes.rs       -- replace-grade semantic change records
  layer_edit.rs    -- glyph-layer geometry mutations
  interpolation.rs -- source compatibility, reusable bases, source values
  projection.rs    -- location-independent glyph payloads and resolved views
  composite.rs     -- component occurrences, attachment semantics, and flattening
```

## Key Types

- `Font` owns glyphs, sources, axes, axis mappings, named instances, metadata, and font-level data.
- `EntityList` owns stable-ID lookup and authoring order for glyphs, contours, components, and future ordered entity collections.
- `FontMetadata` is the complete authored naming and attribution snapshot replaced by `UpdateFontMetadata`.
- `Axis` has stable identity, an external/internal role, a continuous or discrete kind, and optional external/user-space value labels.
- `AxisLabel` has font-wide stable identity so UI rows and later instance recipes survive renames and reordering.
- `AxisMapping` owns an ordered set of mapping points. Independent mappings transform one external axis; the optional cross-axis group maps one design-space location to another.
- `ExternalLocation` and `DesignLocation` are serde-transparent nominal wrappers around `Location`. Mapping accepts only the former and interpolation/projection accepts only the latter.
- `NamedInstance` is an explicit named product preset at a complete external location. It owns no source, layer, or compiler representation.
- `MetricDefinition` gives one metric row stable identity and a standard or custom semantic role.
- `Source` is an editable designspace position with a name, location, complete metric values, and optional technical metrics.
- `SourceMetricInterpolation` owns metric identity, optional technical-field participation, variation regions, and delta ordering for source-owned metrics.
- `Glyph` is a glyph concept identified by `GlyphId`.
- `GlyphLayer` is authored editable data for one glyph at one source.
- `LibData` and recursive `LibValue::Dict` use ordered maps so equal domain values serialize deterministically.
- `GlyphEntityId` gives `FontIndex` one typed set for contour, point, component, anchor, and guideline identity.
- `VariationBasis` is the source-neutral Fontdrasil output: normalized regions paired with numeric `VariationDelta` vectors.
- `InterpolationBasis` combines real source identities with a `VariationBasis` whose vectors produce source weights; it never contains glyph coordinates or metrics.
- `AxisMappingBasis` combines mapping input/output identities with a `VariationBasis` whose vectors produce normalized output adjustments.
- `GlyphInterpolation` combines a reusable basis with one glyph's compatible authored source values. The glyph's default-source layer owns topology when present; otherwise a deterministic master-backed reference layer allows sparse glyph interpolation.
- `LayerCompatibility` records every hard structural difference between an interpolation reference layer and another source layer. `LayerDifference` retains ordered path, node, anchor, and component evidence for diagnostics.
- `GlyphProjection` is a compact location-independent glyph payload: shared fallback layers, optional compatible interpolation, exact-source topology exceptions, `GlyphComponents`, and transitive component identities.
- `GlyphProjectionSet` is an immutable, read-scoped projection table for requested roots and their transitive components. It prepares each glyph once and reuses interpolation bases keyed by ordered compatible source identities; callers discard it after the current read or compilation.
- `GlyphComponents` is the ordered, cycle-pruned component occurrence list for one root glyph. Every `ComponentGlyph` carries its full `ComponentId` ancestry, its zero-based slot within the immediate parent layer, and its Rust-selected anchor attachment. The ancestry identifies the authored occurrence; the parent-local slot correlates numeric transforms across compatible source layers whose corresponding components have different authored IDs.
- `FontProjection` is a read-only, location-bound view that reuses resolved component layers across one or many glyph requests.
- `ResolvedGlyph` is derived, flattened geometry plus x advance. An existing blank glyph resolves to an empty contour list; a missing glyph resolves to `None`.
- `Contour` and `Point` describe outline geometry inside a glyph layer. Quadratic path conversion preserves one off-curve control and a `PointType::QCurve` endpoint rather than reducing the endpoint to `OnCurve`.

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
- Provide model-native helpers for layer editing, component resolution, variation behavior, axis mapping evaluation, and geometry-derived behavior. `Font::replace_glyph_layers` retains previous layers through cheap `Arc` references, validates a complete hydration/eviction batch into one `HashSet<GlyphEntityId>`, moves that set into the final index, mutates uniquely owned fonts in place, and preserves shared snapshots through copy-on-write.
- Own canonical glyph, source-metric, and axis-mapping variation-model construction. Fontdrasil constructs every sample order, support region, and delta vector; consumers evaluate the resulting bases without reconstructing them.
- Stay independent of TypeScript, NAPI, and bridge DTOs.

`Font::glyph_interpolation(glyph_id)` builds compatible source values over an `InterpolationBasis`. The glyph's default-source layer defines structural topology when it exists. Sparse glyphs without that layer choose their most structurally complete master as the reference layer. When two compatible masters bracket the normalized default on one axis, the basis derives a virtual default contribution from them; more complex underdetermined layouts use the documented static fallback. The basis depends only on axes and ordered source locations, so the same mechanism can interpolate other numeric domains without copying glyph concepts into them.

`GlyphLayer::interpolation_compatibility_with(source)` is the source of truth for hard structural compatibility. The receiver is the interpolation reference. It compares paths, nodes, anchors, and components in authored order and never sorts them. OpenType requires corresponding outlines to have the same contour and point structure, and `gvar` addresses composite components by their ordered component index. Shift therefore treats the ordered base-glyph sequence as structural. `ComponentId` identifies one authored node inside one layer and remains the basis of occurrence ancestry, but it is not cross-source correspondence: compatible layers may use different IDs for components in the same ordered slot. See the [OpenType Font Variations overview](https://learn.microsoft.com/en-us/typography/opentype/spec/otvaroverview), the [`gvar` composite processing rules](https://learn.microsoft.com/en-us/typography/opentype/spec/gvar#point-numbers-and-processing-for-composite-glyphs), and [fontTools interpolatability diagnostics](https://fonttools.readthedocs.io/en/latest/varLib/interpolatable.html).

Coordinates, advance width, smooth flags, anchor positions, and component transforms are interpolated values, not structural compatibility. Matching anchor count, names, and order is currently a Shift-specific restriction because anchor positions share the ordered glyph interpolation vector; OpenType `gvar` and fontTools do not define source-anchor compatibility. Variable component scale or matrix transforms need a separate export diagnostic because `gvar` varies component placement rather than those transforms. Correspondence and quality warnings such as contour order, wrong start point, and kinks are separate from this hard structural result.

`Font::glyph_projection(glyph_id)` preserves the preferred fallback, compatible interpolation, incompatible authored source topology, and Rust-owned component relationships without resolving a location. `Font::glyph_projection_set(glyph_ids)` applies the same semantics to a batch while preparing each requested or transitively referenced glyph once and sharing equal source-location bases. Authored fallback and exact-source layers remain `Arc`-shared; only derived interpolation values are owned by the projections. Each glyph in the component closure resolves independently at the shared root location: exact master, then interpolation, then static master fallback. Layer-only/background sources never supply projection geometry. A renderer can retain this compact payload and combine its basis with current authored source signals. No arbitrary location result is persisted, and projection sets must not survive authored edits.

`Font::source_metric_interpolation()` combines the same coordinate-independent basis with complete master-source metric vectors. Optional technical fields participate only when every master authors them, so interpolation does not invent sparse values.

`Font::axis_mapping_bases()` compiles authored independent and cross-axis mappings through Fontdrasil. `map_location` and `map_location_with_bases` are the only external-to-design boundaries: external locations evaluate independent bases first, then cross-axis bases against the independently mapped location, and the resulting `DesignLocation` must not be mapped again. Raw mapping points remain authoring data and never become renderer evaluation input. Output parity does not authorize another language or bridge layer to reconstruct the same model.

`Font::projection(location)` expects an internal authoring location. Apply external axis mappings before constructing it. Resolution prefers an exact authored layer, then compatible interpolation, then the default or preferred fallback. A globally authored source with no glyph layer is not blank by definition: it uses interpolation/fallback while remaining non-editable at that source. Component branches resolve independently at the same location and are flattened through the same `GlyphComponents` semantics exposed to renderers.

## Boundaries

`shift-font` should not expose TypeScript-facing wire contracts. Those belong in `shift-wire`.

`shift-wire` may translate native bases, source values, and projections into transport DTOs, but it must not rebuild source samples, define value ordering or topology compatibility, or evaluate variation models.

`shift-font` should not perform SQLite persistence or define a durable binary encoding. Canonical document and recovery reads, writes, MessagePack encoding, compression, and compatibility policy belong in `shift-store`.

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

## Workflow recipes

### Adding a new authoring intent

1. Add the variant to `FontIntent` in `crates/shift-font/src/intents.rs`. Layer-scoped intents carry a `LayerId`; extend `FontIntent::layer_id()` and `required_layer_ids()` so `shift-workspace` can acquire the complete layer read set before applying.
2. Implement the branch in `Font::apply_intents`, delegating the actual edit to a method on the owning model object (`GlyphLayer`, `Font`, `Source`).
3. Emit a replace-grade `FontChange` record via a constructor in `changes.rs` (e.g. `FontChange::layer_geometry_replaced`). Records carry post-mutation snapshots, not deltas — the workspace persists and replays them.
4. If the renderer needs identity synchronously, accept caller-minted IDs through a seed struct such as `PointSeed` rather than returning Rust-minted IDs after the fact.
5. Wire the downstream layers separately: ledger mapping in `shift-workspace`, then in `shift-bridge` a new `NapiFontIntent` payload field plus a `map_intent` branch — intents do not get per-intent `#[napi]` methods; they all flow through the single `apply` entry point.
6. Verify: `cargo test -p shift-font`, and `cargo test -p shift-workspace` when ledger semantics are affected.

### Adding a glyph-layer geometry mutation

1. Add the method to `GlyphLayer` in `crates/shift-font/src/layer_edit.rs`, next to `add_point_to_contour` and `remove_points`. Return `CoreResult` for anything that can reference missing identity.
2. Never leave an empty contour record behind: follow `remove_points`, which prunes emptied contours and returns the pruned `ContourId` values so the font-wide structure index stays consistent.
3. Bulk position paths take `BulkNodePositionUpdates` flat ID/coordinate slices; validate coordinate length against the ID count before mutating anything so a malformed batch never half-applies.
4. Verify: `cargo test -p shift-font`.

## Gotchas

- Bulk coordinate buffers are interleaved `x0, y0, x1, y1, …` in font units. A coords slice whose length is not exactly twice the ID slice fails validation up front — no partial application, but also no silent truncation.
- `remove_points` returns the `ContourId` values of contours it pruned. Callers caching contour identity (selection, hit-testing, snapshots) must consume that return value; assuming a contour survives point removal is wrong.
- `ExternalLocation` and `DesignLocation` are deliberately incompatible. `from_untyped`/`as_untyped` exist only for serialization boundaries — using them to shortcut a conversion silently skips axis mapping. Never feed an already-mapped `DesignLocation` back through mapping; mapping is not idempotent.
- Cross-source component correspondence is the ordered slot, not `ComponentId`. Compatible layers may use different component IDs in the same slot, so sorting a layer's components or joining on ID across sources silently breaks `gvar`-style compatibility.
- `GlyphProjectionSet` is scoped to one read or compilation. Holding one across an authored edit yields stale geometry with no error — nothing invalidates it for you.
- A source with no layer for a glyph is not an empty glyph: it resolves through interpolation or fallback and is simply non-editable at that source. Only an authored empty layer means blank.
- Never select the first remaining source after default-source deletion. Designspace defaults are location-defined, and Shift compilation requires the identified default to remain a master at the normalized default location; unsupported deletion must fail before mutation.
- Anchor count/name/order compatibility is a Shift-specific restriction (anchor positions share the glyph interpolation vector). Do not assume fontTools or OpenType define it when relaxing or tightening compatibility rules.

## Verification

```bash
cargo fmt --all --check
cargo test -p shift-font
```

## Related

- `shift-store` -- canonical SQLite `.shift` documents and recovery persistence.
- `shift-workspace` -- mutation, ledger, and source/store coordination.
- `shift-backends` -- import and compiler adapters.
- `shift-wire` -- transport DTO projection.
