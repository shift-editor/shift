# Graphics

Renderer vector-path values and the accelerated marker-layer backend for editor handle drawing.

## Architecture Invariants

- **Architecture Invariant:** `ContourPath` is a non-reactive value for one transformed contour. It owns canonical path commands and independently lazy tight bounds, SVG text, and Canvas `Path2D`; glyph identity, component provenance, locations, and signal ownership remain in the model layer.

- **Architecture Invariant:** `Renderer` owns the `MarkerLayer` lifecycle. `CanvasContextProvider` only reports DOM canvas mount, resize, and unmount events.

- **Architecture Invariant:** `ResidentGlyphLayer` is the generic catalog-preview boundary. It owns one WebGPU adapter/device/context and independently replaceable authored root pages; Slug names and packed-layout knowledge remain behind that backend rather than entering React catalog components.

- **Architecture Invariant:** Catalog route activity and GPU readiness are independent. Leaving `/home` makes the catalog inert and keeps it painted behind the opaque editor without destroying the resident layer or resizing its canvas. Returning submits one cheap redraw because Chromium may discard the WebGPU canvas presentation. Initial readiness requires the complete fixed-page set and a completed submitted frame; after that, scrolling performs no atlas acquisition or geometry upload.

- **Architecture Invariant:** Atlas invalidation never removes a presented root before every affected replacement page is uploaded. Axis, source, mapping, directory, and structural changes retain the prior complete frame, build the complete affected fixed-page set at the new authored revision, and install that set in one synchronous glyph-map replacement. One bounded native or cached page occupies the utility lane at a time, while page acquisition remains entirely outside the scroll path.

- **Architecture Invariant:** Preview cell geometry is fixed. Axis and source changes redraw glyph contents without changing columns, row pitch, or cell dimensions. Each visible glyph unions its exact resolved bounds with the metrics-and-advance viewport, retains the metrics-derived default pixels per em when it fits, and otherwise scales down within its box.

- **Architecture Invariant:** **CRITICAL**: The instance buffer layout (attribute offsets in the draw command) must exactly match the packing order in `MarkerHandleRenderer.#writeInstance`. If either side changes stride/offset, handles render garbage with no error.

- **Architecture Invariant:** **CRITICAL**: `MARKER_INSTANCE_FLOATS` (currently 25) defines both the Float32Array packing stride in `MarkerHandleRenderer` and the byte stride in REGL attribute bindings (`stride = MARKER_INSTANCE_FLOATS * 4`). Changing this constant requires updating both sides simultaneously.

- **Architecture Invariant:** The REGL extensions `ANGLE_instanced_arrays` and `OES_standard_derivatives` must be available. Initialization catches failures and sets `#available = false`, making `Handles` fall back to CPU drawing silently.

- **Architecture Invariant:** Shape IDs in `SHAPE_IDS` must match the `v_shape` branch order in the fragment shader. Adding a new shape requires a new SDF branch in `handle.frag.glsl`, a new entry in `SHAPE_IDS`, and a new style builder in `handleStyles`.

## Codemap

```
graphics/
  ContourPath.ts              — transformed contour commands with lazy path outputs
  canvasText.ts               — width-constrained Canvas2D label fitting
  backends/
    MarkerLayer.ts            — WebGL context: REGL init, instance buffer management, draw command
    ResidentGlyphLayer.ts     — WebGPU catalog device, complete page-set uploads, atomic replacement, draw, and teardown
```

Supporting files live in the editor rendering module:

```
editor/rendering/markers/
  types.ts                 — MarkerShape, MarkerColour, MarkerInstance, MARKER_INSTANCE_FLOATS
  overlays/handles/MarkerHandleRenderer.ts — point handle items -> packed Float32Array
  handleStyles.ts          — CachedInstanceStyle, STYLES lookup table, SHAPE_IDS
  color.ts                 — parseCssColor: CSS color string -> GpuColor [r,g,b,a] floats
  shaders/
    handle.vert.glsl.ts    — vertex shader: scene-to-clip transform with rotation
    handle.frag.glsl.ts    — fragment shader: SDF shape dispatch (box, circle, triangle, segment)
    sdf.glsl.ts            — SDF primitives: sdCircle, sdBox, sdTriangle, sdSegment + coverage
```

## Key Types

- `ContourPath` -- immutable transformed contour output shared by SVG rendering, Canvas rendering, and bounds checks. Commands are eager; each representation is cached only after its first read.

- `MarkerLayer` -- WebGL context wrapper. Manages REGL instance, instance buffer, and draw command. Provides `resizeCanvas`, `draw`, `clear`, `destroy`, and `isAvailable`.

- `ResidentGlyphLayer` -- algorithm-neutral surface used by the catalog controller. It retains one device/context and prepares, streams, and atomically installs complete sets of independently replaceable native or cached Slug root pages.

- `MarkerInstance` -- logical representation of one marker shape. The current marker path packs directly into a `Float32Array` for zero steady-state allocation.

- `CachedInstanceStyle` -- pre-computed GPU-ready style for a shape+state combination (shapeId, size, lineWidth, colors as `GpuColor`, extent). Built once at module load by `buildStyleByState`.

- `STYLES` -- static lookup: `STYLES[shape][state]` yields a `CachedInstanceStyle`. Shapes: corner, smooth, control, direction, first, last. States: idle, hovered, selected.

- `SHAPE_IDS` -- maps `MarkerShape` names to integer IDs consumed by the fragment shader's `v_shape` branching.

## How it works

### Contour paths

`GlyphContour` owns the reactive boundary for a contour occurrence. When source points or its placement matrix change, it replaces the current `ContourPath`. SVG previews read only `svgPath`; Canvas rendering reads only `path`; bounds and sidebearings read only `bounds`. Every output is derived from the same transformed command stream, so these consumers cannot disagree about component placement or curve geometry.

### Initialization

`CanvasContextProvider` reports the marker canvas to `Editor`, which forwards the DOM canvas lifecycle to `Renderer`. `Renderer` owns the `MarkerLayer` backend and exposes that stable backend to `Handles`. REGL is initialized lazily on the first `resizeCanvas` call. If WebGL init fails (missing extensions, context lost), `#available` stays `false` and `Handles.draw` uses its CPU fallback path.

### Resident catalog lifecycle

`GlyphCatalogController` retains `ResidentGlyphLayer` across routes and tracks `Font.invalidGlyphIdsCell`. Directory revisions build one glyph-to-page index, so invalidation never linearly searches the directory per root. Initial residency uploads every deterministic 256-root directory page in one `atlasBuild`; `SlugRenderer.loadPages` constructs all GPU page resources before synchronously replacing glyph mappings and exposing the first frame. Local edits and global structural changes leave the prior complete mappings active, abort stale candidates, and rebuild every affected fixed page as one atomic replacement. The invalid-root set is the current-revision residency authority: successful page-set installation removes its requested roots, and complete residency means the set is empty. Scrolling only updates fixed layout instances and submits a frame; it never prepares, streams, cancels, or installs atlas pages. The glyph canvas reports `data-fully-resident="true"` only for the complete current revision, while `data-grid-readiness` distinguishes `Initial`, `Stale`, `Complete`, and `Unavailable` for product E2E assertions. Route-dependent navigation is accessed through a stable callback ref so it cannot recreate the controller or device. `#needsRedraw` keeps overlay-only pointer updates from submitting glyph frames.

`GlyphCatalogLayout` owns fixed shared cell dimensions independent of atlas pages and design location. The preview shader reads each visible glyph's exact resolved scratch bounds, unions them with the metrics-and-advance viewport, and caps its fit scale at the metrics-derived `defaultPixelsPerEm`. Oversized glyphs shrink individually instead of clipping or resizing the Grid.

Set `SHIFT_PROFILE_SLUG_ATLAS=1` for release measurements. Main propagates that opt-in to the renderer without adding a product DTO. Rust reports native acquisition/compilation/layout phases, utility reports cache lookup, bounded stream, cache finalization and publication, and renderer reports complete page-set prepare, stream/upload, atomic installation and first-frame GPU completion. Ordinary runs omit this profiling telemetry.

### Per-frame draw pipeline

1. `Handles.draw` is called with the scene `Canvas`, glyph data, handle states, camera, and draw offset.
2. `Handles` reuses `PointHandleItem` wrappers, then `MarkerHandleRenderer` culls those items against camera-owned visible bounds, looks up `STYLES[shape][state]`, and writes 25 floats per visible point into a reusable `Float32Array`.
3. `MarkerLayer.draw` receives the packed array, instance count, camera, draw offset, and logical canvas size. If the packed array exceeds `#instanceCapacity`, it reallocates the REGL buffer; otherwise it uses `subdata` for a zero-alloc update.
4. The REGL draw command runs instanced rendering: 6 vertices (unit quad) per instance. The vertex shader transforms each handle from scene coordinates to clip space, applying viewport pan/zoom/scale. The fragment shader dispatches on `v_shape` to the appropriate SDF (box for corner, circle for smooth/control, triangle for direction/first, segment for last), computes fill/stroke coverage with anti-aliasing via `fwidth`, and composites an optional overlay color.

### Buffer growth strategy

The instance buffer only grows, never shrinks. When `packedInstances.length > #instanceCapacity`, the entire buffer is replaced. Otherwise, `subdata` overwrites in place. This avoids per-frame allocation for stable glyph sizes.

## Workflow recipes

### Adding a new handle shape

1. Add the shape name to `MarkerShape` union in `types.ts`.
2. Add its integer ID to `SHAPE_IDS` in `handleStyles.ts`.
3. Add a theme entry in `Theme` and a style builder function in `handleStyles.ts`.
4. Add the entry to the `STYLES` object.
5. Add a new `else if (v_shape < N.5)` branch in `handle.frag.glsl.ts` with the SDF.
6. Add classification logic on `PointHandleItem`.
7. If the shape needs new SDF primitives, add them to `sdf.glsl.ts`.

### Changing handle colors or sizes

Modify the theme values in `Theme`. `handleStyles.ts` reads from `DEFAULT_THEME` at module load, so changes take effect on next app start (or HMR reload). No shader changes needed.

### Debugging GPU rendering issues

Set a breakpoint or add logging in `MarkerLayer.draw`. Check `isAvailable()` returns `true`. If handles render as garbage, verify `MARKER_INSTANCE_FLOATS` matches the attribute offset layout in `#initialize`. Compare `SHAPE_IDS` values against the `v_shape` branch thresholds in the fragment shader.

## Gotchas

- **Silent CPU fallback**: If WebGL init fails, `Handles` silently falls back to Canvas 2D drawing. There is only a `console.warn` in `MarkerLayer.#initialize`. Check the browser console if GPU markers are not rendering.

- **Styles are module-level constants**: `STYLES` is built once from `DEFAULT_THEME` when `handleStyles.ts` loads. Runtime theme changes will not update GPU marker styles without a module reload.

- **Instance buffer never shrinks**: If a glyph temporarily has many points (e.g., during a paste), the GPU buffer stays at peak size until the context is destroyed.

- **Shape ID float comparison**: The fragment shader uses `v_shape < N.5` thresholds to branch on shape type. Shape IDs must be sequential integers starting at 0. Gaps or reordering will route to the wrong SDF.

- **No depth buffer**: REGL is initialized with `depth: false`. Handle draw order is determined by instance order in the packed array (contour iteration order). Overlapping handles composite via alpha blending.

## Verification

- See [Desktop E2E tests](../../../../../../e2e/README.md) for visual and hardware-GPU verification commands.
- Run `pnpm test:desktop apps/desktop/src/renderer/src/lib/graphics/ContourPath.test.ts` after changing contour command, transform, SVG, Canvas, or bounds behavior.
- No dedicated tests exist for `MarkerLayer`. Verify GPU markers visually: open a glyph with mixed point types (corner, smooth, off-curve), hover and select points, confirm correct shapes and state colors.
- Check CPU fallback: in `MarkerLayer.#initialize`, temporarily throw before `this.#available = true`. Handles should still render via Canvas 2D.
- After shader changes, test on both high-DPI and 1x displays -- the `fwidth`-based AA is sensitive to pixel ratio.

## Related

- `GlyphContour` -- reactive glyph/component occurrence wrapper that owns a live `ContourPath`
- `Handles` -- owns accelerated marker-layer drawing plus CPU fallback; calls `MarkerLayer.draw`
- `Renderer` -- owns `MarkerLayer` lifetime; calls `resizeCanvas` on resize
- `Editor` -- temporarily forwards canvas lifecycle from `CanvasContextProvider` to `Renderer`
- `CanvasContextProvider` -- React context that reports canvas DOM lifecycle to `Editor`
- `MarkerHandleRenderer` -- packs reusable point handle items into the Float32Array consumed by `MarkerLayer.draw`
- `GlyphCatalogController` -- screen-space catalog RAF, interaction, and layout owner
- `SlugAtlas` / `SlugRenderer` -- internal packed-atlas and shader implementation behind `ResidentGlyphLayer`
- `DEFAULT_THEME` -- theme object whose handle styles feed into `STYLES` at load time
