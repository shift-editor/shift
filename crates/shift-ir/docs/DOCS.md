# shift-ir

Format-agnostic intermediate representation for font data, serving as the canonical in-memory model for the Shift editor.

## Architecture Invariants

**Architecture Invariant:** All entity IDs are generated from a single global `ENTITY_COUNTER` (atomic u64 in `entity.rs`). This guarantees uniqueness across the entire application without coordination. Never construct IDs manually via `from_raw` in production code -- that bypass is for deserialization and tests only.

**Architecture Invariant:** Typed ID newtypes (`PointId`, `ContourId`, `LayerId`, etc.) wrap `EntityId` to prevent accidental cross-type usage. A `PointId` cannot be passed where a `ContourId` is expected. WHY: font editing operations pass many IDs around; mixing them up would silently corrupt data.

**Architecture Invariant:** `Font` always has exactly one default layer, created at construction time and stored as `default_layer_id`. The default layer uses the name `"public.default"`. WHY: every glyph operation assumes a default layer exists; removing or replacing it breaks the editing pipeline.

**CRITICAL:** Glyphs are keyed by `GlyphName` (String) in `Font.glyphs`. If you rename a glyph via `set_name()` without re-inserting it, the HashMap key becomes stale and the glyph becomes unreachable by its new name.

**Architecture Invariant:** Contours and components are stored in `HashMap<ContourId/ComponentId, _>` for O(1) lookup by ID, but anchors and guidelines are stored in `Vec` for order preservation. WHY: contour/component identity matters for selection and editing; anchor ordering matters for mark attachment semantics in OpenType.

**Architecture Invariant:** `Component` stores a `DecomposedTransform` (translate, rotate, scale, skew, center) rather than a raw affine matrix. The raw `Transform` matrix is derived on demand via `to_matrix()`. WHY: decomposed form is what the UI manipulates; the matrix form is what rendering and file formats need.

**Architecture Invariant:** IR types must remain format-agnostic. No UFO paths, binary table offsets, or format-specific metadata belong here. Format-specific concerns live in `shift-backends`. WHY: the IR is the single source of truth shared by all readers, writers, and the editor core.

**Architecture Invariant:** `FontMetadata`, `FontMetrics`, and `DecomposedTransform` derive `ts_rs::TS` to auto-generate TypeScript types for the frontend. If you add fields to these types, run the TS export to keep types in sync.

## Codemap

```
src/
  lib.rs           -- public re-exports and GlyphName type alias
  entity.rs        -- ENTITY_COUNTER, EntityId, typed_id! macro
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
- `Glyph` -- named glyph with unicode mappings and per-layer data (`HashMap<LayerId, GlyphLayer>`)
- `GlyphLayer` -- layer-specific data: contours (`HashMap<ContourId, Contour>`), components (`HashMap<ComponentId, Component>`), anchors (`Vec<Anchor>`), guidelines
- `Contour` -- ordered `Vec<Point>` with open/closed flag; converts to/from `kurbo::BezPath`
- `Point` -- position (f64, f64) with `PointType` and smooth flag
- `PointType` -- `OnCurve` (anchor on curve), `OffCurve` (cubic Bezier handle), `QCurve` (quadratic TrueType)
- `CurveSegment` / `CurveSegmentIter` -- typed iteration over point sequences as Line, Quad, or Cubic segments
- `Component` -- reference to another glyph by name with `DecomposedTransform`
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

**Ownership hierarchy:** `Font` owns `HashMap<GlyphName, Glyph>`. Each `Glyph` owns `HashMap<LayerId, GlyphLayer>`. Each `GlyphLayer` owns contours (by `ContourId`), components (by `ComponentId`), and anchors (ordered `Vec`). This is a pure value tree with no reference counting or interior mutability.

**Edit pattern:** The upstream `shift-core` crate uses `take_glyph()` / `put_glyph()` to temporarily extract a glyph from the font, mutate it through an `EditSession`, then return it. This avoids borrow conflicts since the font no longer holds the glyph during editing.

**Segment iteration:** `Contour::segments()` returns a `CurveSegmentIter` that classifies consecutive points by their on-curve/off-curve pattern: two on-curve points produce a `Line`, on-off-on produces a `Quad`, on-off-off-on produces a `Cubic`. For closed contours, the iterator wraps around from the last point back to the first.

**BezPath interop:** `Contour` converts to/from `kurbo::BezPath` for use with the `linesweeper` boolean operations and kurbo geometry utilities. The `Contours` newtype wraps `Vec<Contour>` and implements `From<&BezPath>` to handle multi-subpath paths.

**Variable fonts:** `Axis` defines a design space dimension. `Source` links a `Location` (axis coordinates) to a `LayerId`. `Axis::normalize()` / `denormalize()` map between user-space and normalized (-1..0..1) coordinates.

**TypeScript bridge:** `FontMetadata`, `FontMetrics`, and `DecomposedTransform` use `ts-rs` to export TypeScript type definitions to `packages/types/src/generated/`.

## Workflow recipes

### Add a new field to a core type

1. Add the field to the struct (e.g., in `glyph.rs`)
2. Update `Default` impl if applicable
3. Add getter/setter methods
4. If the type has `#[ts(export)]`, run `cargo test` to regenerate TS types
5. Update backend readers/writers in `shift-backends` to handle the new field

### Add a new entity type

1. Add `typed_id!(NewEntityId)` in `entity.rs`
2. Export it in `lib.rs`
3. Create the entity struct with an `id: NewEntityId` field
4. Use `NewEntityId::new()` in constructors (auto-increments from global counter)

### Add boolean operations on contours

1. Convert contours to `BezPath` using the `From` impl
2. Call `boolean(BooleanOp::Union, &a, &b)` (or other op)
3. Result is `Contours` (a `Vec<Contour>` wrapper) -- each contour has fresh IDs

### Perform a glyph edit (from shift-core)

1. `font.take_glyph("A")` to extract
2. Mutate the glyph's layer data
3. `font.put_glyph(glyph)` to return it

## Gotchas

- **Stale glyph keys:** `Glyph::set_name()` does not update the `Font` HashMap key. After renaming, you must `remove_glyph(old_name)` and `insert_glyph(renamed_glyph)`.
- **Anchor lookup is O(n):** Anchors are stored in a `Vec`, so `GlyphLayer::anchor(id)` is a linear scan. This is fine for typical glyph anchor counts (2-5) but would be a problem if anchor counts grew large.
- **DecomposedTransform roundtrip with skew:** `DecomposedTransform::from_matrix()` assumes no transformation center and may not perfectly roundtrip when skew is involved.
- **HashMap iteration order:** Contours and components are in `HashMap` -- iteration order is nondeterministic. If order matters (e.g., for file output), the backend must sort.
- **Global atomic counter:** `ENTITY_COUNTER` is a process-global `AtomicU64`. IDs are unique within a process but not across processes. Deserialized fonts get new IDs at load time.
- **`from_raw` accepts u128 but truncates to u64:** The `typed_id!` macro's `from_raw` takes `u128` and casts to `u64`. This is intentional for compatibility but can silently lose high bits.

## Verification

```bash
# Run all shift-ir tests
cargo test -p shift-ir

# Check TS type generation still works
cargo test -p shift-ir -- --ignored 2>/dev/null || cargo test -p shift-ir

# Verify downstream crates still compile
cargo check -p shift-core -p shift-backends
```

## Related

- `shift-core` -- editing logic (`EditSession`, constraint enforcement) that operates on IR types
- `shift-backends` -- format readers/writers (UFO, Glyphs) that produce/consume `Font`
- `shift-node` -- NAPI bindings exposing IR types to the JavaScript/TypeScript frontend
- `kurbo::BezPath` -- external type used for path geometry interop
- `linesweeper` -- external crate powering `boolean()` operations
