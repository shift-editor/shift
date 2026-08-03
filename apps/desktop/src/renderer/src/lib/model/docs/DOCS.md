# Renderer font model

Reactive TypeScript font, authored glyph-layer, and derived glyph-view surfaces.

## Architecture Invariants

- **Architecture Invariant:** `FontSession` is the renderer's one immutable connection composition. Both `"shift"` and `"preview"` modes expose `GlyphCatalogSource`; only Shift mode composes the authored `Workspace`, `Font`, `FontStore`, and `Editor`. Preview mode never creates those authored services or synthesizes Shift IDs.
- **Architecture Invariant:** `Font.loadGlyph()` is the asynchronous acquisition boundary. It returns one canonical `Glyph` only after every authored layer and transitive component dependency is available; retained calls return that same object without workspace I/O. `Editor.glyphForId()` may synchronously expose that object to runtime and plugin code after acquisition, but never initiates loading.
- **Architecture Invariant:** A loaded `Glyph` owns all authored `GlyphLayer` objects and direct component-Glyph references. Its record and layer collections update reactively without replacing the Glyph; its synchronous properties never initiate I/O.
- **Architecture Invariant:** `FontStore.#glyphs` contains only completely assembled Glyphs. Failed assembly installs nothing, and workspace replacement clears the complete object graph.
- **Architecture Invariant:** `GlyphLayer` is exact authored geometry. `GlyphRenderModel` is an internal location-bound render cache, not a second public Glyph concept. Named font instances are a separate product-preset concept.
- **Architecture Invariant:** `GlyphProjection` is plain, location-independent backing owned internally by `FontStore`. It is not an open/ready/loading lifecycle and is not exposed as the renderer's user-facing glyph object.
- **Architecture Invariant:** One `GlyphRenderModel` follows one location signal. Location changes lazily replace its current computed geometry; Shift never retains a cache keyed by historical location values.
- **Architecture Invariant:** `GlyphRenderModel.contours` is the complete root-plus-component contour occurrence stream used by rendering, bounds, layout, and sidebearings. A contour's `component` is `null` only when the root glyph owns it.
- **Architecture Invariant:** A render model shares one evaluated source-contour list per base glyph at its current location. Each component placement owns a distinct `GlyphContour` wrapper for transform and provenance; `GlyphRenderModel.contours` flattens references to those same occurrence objects rather than copying contour coordinates.
- **Architecture Invariant:** Rust owns component order, ancestry, attachment selection, and cycle pruning through `GlyphComponents`. TypeScript only resolves current coordinates and composes matrices.
- **Architecture Invariant:** Numeric authored edits flow through the existing `GlyphLayerState` signal graph. Do not add a revision signal, invalidate projections to `null`, or refetch native variation data for point, component-transform, advance, or metric value changes.
- **Architecture Invariant:** `Font.committedFontCell` is an invalidation-only dependency for resources derived from the complete native font, including unloaded glyphs. It carries the stable Font value and notifies after committed echoes or workspace replacement; consumers use `track(...)`, never a revision counter.
- **Architecture Invariant:** Structural glyph, source, or axis changes rebuild retained native projections behind the workspace FIFO and publish replacements atomically. The previous projection remains usable until its replacement arrives.
- **Architecture Invariant:** The grid requests projections by glyph identity with virtualized overscan. Scrubbing is local signal evaluation, never a bridge request or a TanStack Query location key.

## Codemap

```text
lib/model/
  Font.ts                    -- eager metadata, authoring operations, and Glyph acquisition
  FontStore.ts               -- workspace records, authored layer state, projections, canonical Glyph ownership
  Glyph.ts                   -- Glyph, GlyphLayer, internal GlyphRenderModel, root lookup, composed metrics
  ComponentGlyph.ts          -- component and contour occurrence provenance/reactivity
  GlyphLayerState.ts         -- reactive authored structure and numeric buffers
lib/graphics/
  ContourPath.ts             -- canonical transformed commands and lazy path outputs
lib/interpolation/
  InterpolationBasis.ts      -- local support evaluation and source-value combination
types/
  glyphRender.ts             -- contour and anchor contracts consumed by renderers
workspace/
  FontSession.ts             -- immutable mode/catalog/optional-workspace composition
  FontSessionProvider.tsx    -- one renderer bootstrap and context boundary
lib/catalog/
  ShiftGlyphCatalogSource.ts   -- projection over authored Font and Editor signals
  PreviewGlyphCatalogSource.ts -- retained source directory and dense location
components/home/
  GlyphGrid.tsx              -- shared complete-residency catalog consumer
```

## Key Types

- `Glyph` -- stable, completely loaded renderer domain object containing every authored layer, direct references to its loaded component dependencies, and synchronous location-specific geometry backing.
- `GlyphLayer` -- editable geometry for one glyph/source pair.
- `GlyphProjection` -- generated bridge DTO retained as compact backing: fallback, compatible interpolation, incompatible exact-source shapes, and component identities.
- `InterpolationBasis` -- source contribution math shared by glyphs with the same ordered compatible sources.
- `GlyphRenderModel` -- internal reactive render cache bound to a location signal. Its contours, bounds, paths, advance, and sidebearings describe the complete displayed Glyph; root point/segment lookup remains root-owned.
- `ComponentGlyph` -- one ordered component occurrence with a full `ComponentId[]` ancestry, current local/resolved transforms, direct contours, children, and bounds.
- `GlyphContour` -- one displayed contour occurrence over a source contour, a current transform, and optional owning `ComponentGlyph`; it replaces a `ContourPath` when reactive geometry changes.
- `ContourPath` -- non-reactive commands plus independently lazy SVG, Canvas path, and bounds for one transformed contour occurrence.

## Resolution and loading

`Font.loadGlyph()` is the sole public asynchronous Glyph acquisition API. It reads complete authored layer snapshots for editing, follows the transitive component closure, assembles every required Glyph, connects component references, and installs the group into `FontStore` together. Each full snapshot includes the same projection backing used by lightweight consumers; loading a glyph does not create a second interpolation mechanism. A retained Glyph returns immediately through the same Promise API without another workspace read or waiting for unrelated queued edits. Callers that require queued workspace truth must await `WorkspaceEditCoordinator.settled()` explicitly.

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

## Boundaries

- `FontSessionClient` owns the one renderer/utility channel and catches up from either the existing workspace snapshot or retained source snapshot according to immutable session mode.
- `GlyphCatalogSource` is the only font-wide surface consumed by Home/Grid; preview directory values remain source-local and never populate `FontStore`.
- Rust owns source compatibility and constructs bases/projections.
- `shift-wire` and the workspace bridge transport those values without resolving a UI location.
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
