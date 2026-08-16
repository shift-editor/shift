# Editor

Central orchestrator for the canvas-based glyph editing surface, wiring viewport transforms, selection, rendering, hit testing, and tool management into a single facade.

## Architecture Invariants

**Architecture Invariant:** `Editor` is a facade -- it delegates viewport, hover, rendering, and tool dispatch to named subsystem objects. Tools receive `Editor` directly but must not reach into private managers.

**Architecture Invariant:** `Scene` owns generic, serializable `ShiftNode` records and placement only. It must not import or retain `Glyph`, `GlyphLayer`, or resolved geometry. Navigation finishes `Font.loadGlyph()` before entering the editor route, and the route synchronously confirms acquisition before publishing the ordinary ID-based glyph node.

**Architecture Invariant:** `Editor.#store` is the generic `ShiftStore<ShiftEditorRecord>` for scene and session records. The injected `Editor.#fontStore` owns canonical complete Glyph objects for those ID-based records. Neither store contains the other store's domain objects.

**Architecture Invariant:** `Font.loadGlyph()` is the only asynchronous Glyph acquisition API. `Editor.glyphForId()` is the synchronous runtime and NodeDefinition lookup: it returns the canonical complete Glyph when available, returns `null` otherwise, and never starts I/O. Use `Font.recordForId()` when code must distinguish a nonexistent current-font ID from a Glyph that has not been acquired.

**Architecture Invariant:** Pointer events still carry `screen`, `scene`, and active glyph-local coordinates for the current tool path. Placed scene item-local conversion is not global; it requires an `ItemId` through `Scene.toLocal()` / `Scene.toScene()`.

**Architecture Invariant:** `drawOffset` is derived render state. Text tools focus glyphs by `GlyphAnchor { runId, itemId }`; `Editor` resolves that anchor through `TextRuns` and `TextLayout.editOriginForItem()`. Tools must not set text-run edit placement coordinates directly.

**Architecture Invariant: CRITICAL:** `Camera` owns the affine matrices as lazily computed cells. Anything that reads viewport-derived values inside a `computed` or `effect` will auto-track. Calling `setRect()`, changing zoom/pan, or changing UPM invalidates both matrices and triggers downstream redraws automatically. Never cache matrix results outside a signal.

**Architecture Invariant: CRITICAL:** Rendering is driven by named reactive effects owned by `Renderer`. Each effect reads explicit dependency signals before drawing. If editor state should trigger a redraw, add a named read to the correct render dependency boundary -- do not request redraw imperatively from tools or UI handlers.

**Architecture Invariant:** `FrameHandler` deduplicates `requestAnimationFrame` calls per canvas layer. Multiple signal changes within a single frame coalesce into one render. Canvas lifecycle changes, such as replacing a layer context after resize, are represented as renderer surface signals so redraw causes remain inspectable.

**Architecture Invariant:** `GlyphLayerEditDraft` is the only way to perform continuous layer previews (drags). Call `beginGlyphLayerEditDraft()` at drag start, `preview*()` on each move, and either `commit()` or `discard()` at drag end. Commit accepts the final absolute positions as one pending workspace edit; applying those positions over the preview is intentionally idempotent. Calling `commit` twice is a no-op; forgetting to call `commit`/`discard` leaks the preview state.

**Architecture Invariant:** Lifecycle events (`EventEmitter`) are for one-shot imperative actions (`fontLoaded`, `fontSaved`, `destroying`). Continuous state changes use signals. Do not mix the two patterns.

**Architecture Invariant:** Camera and text-layout metrics resolve from the active design location through `Font.metricsAtLocation()`. Exact master locations use authored source values; intermediate locations evaluate the Rust-built source-metric interpolation model.

**Architecture Invariant:** `Selection` is a dumb ordered set of branded object IDs. Mutations go through `select()`, `add()`, `remove()`, and `toggle()`; behavior and live bounds come from resolving those IDs through `Editor.object()`.

**Architecture Invariant:** Glyph-domain hit testing belongs to glyph geometry and editor glyph lookup helpers. Tool-specific controls, such as select bounding-box handles, are owned and hit-tested by the tool that renders them.

**Architecture Invariant:** `Handles` tries the accelerated marker layer first and falls back to CPU canvas drawing if WebGL is unavailable. The marker-layer path packs all handle instances into a `Float32Array` for a single draw call.

## Codemap

```
editor/
  Editor.ts              -- Facade (~1750 lines), wires all subsystems
  lifecycle.ts           -- EventEmitter for fontLoaded/fontSaved/destroying
  sidebearings.ts        -- deriveGlyphSidebearings, roundSidebearing
  managers/
    Camera.ts             -- UPM<->screen affine matrices, zoom, pan
  rendering/
    Renderer.ts          -- Canvas layer orchestration and RAF scheduling
    Canvas.ts            -- 2D drawing API wrapping CanvasRenderingContext2D
    Handles.ts           -- Marker-layer handle rendering with CPU fallback
    FrameHandler.ts      -- RAF deduplication per render target
    FpsMonitor.ts        -- Rolling-window FPS measurement
    Theme.ts             -- DEFAULT_THEME shared editor visual constants
    constants.ts         -- SCREEN_HIT_RADIUS (8px)
    Camera.visibleSceneBounds -- Frustum culling for off-screen elements
    markers/             -- WebGL marker shaders and instance packing
    overlays/            -- Guides, ControlLines, Segments, Anchors,
                            DebugOverlays, Handles, handleDrawing
    composite.ts         -- Composite glyph hit testing
```

## Key Types

- **`Editor`** -- Facade class. Owns `Selection`, `Hover`, `Camera`, `Renderer`, `ToolManager`, `Clipboard`, `EventEmitter`, and the workspace transaction facade. Passed directly to tools and NodeDefinitions; `glyphForId()` exposes already-acquired canonical Glyphs without exposing FontStore.
- **`Scene`** -- Owns generic, serializable placed-node records and node-level queries. Glyph acquisition and retained object ownership remain outside Scene.
- **`ShiftStore<ShiftEditorRecord>`** -- Editor-owned generic record store for scene nodes, selection, editing, and text runs.
- **`FontStore`** -- Workspace-owned renderer mirror injected privately into Editor for synchronous lookup of already-loaded Glyph objects.
- **`Camera`** -- Owns zoom/pan/UPM signals, computed affine matrices (`Mat`), and all coordinate projection methods (`projectScreenToScene`, `projectSceneToScreen`, `screenToUpmDistance`).
- **`Renderer`** -- Manages four stacked canvas layers (background, scene, markers/WebGL, overlay), their `FrameHandler` instances, and the canvas item layers that draw each pass.
- **`Canvas`** -- Thin wrapper around `CanvasRenderingContext2D` with `pxToUpm()` conversion and themed drawing primitives. Carries `CameraTransform` and `Theme`.
- **`CameraTransform`** -- Value object: `{ zoom, panX, panY, centre, upmScale, logicalHeight, layoutHeight, padding, descender }`. Snapshot of viewport state passed to rendering code.
- **`Selection`** -- Ordered branded-ID selection state. It exposes `stateCell` and unwrapped ID getters; `Editor.selectionBoundsCell` resolves current live objects and their bounds.
- **`SelectableId`** -- Branded identity accepted by selection regardless of the object's concrete kind.
- **`Coordinates`** -- Pair of `{ screen, scene }` for a single pointer position. Node-local coordinates are derived after hit testing identifies the node being acted on.
- **`GlyphLayerEditDraft`** -- Transactional interface for continuous layer manipulation: `previewPositionPatch()` / `previewTranslate()` / `previewRotate()` / `previewScale()` during drag, `commit(label)` or `discard()` at end.
- **`Hover`** -- Tracks the currently hovered glyph-domain entity (point/anchor/segment). Tool-specific controls such as select bounding boxes stay with the owning tool.
- **`Handles`** -- Handle renderer that tries the accelerated marker layer and falls back to CPU drawing internally.
- **`FrameHandler`** -- Deduplicates `requestAnimationFrame` per render target. Only the latest callback fires.
- **`EventEmitter`** -- Typed emitter for `LifecycleEventMap` (`fontLoaded`, `fontSaved`, `destroying`).
- **`Theme`** -- Shared visual config for editor-rendered elements. Tool-owned controls keep their own local style constants.

## How it works

### Construction and wiring

Workspace constructs `Editor` with the public `Font` model and its matching private `FontStore`. Editor creates its own `ShiftStore<ShiftEditorRecord>`, then wires managers and reactive effects. The rendering effects each read a specific set of signals and schedule the matching canvas layer for redraw. A cursor effect reads tool/hover state and updates the CSS cursor.

### Coordinate pipeline

```
Screen (canvas pixels, Y-down)
  -> Camera.projectScreenToScene() [affine matrix inverse]
Scene (UPM space, Y-up, viewport-relative)
  -> node-local transform for the hit scene node
Node-local (origin defined by the placed node)
```

Tools receive screen and scene coordinates from the pointer pipeline. Scene/node hit testing resolves any node-local coordinates needed by glyph editing tools.

`Camera` computes the UPM-to-screen matrix as: baseline positioning + Y-flip + scale, composed with pan + zoom. The inverse is lazily computed. Both are `ComputedSignal<Mat>` so any dependent computed/effect auto-invalidates.

### Four canvas layers

| Layer      | Technology   | Content                                                     | Redraw trigger                     |
| ---------- | ------------ | ----------------------------------------------------------- | ---------------------------------- |
| background | Canvas 2D    | Guides, tool backgrounds                                    | `#staticEffect`                    |
| scene      | Canvas 2D    | Glyph outline, segments, handles (CPU), anchors, tool scene | `#staticEffect`                    |
| handles    | WebGL (regl) | GPU-rendered point handles                                  | `#staticEffect` (via scene render) |
| overlay    | Canvas 2D    | Bounding box handles, tool overlays                         | `#overlayEffect`                   |

Background, scene, and overlays are drawn in UPM space (`Canvas.withGlyphSpace()` applies the affine transform). Tool-owned controls convert pixel-sized handles and strokes at draw time.

### Rendering pipeline

`Renderer.#renderScene()` draws `SceneLayer`, which:

1. Draws glyph outline (and fill in preview mode)
2. Draws hovered/selected segments
3. Draws debug overlays if enabled
4. Delegates to `ToolManager.drawScene()`
5. Draws control lines with frustum culling via `Camera.visibleSceneBounds()`
6. Attempts GPU marker rendering; falls back to CPU if unavailable
7. Draws anchors

### Zoom-to-cursor

`Camera.zoomToPoint()` records UPM at cursor before zoom, applies new zoom, re-projects, and adjusts pan to compensate for drift. Because matrices are computed signals, the second projection automatically uses the updated zoom.

### Draft pattern (continuous manipulation)

`Editor.beginGlyphLayerEditDraft(subject)` captures base point/anchor positions from the active `GlyphLayer`. During drag, `draft.preview*()` applies positions to the reactive glyph layer only. On commit, it accepts the final sparse patch through `GlyphLayer.applyPositionPatch()` as one pending workspace edit. On discard, it restores the frozen base positions as a preview.

### Hit testing

Glyph geometry exposes domain hit queries for points, anchors, and segments. Tool-specific surfaces compose those queries with their own controls; for example, the select tool owns bounding-box hit testing and rendering through `SelectBoundingBox`.

## Workflow recipes

### Add a new signal that triggers scene redraw

1. Declare a `WritableSignal<T>` field on `Editor`.
2. Initialize it in the constructor.
3. Read the signal in `#staticEffect` (just reference `.value`).
4. The `FrameHandler` coalesces the redraw automatically.

### Add a new rendering indicator

1. Create a class under `rendering/overlays/` with a `draw(canvas: Canvas, ...)` method.
2. Instantiate it as a field on `Editor` (e.g. `#myIndicator = new MyIndicator()`).
3. Call `#myIndicator.draw(canvas, ...)` from the appropriate canvas item layer or tool draw hook.
4. If it depends on new state, read that state in the appropriate effect.

### Add a new selectable entity kind

1. Define or import its branded identity and guard.
2. Add the identity to `ShiftId` and `SelectableId` in the object type boundary.
3. Resolve it in `Editor.object()` and provide live object bounds.
4. Add editor tests for lookup, selection bounds, and invalidation after edits.

## Gotchas

- **Forgetting to read a signal in an effect** -- The canvas will not redraw when that state changes. Each effect must explicitly read `.value` of every signal it depends on.
- **Caching `CameraTransform` across frames** -- `getCameraTransform()` returns a snapshot object. It is correct for one frame but stale after zoom/pan changes. Rendering code gets a fresh one via `Renderer.#getCanvas()`.
- **Draft lifecycle** -- A `GlyphLayerEditDraft` must be committed or discarded. Calling `commit()` twice is safe (no-op), but forgetting both leaks the preview state.
- **Hover mutual exclusion** -- `Hover` stores one glyph-domain target at a time. Tool-specific hover state should stay with the owning tool.
- **Marker fallback** -- `Handles.draw()` tries the accelerated marker layer first. If WebGL is unavailable, it falls back to CPU canvas drawing internally.
- **Node-local coordinates** -- Derived after hit testing identifies the scene node being acted on. Do not add editor-global glyph-local coordinates back to tool events.

## Verification

- `npx vitest run apps/desktop/src/renderer/src/lib/editor/` -- unit tests for managers, hit testing, sidebearings, lifecycle, drafts.
- `npx vitest run --testPathPattern="draft"` -- draft-specific tests.
- `pnpm test:desktop src/renderer/src/lib/editor/managers/Camera.test.ts` -- camera manager tests.
- Manual: open a font, zoom/pan, select points, drag, toggle preview mode, verify GPU/CPU handle rendering toggle.

## Related

- `Font` -- Font metadata, source and metric APIs, mutation boundaries, and asynchronous Glyph acquisition.
- `WorkspaceEditCoordinator` -- undo/redo boundary for layer mutations and explicit editor transactions.
- `ToolManager` -- Tool lifecycle and dispatch; `Editor.#toolManager`. Tools receive `Editor` to access all subsystems.
- `Clipboard` -- Copy/cut/paste via `Editor.#clipboard`.
- `Font` -- Font model access; `Editor.font` for metrics, glyph names, composites.
- `Selection` -- `Editor.selection` (public). Point/anchor/segment selection with computed contour queries.
- `Mat` (from `@shift/geo`) -- 2D affine matrix used by `Camera` for coordinate transforms.
- `Segment` (from `@shift/glyph-state`) -- Segment iteration and hit testing used by `Editor.getSegmentAt()`.
- `MarkerLayer` (from `graphics/backends`) -- WebGL context for GPU marker rendering.
