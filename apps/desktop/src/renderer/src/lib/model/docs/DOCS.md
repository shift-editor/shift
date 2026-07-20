# Renderer font model

Reactive TypeScript font, authored glyph-layer, and derived glyph-view surfaces.

## Architecture Invariants

- **Architecture Invariant:** `GlyphLayer` is exact authored geometry. `GlyphView` is derived read/render/hit-test geometry at one reactive location. Named font instances are a separate product-preset concept; do not call derived glyph views instances.
- **Architecture Invariant:** `GlyphProjection` is plain, location-independent backing owned internally by `FontStore`. It is not an open/ready/loading lifecycle and is not exposed as the renderer's user-facing glyph object.
- **Architecture Invariant:** One `GlyphView` follows one location signal. Location changes lazily replace its current computed geometry; Shift never retains a cache keyed by historical location values.
- **Architecture Invariant:** `GlyphView.contours` is the complete root-plus-component contour occurrence stream used by rendering, bounds, layout, and sidebearings. A contour's `component` is `null` only when the root glyph owns it.
- **Architecture Invariant:** A view shares one evaluated source-contour list per base glyph at its current location. Each component placement owns a distinct `GlyphContour` wrapper for transform and provenance; `GlyphView.contours` flattens references to those same occurrence objects rather than copying contour coordinates.
- **Architecture Invariant:** Rust owns component order, ancestry, attachment selection, and cycle pruning through `GlyphComponents`. TypeScript only resolves current coordinates and composes matrices.
- **Architecture Invariant:** Numeric authored edits flow through the existing `GlyphLayerState` signal graph. Do not add a revision signal, invalidate projections to `null`, or refetch native variation data for point, component-transform, advance, or metric value changes.
- **Architecture Invariant:** Structural glyph, source, or axis changes rebuild resident native projections behind the workspace FIFO and publish replacements atomically. The previous projection remains usable until its replacement arrives.
- **Architecture Invariant:** The grid requests projections by glyph identity with virtualized overscan. Scrubbing is local signal evaluation, never a bridge request or a TanStack Query location key.

## Codemap

```text
lib/model/
  Font.ts                    -- font facade, view resolution, shared basis weights
  FontStore.ts               -- workspace records, authored layer state, projection/view ownership
  Glyph.ts                   -- Glyph, GlyphLayer, GlyphView, root lookup, composed metrics
  ComponentGlyph.ts          -- component and contour occurrence provenance/reactivity
  GlyphLayerState.ts         -- reactive authored structure and numeric buffers
lib/graphics/
  ContourPath.ts             -- canonical transformed commands and lazy path outputs
lib/interpolation/
  InterpolationBasis.ts      -- local support evaluation and source-value combination
types/
  glyphRender.ts             -- contour and anchor contracts consumed by renderers
hooks/
  useGlyphViews.ts           -- React demand boundary for batched projection reads
components/home/
  GlyphGrid.tsx              -- virtualized projection consumer
  GlyphPreview.tsx           -- frame-scheduled path and advance subscriber
```

## Key Types

- `Glyph` -- stable renderer domain object over a resident primary authored layer.
- `GlyphLayer` -- editable geometry for one glyph/source pair.
- `GlyphProjection` -- generated bridge DTO retained as compact backing: fallback, compatible interpolation, incompatible exact-source shapes, and component identities.
- `InterpolationBasis` -- source contribution math shared by glyphs with the same ordered compatible sources.
- `GlyphView` -- stable reactive view bound to a location signal. Its contours, bounds, paths, advance, and sidebearings describe the complete displayed glyph; root point/segment lookup remains root-owned.
- `ComponentGlyph` -- one ordered component occurrence with a full `ComponentId[]` ancestry, current local/resolved transforms, direct contours, children, and bounds.
- `GlyphContour` -- one displayed contour occurrence over a source contour, a current transform, and optional owning `ComponentGlyph`; it replaces a `ContourPath` when reactive geometry changes.
- `ContourPath` -- non-reactive commands plus independently lazy SVG, Canvas path, and bounds for one transformed contour occurrence.

## Resolution and loading

`Font.loadGlyph()` reads complete authored layer snapshots for editing. Each full snapshot includes the same projection backing used by lightweight consumers; loading a glyph does not create a second interpolation mechanism.

`useGlyphViews()` is the React demand boundary for compact reads. It observes `Font.glyphViewsCell()`, requests missing root projections, and receives roots plus transitive component projections. Already resident projections remain available when virtualized rows leave the viewport, so rapid reverse scrolling does not restart work.

For a location, `Font` resolves geometry in this order:

1. a resident exact authored `GlyphLayer`;
2. an incompatible exact-source shape retained in the projection;
3. compatible interpolation using live authored source values when resident and projection source values otherwise;
4. the projection fallback.

A font source can exist without a glyph layer. At that exact location the glyph remains visible through interpolation/fallback, while `editableLayerAt()` returns `null` until geometry is authored there.

Every component glyph follows that same resolution order independently at the
root view's location. A sparse component can therefore interpolate between its
own masters even when it has no layer at the root glyph's exact source. When no
viable interpolation exists, it uses a deterministic master-backed fallback;
layer-only/background sources never participate.

## Scrubbing and reuse

`FontStore` interns bases by ordered source identities within the current axis/source topology. `Font` memoizes evaluated source weights by basis object and location signal. Glyphs sharing a compatible source set therefore evaluate source weights once per signal update, then combine those weights with their own current source vectors.

Only observed view output is evaluated. Virtualized offscreen views do not subscribe to paths, and no sequence of scrubbed locations increases retained geometry. Component occurrence objects are reused by their Rust-supplied paths.

## Boundaries

- Rust owns source compatibility and constructs bases/projections.
- `shift-wire` and the workspace bridge transport those values without resolving a UI location.
- `FontStore` owns renderer-local backing and reactive authored state; do not wrap it in another manager/store/cache.
- `GlyphView` owns no editable source identity and cannot commit edits.
- `GlyphNodeDefinition` owns handle policy. It filters `GlyphView.contours` to root-owned occurrences and uses `GlyphView.anchors`; inherited component points never become editable root points.
- React controls projection demand but does not own font truth or interpolation caches.

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
