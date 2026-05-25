# shift-ir

Format-agnostic intermediate representation for font data, serving as the canonical in-memory model for the Shift editor.

## Architecture Invariants

**Architecture Invariant:** Point, contour, anchor, guideline, layer, and source IDs are generated from a single global `ENTITY_COUNTER` (atomic u64 in `entity.rs`). This guarantees uniqueness across the running application without coordination. Never construct those numeric IDs manually via `from_raw` in production code -- that bypass is for deserialization and tests only.

**Architecture Invariant:** `GlyphId` and `ComponentId` are string-backed and document-stable. Newly created glyphs get readable IDs derived from their creation name, newly created components get generated stable IDs, and deserialized data can preserve package IDs such as `"glyph_A"` or `"component_Aacute_base"`. WHY: glyphs and components need to survive save/load, rename, selection, undo, dependency analysis, and source-package round trips without relying on mutable names or process-local counters.

**Architecture Invariant:** Typed ID newtypes (`PointId`, `ContourId`, `ComponentId`, `LayerId`, etc.) prevent accidental cross-type usage. A `PointId` cannot be passed where a `ContourId` is expected. WHY: font editing operations pass many IDs around; mixing them up would silently corrupt data.

**Architecture Invariant:** `Font` always has exactly one default layer, created at construction time and stored as `default_layer_id`. The default layer uses the name `"public.default"`. WHY: every glyph operation assumes a default layer exists; removing or replacing it breaks the editing pipeline.

**CRITICAL:** Glyphs are keyed by `GlyphName` (String) in `Font.glyphs`. If you rename a glyph via `set_name()` without re-inserting it, the HashMap key becomes stale and the glyph becomes unreachable by its new name.

**Architecture Invariant:** Contours and components are stored in `HashMap<ContourId/ComponentId, _>` for O(1) lookup by ID, but anchors and guidelines are stored in `Vec` for order preservation. WHY: contour/component identity matters for selection and editing; anchor ordering matters for mark attachment semantics in OpenType.

**Architecture Invariant:** `Component` stores a `DecomposedTransform` (translate, rotate, scale, skew, center) rather than a raw affine matrix. The raw `Transform` matrix is derived on demand via `to_matrix()`. WHY: decomposed form is what the UI manipulates; the matrix form is what rendering and file formats need.

**Architecture Invariant:** IR types must remain format-agnostic. No UFO paths, binary table offsets, or format-specific metadata belong here. Format-specific concerns live in `shift-backends`. WHY: the IR is the single source of truth shared by all readers, writers, and the editor core.

**Architecture Invariant:** `shift-ir` must not know about TypeScript or bridge bindings. Frontend-facing DTOs live in `shift-wire`, and TypeScript bridge declarations are generated from `shift-bridge`. WHY: IR is the Rust domain model, not a cross-language API contract.

## Codemap

```
src/
  lib.rs           -- public re-exports and GlyphName type alias
  entity.rs        -- ENTITY_COUNTER, EntityId, typed_id! macro, stable GlyphId/ComponentId
  font.rs          -- Font (root container), FontMetadata
  metrics.rs       -- FontMetrics (upm, ascender, descender, etc.)
  glyph.rs         -- Glyph, GlyphLayer (per-layer contours/components/anchors)
  contour.rs       -- Contour, Contours (BezPath interop)
  point.rs         -- Point, PointType (OnCurve, OffCurve, QCurve)
  segment.rs       -- CurveSegment, CurveSegmentIter
  component.rs     -- Component, Transform, DecomposedTransform
  anchor.rs        -- Anchor (named attachment point)
  guideline.rs     -- Guideline, GuidelineOrientation
  layer.rs         -- Layer (named layer definition)
  kerning.rs       -- KerningData, KerningPair, KerningSide
  axis.rs          -- Axis (design space axis), Location
  source.rs        -- Source (master at a design-space location)
  features.rs      -- FeatureData (.fea source storage)
  boolean.rs       -- boolean() function, BooleanOp (via linesweeper)
  lib_data.rs      -- LibData, LibValue (arbitrary plist-style storage)
```

## Key Types

- `Font` -- root container holding metadata, metrics, layers, glyphs, kerning, features, guidelines, and lib data
- `Glyph` -- stable-ID glyph with editable name, unicode mappings, and per-layer data (`HashMap<LayerId, GlyphLayer>`)
- `GlyphLayer` -- layer-specific data: contours (`HashMap<ContourId, Contour>`), components (`HashMap<ComponentId, Component>`), anchors (`Vec<Anchor>`), guidelines
- `Contour` -- ordered `Vec<Point>` with open/closed flag; converts to/from `kurbo::BezPath`
- `Point` -- position (f64, f64) with `PointType` and smooth flag
- `PointType` -- `OnCurve` (anchor on curve), `OffCurve` (cubic Bezier handle), `QCurve` (quadratic TrueType)
- `CurveSegment` / `CurveSegmentIter` -- typed iteration over point sequences as Line, Quad, or Cubic segments
- `Component` -- reference to another glyph by name with `DecomposedTransform`, sparse `Location`, and axis inheritance behavior
- `DecomposedTransform` -- translate, rotate, scale, skew, center; composes to raw `Transform` matrix
- `Transform` -- raw 2x3 affine matrix
- `Layer` -- named layer with ID (default is `"public.default"`)
- `Anchor` -- named (x, y) position for mark attachment
- `KerningData` -- kerning pairs with group1/group2 support; lookup resolves groups
- `Axis` -- design space axis with tag, range, normalize/denormalize
- `Location` -- map of axis tag to value; normalizable against axes
- `Source` -- master at a `Location`, linked to a `LayerId`
- `LibData` / `LibValue` -- arbitrary key-value storage (plist semantics)

## How it works

**Ownership hierarchy:** `Font` uses copy-on-write storage around its document data and glyph map. Glyphs use copy-on-write layer storage. Each `GlyphLayer` owns contours (by `ContourId`), components (by `ComponentId`), and anchors (ordered `Vec`). This keeps save snapshots cheap while preserving normal value-style mutation APIs.

**Identity model:** `Font` still exposes name-keyed glyph APIs for compatibility with the current app and bridge, but `GlyphId` is the durable identity. Use `glyph_by_id()` when selection, undo, source-package projection, or rename/delete safety depends on identity rather than the editable glyph name.

**Edit pattern:** The upstream `shift-edit` crate edits a `GlyphLayer` through `EditSession`. The bridge owns active edit lifecycle and commits the edited layer back to the glyph/font when the session ends.

**Segment iteration:** `Contour::segments()` returns a `CurveSegmentIter` that classifies consecutive points by their on-curve/off-curve pattern: two on-curve points produce a `Line`, on-off-on produces a `Quad`, on-off-off-on produces a `Cubic`. For closed contours, the iterator wraps around from the last point back to the first.

**BezPath interop:** `Contour` converts to/from `kurbo::BezPath` for use with the `linesweeper` boolean operations and kurbo geometry utilities. The `Contours` newtype wraps `Vec<Contour>` and implements `From<&BezPath>` to handle multi-subpath paths.

**Variable fonts:** `Axis` defines a design space dimension. `Source` links a `Location` (axis coordinates) to a `LayerId`. `Axis::normalize()` / `denormalize()` map between user-space and normalized (-1..0..1) coordinates.

**Variation math:** Shared wrappers around `fontdrasil::VariationModel` live in
`variation.rs`. Use these helpers for glyph interpolation, component variation
state, and other source/package projections that need OpenType-style variation
math. Do not grow parallel interpolation implementations in `shift-edit`,
`shift-source`, or the bridge. Use `NormalizedF64VariationModel` when a caller
needs to build the model once and evaluate several locations, such as live
component previews or export preflight.

## Variable-First IR Direction

The `.shift` source-format spike is allowed to reshape `shift-ir` when it
discovers concepts that make the editor model better. IR should not blindly mirror
any file format, but it should model the semantic objects the editor needs to
edit, render, select, inspect, undo, preview, and reason about efficiently.

Current `Component` carries the editor-facing part of variable component state:

```rust
Component {
    id: ComponentId,
    base_glyph: GlyphName,
    transform: DecomposedTransform,
    location: Location,
    axis_inheritance: AxisInheritance,
}
```

That is enough for simple composites and sparse variable component placement.
It still leaves durable base-glyph targeting and component-specific variation
source records in source/package services. If component recipes become a
first-class editor feature, IR should grow toward this shape:

```rust
Component {
    id: ComponentId,
    base: GlyphRef,
    transform: DecomposedTransform,
    location: ComponentLocation,
    axis_inheritance: AxisInheritance,
    condition: Option<ComponentCondition>,
    variation_sources: Vec<ComponentVariationSource>,
}

GlyphRef {
    id: GlyphId,
    name: GlyphName, // display label/cache, not the durable target
}

ComponentLocation {
    values: BTreeMap<AxisId, f64>, // sparse overrides
}

AxisInheritance {
    InheritParent,
    ResetUnspecifiedToDefault,
}
```

Candidate editor/domain commands:

```rust
set_component_base(component_id, glyph_id)
set_component_transform(component_id, transform)
set_component_location(component_id, axis_id, value)
clear_component_location_axis(component_id, axis_id)
set_component_axis_inheritance(component_id, AxisInheritance::ResetUnspecifiedToDefault)
set_component_condition(component_id, condition)
add_component_variation_source(component_id, parent_location)
set_component_variation_source_location(component_source_id, axis_id, value)
set_component_variation_source_transform(component_source_id, transform)
resolve_component_at_location(component_id, location)
```

Interactions this enables:

- component inspector edits base glyph, transform, sparse axis overrides, and
  reset/inherit behavior directly
- axis scrubber previews active/inactive conditional components and interpolated
  component transforms through the same variation math used for glyph
  interpolation
- glyph rename updates labels while component targets remain stable
- glyph delete preview asks the document model for stable-ID dependents
- undo stores semantic component operations instead of JSON/file patches
- export preflight can explain whether a component lowers to `VARC`, avar/avar2
  mappings, designspace/UFO data, or fallback decomposition

Promotion rule:

```text
If the renderer, inspector, selection model, undo model, or bridge API is simpler
when a source-package concept is live in the editor model, promote it into IR.
If the concept is only about package layout, fingerprints, crash recovery,
conflict detection, or artifact writing, keep it out of IR.
```

## Workflow recipes

### Add a new field to a core type

1. Add the field to the struct (e.g., in `glyph.rs`)
2. Update `Default` impl if applicable
3. Add getter/setter methods
4. Update backend readers/writers in `shift-backends` to handle the new field
5. If the field crosses the bridge boundary, add or update the DTO in `shift-wire`

### Add a new entity type

1. Add `typed_id!(NewEntityId)` in `entity.rs`
2. Export it in `lib.rs`
3. Create the entity struct with an `id: NewEntityId` field
4. Use `NewEntityId::new()` in constructors (auto-increments from global counter)

Use a custom string-backed ID instead of `typed_id!` when the entity identity
must be stable across save/load and map directly to source-package data.
`GlyphId` and `ComponentId` are the current examples.

### Add boolean operations on contours

1. Convert contours to `BezPath` using the `From` impl
2. Call `boolean(BooleanOp::Union, &a, &b)` (or other op)
3. Result is `Contours` (a `Vec<Contour>` wrapper) -- each contour has fresh IDs

### Perform a glyph edit (from shift-edit)

1. `font.take_glyph("A")` to extract
2. Mutate the glyph's layer data
3. `font.put_glyph(glyph)` to return it

## Gotchas

- **Stale glyph keys:** `Glyph::set_name()` does not update the `Font` HashMap key. After renaming, you must `remove_glyph(old_name)` and `insert_glyph(renamed_glyph)`.
- **Anchor lookup is O(n):** Anchors are stored in a `Vec`, so `GlyphLayer::anchor(id)` is a linear scan. This is fine for typical glyph anchor counts (2-5) but would be a problem if anchor counts grew large.
- **DecomposedTransform roundtrip with skew:** `DecomposedTransform::from_matrix()` assumes no transformation center and may not perfectly roundtrip when skew is involved.
- **HashMap iteration order:** Contours and components are in `HashMap` -- iteration order is nondeterministic. If order matters (e.g., for file output), the backend must sort. Components should be sorted by stable component ID text.
- **Global atomic counter:** `ENTITY_COUNTER` is a process-global `AtomicU64`. Numeric IDs are unique within a process but not across processes. `GlyphId` and `ComponentId` are exceptions: they are string-backed so they can map to durable source/package IDs.
- **`from_raw` accepts u128 but truncates to u64:** The `typed_id!` macro's `from_raw` takes `u128` and casts to `u64`. This is intentional for compatibility but can silently lose high bits.

## Verification

```bash
# Run all shift-ir tests
cargo test -p shift-ir

# Verify downstream crates still compile
cargo check -p shift-edit -p shift-backends
```

## Related

- `shift-edit` -- editing logic (`EditSession`, constraint enforcement) that operates on IR types
- `shift-backends` -- format readers/writers (UFO, Glyphs) that produce/consume `Font`
- `shift-wire` -- bridge DTOs derived from IR/edit state
- `shift-bridge` -- NAPI bindings exposing bridge DTOs to JavaScript/TypeScript
- `kurbo::BezPath` -- external type used for path geometry interop
- `linesweeper` -- external crate powering `boolean()` operations
