# Renderer font model

Reactive TypeScript font, authored glyph-layer, and derived glyph-view surfaces.

## Architecture Invariants

- **Architecture Invariant:** `FontSession` is the renderer's one immutable connection composition. Both `"authored"` and `"imported"` modes use `FontStore → Font → Editor → Scene → Renderer` and expose one concrete `GlyphCatalog`; only authored mode also owns a `Workspace` and mutation coordinator. Imported sessions eagerly receive stable session `GlyphId` values but no authored `GlyphRecord` or `GlyphLayer`.
- **Architecture Invariant:** `Font.loadGlyph()` is the asynchronous acquisition boundary. It returns one canonical `Glyph` only after every authored layer and transitive component dependency is available; retained calls return that same object without workspace I/O. `Editor.glyphForId()` may synchronously expose that object to runtime and plugin code after acquisition, but never initiates loading.
- **Architecture Invariant:** A loaded `Glyph` owns all authored `GlyphLayer` objects and direct component-Glyph references. Its record and layer collections update reactively without replacing the Glyph; its synchronous properties never initiate I/O.
- **Architecture Invariant:** `FontStore.#glyphs` contains only completely assembled Glyphs. Failed assembly installs nothing, and workspace replacement clears the complete object graph.
- **Architecture Invariant:** `GlyphLayer` is exact authored geometry. `GlyphRenderModel` is an internal location-bound render cache, not a second public Glyph concept. Named font instances are a separate product-preset concept.
- **Architecture Invariant:** `GlyphProjection` is plain, location-independent backing owned internally by `FontStore`. It is not an open/ready/loading lifecycle and is not exposed as the renderer's user-facing glyph object.
- **Architecture Invariant:** One `GlyphRenderModel` follows one location signal. Location changes lazily replace its current computed geometry; Shift never retains a cache keyed by historical location values.
- **Architecture Invariant:** `GlyphRenderModel.contours` is the complete root-plus-component contour occurrence stream used by rendering, bounds, layout, and sidebearings. A contour's `component` is `null` only when the root glyph owns it.
- **Architecture Invariant:** A render model shares one evaluated source-contour list per base glyph at its current location. Each component placement owns a distinct `GlyphContour` wrapper for transform and provenance; `GlyphRenderModel.contours` flattens references to those same occurrence objects rather than copying contour coordinates.
- **Architecture Invariant:** Rust owns component order, ancestry, attachment selection, and cycle pruning through `GlyphComponents`. TypeScript only resolves current coordinates and composes matrices. Component paths preserve authored occurrence identity; numeric transforms are selected by the occurrence's parent-local `componentIndex`, because compatible exact-source layers may assign different `ComponentId` values to corresponding slots.
- **Architecture Invariant:** Numeric authored edits flow through the existing `GlyphLayerState` signal graph. Do not add a revision signal, invalidate projections to `null`, or refetch native variation data for point, component-transform, advance, or metric value changes.
- **Architecture Invariant:** Typed glyph-layer editing methods apply locally representable operations before workspace I/O and queue the matching `FontIntent` through `LayerIntents`. The renderer never reinterprets intent envelopes; Rust remains their sole authoritative interpreter and validator. Each renderer-local `PendingEditId` remains pending until its FIFO echo arrives, and older echoes update a hidden confirmed shadow without replacing newer pending geometry. Rust-only edits remain workspace-driven.
- **Architecture Invariant:** `Font.committedFontCell` is an invalidation-only dependency for resources derived from the complete native font, including unloaded glyphs. It carries the stable Font value and notifies after committed echoes or workspace replacement; consumers use `track(...)`, never a revision counter.
- **Architecture Invariant:** Structural glyph, source, or axis changes rebuild retained native projections behind the workspace FIFO and publish replacements atomically. The previous projection remains usable until its replacement arrives.
- **Architecture Invariant:** Imported selected-glyph geometry is acquired lazily by stable glyph identity, then retained with its complete component closure until session disposal. External slider coordinates evaluate Rust-compiled `AxisMappingBasis` values synchronously before exact-source matching and projection evaluation. Raw mapping points never enter runtime evaluation; scrubbing is local basis evaluation, never a bridge, filesystem, or projection-acquisition request.
- **Architecture Invariant:** TypeScript evaluates `VariationBasis` values but never constructs variation sample order, support regions, master influence, or deltas. Authored interpolation, imported glyph variation, source metrics, Slug weights, and axis mappings share this evaluator.
- **Architecture Invariant:** Authored object IDs resolve through `FontStore` ownership indexes before imported-geometry fallback. Point, anchor, segment, and contour objects retain their authored `GlyphLayer` and read its live structure and coordinate signals, so object bounds and overlays remain reactive without rescanning complete geometry.
- **Architecture Invariant:** Selected-glyph sidebearing and advance controls read the editor's single glyph scene node. Values stay live through the glyph model; mutations are available only when that glyph has an exact authored layer at the current location.

## Codemap

```text
lib/model/
  Font.ts                    -- eager metadata, authoring operations, and Glyph acquisition
  FontStore.ts               -- workspace records, authored layer state, projections, canonical Glyph ownership
  Glyph.ts                   -- Glyph, GlyphLayer, internal GlyphRenderModel, root lookup, composed metrics
  ComponentGlyph.ts          -- component and contour occurrence provenance/reactivity
  GlyphLayerState.ts         -- reactive structure, segmented layer buffers, local operations, and pending confirmation
  RenderGlyph.ts             -- source-independent live selected-glyph view
lib/graphics/
  ContourPath.ts             -- canonical transformed commands and lazy path outputs
lib/interpolation/
  VariationBasis.ts          -- local evaluation of Rust/Fontdrasil-compiled numeric bases
  InterpolationBasis.ts      -- source-weight evaluation and source-value combination
types/
  glyph.ts                   -- GlyphReader and model construction contracts
  glyphRender.ts             -- renderer contour/anchor contracts plus passive RenderGlyph
workspace/
  FontSession.ts             -- immutable mode/catalog/optional-workspace composition
  FontSessionProvider.tsx    -- one renderer bootstrap and context boundary
lib/catalog/
  GlyphCatalog.ts              -- common Font/Editor projection consumed by the resident Grid
components/home/glyph-catalog/
  GlyphCatalogView.tsx       -- shared complete-residency catalog consumer
hooks/
  useGlyphSidebearings.ts    -- live selected-glyph sidebearing values and layer availability
  useGlyphXAdvance.ts        -- live selected-glyph advance and layer availability
```

## Key Types

- `Glyph` -- stable, completely loaded renderer domain object containing zero or more authored layers, direct references to its loaded component dependencies, and synchronous location-specific geometry backing.
- `GlyphLayer` -- editable geometry for one glyph/source pair.
- `LayerBuffers` -- segmented reactive advance, contour, anchor, and component values for one exact authored layer.
- `GlyphProjection` -- generated bridge DTO retained as compact backing: fallback, compatible interpolation, incompatible exact-source shapes, and component identities.
- `VariationBasis` -- normalized supports and numeric vectors compiled in Rust and evaluated locally without bridge traffic.
- `InterpolationBasis` -- real source identities plus a `VariationBasis` producing source contribution weights.
- `AxisMappingBasis` -- mapping input/output identities plus a `VariationBasis` producing normalized output adjustments.
- `ExternalAxisLocation` / `DesignAxisLocation` -- nominally distinct renderer maps. `mapAxisLocation` is the one-way external-to-design boundary; source matching and interpolation receive only the appropriate space.
- `GlyphVariation` -- imported fallback-relative numeric variation with no fabricated authored source identities.
- `GlyphRenderModel` -- internal reactive render cache bound to a location signal. Its contours, bounds, paths, advance, and sidebearings describe the complete displayed Glyph; root point/segment lookup remains root-owned.
- `ComponentGlyph` -- one ordered component occurrence with a full `ComponentId[]` ancestry, a parent-local correspondence index, current local/resolved transforms, direct contours, children, and bounds.
- `GlyphContour` -- one displayed contour occurrence over a source contour, a current transform, and optional owning `ComponentGlyph`; it replaces a `ContourPath` when reactive geometry changes.
- `ContourPath` -- non-reactive commands plus independently lazy SVG, Canvas path, and bounds for one transformed contour occurrence.

## Resolution and loading

`Font.loadGlyph()` is the sole public asynchronous Glyph acquisition API. Authored reads acquire complete layer snapshots; imported reads acquire a location-independent root projection plus its complete transitive component closure. The full response is validated before one batched `FontStore` publication, so failures publish nothing and remain retryable. Each successful Glyph and dependency stays resident for the session, and later calls return through the same Promise API without another source read.

Once acquired, `Glyph.layerForSource()`, `Glyph.layerForId()`, `Glyph.layerAt()`, and `Glyph.geometryAt()` are synchronous. `geometryAt()` prefers exact live authored geometry, then uses the Rust-computed projection for exact generated shapes or interpolation, and finally falls back to default or empty geometry. It never initiates workspace I/O.

`Editor.glyphForId()` is the synchronous runtime availability boundary. It returns the canonical acquired Glyph or `null`; use `Font.recordForId()` to distinguish a missing catalog record from a known but unacquired Glyph.

For a location, `Glyph` resolves geometry in this order:

1. a loaded exact authored `GlyphLayer`;
2. an incompatible exact-source shape retained in the projection;
3. compatible interpolation using live authored source values when resident and projection source values otherwise;
4. the projection fallback.

A font source can exist without a glyph layer. At that exact location the Glyph remains visible through interpolation or fallback, while `Glyph.layerAt()` returns `null` until geometry is authored there.

Every component Glyph follows that same resolution order independently at the
root render model's location. A sparse component can therefore interpolate between its
own masters even when it has no layer at the root glyph's exact source. When no
viable interpolation exists, it uses a deterministic master-backed fallback;
layer-only/background sources never participate.

## Scrubbing and reuse

`Glyph.renderModelAt()` retains one render model per live location signal through a `WeakMap`. Changing a signal reevaluates the same model; historical location values are not retained as cache keys.

Only observed render output is evaluated. Virtualized offscreen models do not subscribe to paths, and no sequence of scrubbed locations increases retained geometry. Component occurrence objects are reused by their Rust-supplied paths.

## Pending authored edits

Accepted layer edits move through **preview** (cancelable), **pending** (accepted and queued), and **confirmed** (workspace-echoed) vocabulary. `GlyphEditSession` queues the wire intent through `LayerIntents`, receives a renderer-local `PendingEditId`, and immediately applies the same typed operation to `GlyphLayerState`. Transactions share one pending identity and run inside one signal batch, so canonical reads inside the synchronous body see each operation while effects observe only the complete result. A throwing transaction restores each touched layer and sends nothing.

Local operations mutate the existing segmented `LayerBuffers`: advance, per-contour coordinates, anchors, and component transforms. The flat `Float64Array` is repacked lazily at geometry and wire boundaries. Renderer code does not parse `FontIntent.kind` or perform font-wide validation. Each loaded layer keeps a confirmed shadow only while edits are pending. Every echo advances that shadow, but visible geometry is replaced only after the layer's pending identities drain; workspace failure still discards renderer state through the existing full resync.

## Boundaries

- `FontSessionClient` owns the one renderer/utility channel and catches up from either the existing workspace snapshot or retained source snapshot according to immutable session mode.
- `GlyphCatalog` is the only font-wide surface consumed by Home/Grid. Imported `GlyphEntry` directory values populate `FontStore`, while imported authored-record and layer collections remain empty.
- Rust/Fontdrasil owns source compatibility and constructs every variation and axis-mapping basis.
- `shift-wire` and the workspace bridge translate those values without inventing samples, source identities, support regions, or a UI location.
- Raw `AxisMapping` values are available only to the `Font` authoring surface and mapping settings UI. Glyph/runtime contracts receive `AxisMappingBasis` values. A TypeScript helper that consumes mapping points to answer a renderer query is an architecture violation even when its output matches Rust fixtures.
- `FontStore` owns renderer-local backing, reactive authored state, and canonical completely loaded Glyph objects; do not wrap it in another manager/store/cache.
- `GlyphRenderModel` owns no editable source identity and cannot commit edits.
- `GlyphNodeDefinition` owns handle policy. It filters `GlyphRenderModel.contours` to root-owned occurrences and uses `GlyphRenderModel.anchors`; inherited component points never become editable root points.
- React controls acquisition demand but does not own font truth or interpolation caches.

## Verification

```bash
pnpm typecheck
pnpm test:unit
cargo test -p shift-font -p shift-wire -p shift-bridge
python3 scripts/context-drift-check.py
```

## Related

- [`shift-font`](../../../../../../../../crates/shift-font/docs/DOCS.md)
- [`shift-bridge`](../../../../../../../../crates/shift-bridge/docs/DOCS.md)
- [`signals`](../../signals/docs/DOCS.md)
