# Editor

Central orchestrator for the canvas-based glyph editing surface, wiring viewport transforms, selection, rendering, hit testing, and tool management into a single facade.

## Architecture Invariants

**Architecture Invariant:** `Editor` is a facade -- it delegates viewport, hover, edge-pan, rendering, and tool dispatch to named subsystem objects. Tools receive `Editor` directly but must not reach into private managers.

**Architecture Invariant:** Pointer events still carry `screen`, `scene`, and active glyph-local coordinates for the current tool path. Placed scene item-local conversion is not global; it requires an `ItemId` through `Scene.toLocal()` / `Scene.toScene()`.

**Architecture Invariant:** `drawOffset` is derived render state. Text tools focus glyphs by `GlyphAnchor { runId, itemId }`; `Editor` resolves that anchor through `TextRuns` and `TextLayout.editOriginForItem()`. Tools must not set text-run edit placement coordinates directly.

**Architecture Invariant: CRITICAL:** `Camera` owns the affine matrices (`$upmToScreenMatrix`, `$screenToUpmMatrix`) as lazily computed signals. Anything that reads viewport-derived values inside a `computed` or `effect` will auto-track. Calling `setRect()`, changing zoom/pan, or changing UPM invalidates both matrices and triggers downstream redraws automatically. Never cache matrix results outside a signal.

**Architecture Invariant: CRITICAL:** Rendering is driven by named reactive effects owned by `Renderer`. Each effect reads explicit dependency signals before drawing. If editor state should trigger a redraw, add a named read to the correct render dependency boundary -- do not request redraw imperatively from tools or UI handlers.

**Architecture Invariant:** `FrameHandler` deduplicates `requestAnimationFrame` calls per canvas layer. Multiple signal changes within a single frame coalesce into one render. Canvas lifecycle changes, such as replacing a layer context after resize, are represented as renderer surface signals so redraw causes remain inspectable.

**Architecture Invariant:** `GlyphLayerEditDraft` is the only way to perform continuous layer previews (drags). Call `beginGlyphLayerEditDraft()` at drag start, `preview*()` on each move, and either `commit(label)` or `discard()` at drag end. Draft internally records a single undo command from frozen base positions. Calling `commit` twice is a no-op; forgetting to call `commit`/`discard` leaks the preview state.

**Architecture Invariant:** Lifecycle events (`EventEmitter`) are for one-shot imperative actions (`fontLoaded`, `fontSaved`, `destroying`). Continuous state changes use signals. Do not mix the two patterns.

**Architecture Invariant:** `Selection` uses discriminated `Selectable` unions (`{ kind: "point" | "anchor" | "segment", id }`). Mutations go through `select()`, `add()`, `remove()`, `toggle()`. Derived contour and bounds queries are computed from the single `$state` signal and the current glyph geometry.

**Architecture Invariant:** Glyph-domain hit testing belongs to glyph geometry and editor glyph lookup helpers. Tool-specific controls, such as select bounding-box handles, are owned and hit-tested by the tool that renders them.

**Architecture Invariant:** `Handles` tries the accelerated marker layer first and falls back to CPU canvas drawing if WebGL is unavailable. The marker-layer path packs all handle instances into a `Float32Array` for a single draw call.

## Codemap

```
editor/
  Editor.ts              -- Facade (~1750 lines), wires all subsystems
  lifecycle.ts           -- EventEmitter for fontLoaded/fontSaved/destroying
  sidebearings.ts        -- deriveGlyphSidebearings, roundSidebearing
  managers/
    Camera.ts   -- UPM<->screen affine matrices, zoom, pan
    EdgePanManager.ts    -- Auto-pan when dragging near canvas edges
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

- **`Editor`** -- Facade class (~1750 lines). Owns `Selection`, `Hover`, `Camera`, `EdgePanManager`, `Renderer` (renderer), `ToolManager`, `CommandHistory`, `Clipboard`, `EventEmitter`. Passed directly to tools.
- **`Camera`** -- Owns zoom/pan/UPM signals, computed affine matrices (`Mat`), and all coordinate projection methods (`projectScreenToScene`, `projectSceneToScreen`, `screenToUpmDistance`).
- **`Renderer`** -- Manages four stacked canvas layers (background, scene, markers/WebGL, overlay), their `FrameHandler` instances, and the canvas item layers that draw each pass.
- **`Canvas`** -- Thin wrapper around `CanvasRenderingContext2D` with `pxToUpm()` conversion and themed drawing primitives. Carries `CameraTransform` and `Theme`.
- **`CameraTransform`** -- Value object: `{ zoom, panX, panY, centre, upmScale, logicalHeight, layoutHeight, padding, descender }`. Snapshot of viewport state passed to rendering code.
- **`Selection`** -- Unified selection state for points, anchors, and segments. Computed `DerivedSelection` tracks selected contours and bounds. Exposes one raw `$state` signal plus unwrapped ID getters.
- **`Selectable`** -- Discriminated union: `{ kind: "point" | "anchor" | "segment", id }`.
- **`Coordinates`** -- Triple of `{ screen, scene, glyphLocal }` for a single position. Built via `Editor.fromScreen()` etc.
- **`GlyphLayerEditDraft`** -- Transactional interface for continuous layer manipulation: `previewPositionPatch()` / `previewTranslate()` / `previewRotate()` / `previewScale()` during drag, `commit(label)` or `discard()` at end.
- **`Hover`** -- Tracks the currently hovered glyph-domain entity (point/anchor/segment). Tool-specific controls such as select bounding boxes stay with the owning tool.
- **`Handles`** -- Handle renderer that tries the accelerated marker layer and falls back to CPU drawing internally.
- **`FrameHandler`** -- Deduplicates `requestAnimationFrame` per render target. Only the latest callback fires.
- **`EdgePanManager`** -- During drags, auto-pans when the cursor is within 50px of canvas edges, using velocity proportional to distance from edge.
- **`EventEmitter`** -- Typed emitter for `LifecycleEventMap` (`fontLoaded`, `fontSaved`, `destroying`).
- **`Theme`** -- Shared visual config for editor-rendered elements. Tool-owned controls keep their own local style constants.

## How it works

### Construction and wiring

`new Editor({ bridge })` creates all managers and wires reactive effects. The four rendering effects each read a specific set of signals and schedule the matching canvas layer for redraw. A cursor effect reads tool/hover state and updates the CSS cursor.

### Coordinate pipeline

```
Screen (canvas pixels, Y-down)
  -> Camera.projectScreenToScene() [affine matrix inverse]
Scene (UPM space, Y-up, viewport-relative)
  -> Scene.toLocal(itemId, scenePoint) [subtract that item's placement origin]
Item-local (origin defined by the placed scene item)
```

Existing tools still receive `coords.glyphLocal` for the active glyph path. New scene-aware code should not treat that coordinate as global; use `Scene.toLocal(itemId, scenePoint)` after hit testing identifies the item.

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

`Editor.beginGlyphLayerEditDraft(subject)` captures base point/anchor positions from the active `GlyphLayer`. During drag, `draft.preview*()` applies positions to the reactive glyph layer only. On commit, it syncs the final sparse patch through `GlyphLayer.commitPositionPatch()` and records a single `ApplyPositionPatchCommand`. On discard, it restores the frozen base positions as a preview.

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

1. Extend the `Selectable` discriminated union.
2. Add a `WritableSignal<ReadonlySet<NewId>>` to `Selection`.
3. Update `select()`, `add()`, `remove()`, `toggle()`, `isSelected()`, `clear()`, `isEmpty`.
4. Read the new signal in the appropriate rendering effect.

## Gotchas

- **Forgetting to read a signal in an effect** -- The canvas will not redraw when that state changes. Each effect must explicitly read `.value` of every signal it depends on.
- **Caching `CameraTransform` across frames** -- `getCameraTransform()` returns a snapshot object. It is correct for one frame but stale after zoom/pan changes. Rendering code gets a fresh one via `Renderer.#getCanvas()`.
- **Draft lifecycle** -- A `GlyphLayerEditDraft` must be committed or discarded. Calling `commit()` twice is safe (no-op), but forgetting both leaks the preview state.
- **Hover mutual exclusion** -- `Hover` stores one glyph-domain target at a time. Tool-specific hover state should stay with the owning tool.
- **Marker fallback** -- `Handles.draw()` tries the accelerated marker layer first. If WebGL is unavailable, it falls back to CPU canvas drawing internally.
- **Item-local coordinates** -- `glyphLocal` is transitional active-glyph state. Scene item-local conversion requires an `ItemId` through `Scene.toLocal()` / `Scene.toScene()`.

## Verification

- `npx vitest run apps/desktop/src/renderer/src/lib/editor/` -- unit tests for managers, hit testing, sidebearings, lifecycle, drafts.
- `npx vitest run --testPathPattern="draft"` -- draft-specific tests.
- `npx vitest run --testPathPattern="EdgePanManager|Camera"` -- manager unit tests.
- Manual: open a font, zoom/pan, select points, drag, toggle preview mode, verify GPU/CPU handle rendering toggle.

## Related

- `Font` -- State projection and glyph/layer lookup; `Editor` reads authored glyph layers through this boundary.
- `CommandHistory` -- Undo/redo stack; `Editor.#commandHistory` records all mutations.
- `ToolManager` -- Tool lifecycle and dispatch; `Editor.#toolManager`. Tools receive `Editor` to access all subsystems.
- `Clipboard` -- Copy/cut/paste via `Editor.#clipboard`.
- `Font` -- Font model access; `Editor.font` for metrics, glyph names, composites.
- `Selection` -- `Editor.selection` (public). Point/anchor/segment selection with computed contour queries.
- `Mat` (from `@shift/geo`) -- 2D affine matrix used by `Camera` for coordinate transforms.
- `Segment` (from `@shift/glyph-state`) -- Segment iteration and hit testing used by `Editor.getSegmentAt()`.
- `MarkerLayer` (from `graphics/backends`) -- WebGL context for GPU marker rendering.
