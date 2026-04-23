# Editor

Central orchestrator for the canvas-based glyph editing surface, wiring viewport transforms, selection, rendering, snapping, hit testing, and tool management into a single facade.

## Architecture Invariants

**Architecture Invariant:** `Editor` is a facade -- it delegates to managers (`ViewportManager`, `HoverManager`, `EdgePanManager`, `SnapManager`) and a renderer (`Viewport`). Tools receive `Editor` directly but must not reach into private managers.

**Architecture Invariant:** Three coordinate spaces flow through every interaction: `screen` (canvas pixels, Y-down), `scene` (UPM with viewport transform applied), and `glyphLocal` (scene minus draw offset). All three are bundled in the `Coordinates` type; build one via `Editor.fromScreen()` / `fromScene()` / `fromGlyphLocal()` -- never compute one space from another manually.

**Architecture Invariant: CRITICAL:** `ViewportManager` owns the affine matrices (`$upmToScreenMatrix`, `$screenToUpmMatrix`) as lazily computed signals. Anything that reads viewport-derived values inside a `computed` or `effect` will auto-track. Calling `setRect()`, changing zoom/pan, or changing UPM invalidates both matrices and triggers downstream redraws automatically. Never cache matrix results outside a signal.

**Architecture Invariant: CRITICAL:** Rendering is driven by four reactive effects (`#staticEffect`, `#overlayEffect`, `#interactiveEffect`, `#cursorEffect`). Each effect reads the specific signals it depends on, then calls the corresponding `Viewport.request*Redraw()`. If you add new editor state that should trigger a redraw, you must read that signal inside the correct effect -- otherwise the canvas will not update.

**Architecture Invariant:** `FrameHandler` deduplicates `requestAnimationFrame` calls per canvas layer. Multiple signal changes within a single frame coalesce into one render. Never call rendering functions directly; always go through `requestRedraw()` / `requestSceneRedraw()` / `requestOverlayRedraw()`.

**Architecture Invariant:** `GlyphDraft` is the only way to perform continuous point manipulations (drags). Call `createDraft()` at drag start, `setPositions()` on each move, and either `finish(label)` or `discard()` at drag end. Draft internally records a single undo command from the base snapshot. Calling `finish` twice is a no-op; forgetting to call `finish`/`discard` leaks the draft.

**Architecture Invariant:** Lifecycle events (`EventEmitter`) are for one-shot imperative actions (`fontLoaded`, `fontSaved`, `destroying`). Continuous state changes use signals. Do not mix the two patterns.

**Architecture Invariant:** `Selection` uses discriminated `Selectable` unions (`{ kind: "point" | "anchor" | "segment", id }`). Mutations go through `select()`, `add()`, `remove()`, `toggle()`. Derived contour queries (`contourIds`, `fullySelectedContourIds`) are computed signals rebuilt when selection or glyph changes.

**Architecture Invariant:** Hit testing follows strict priority: contour endpoint > middle point > anchor > any point > segment. This order is hardcoded in `Editor.hitTest()`. Bounding box handle hits are checked separately (before hit test) in `updateHover()` only when multi-selected.

**Architecture Invariant:** `Handles` uses GPU-first rendering via `ReglHandleContext`. It falls back to CPU canvas drawing if WebGL is unavailable or `gpuHandlesEnabled` is false. The GPU path packs all handle instances into a `Float32Array` for a single draw call.

## Codemap

```
editor/
  Editor.ts              -- Facade (~1750 lines), wires all subsystems
  lifecycle.ts           -- EventEmitter for fontLoaded/fontSaved/destroying
  sidebearings.ts        -- deriveGlyphSidebearings, roundSidebearing
  managers/
    ViewportManager.ts   -- UPM<->screen affine matrices, zoom, pan
    HoverManager.ts      -- Hover state (point/anchor/segment/bounding box)
    EdgePanManager.ts    -- Auto-pan when dragging near canvas edges
    SnapManager.ts       -- Creates DragSnapSession / RotateSnapSession
  rendering/
    Viewport.ts          -- Canvas layer orchestration and RAF scheduling
    Canvas.ts            -- 2D drawing API wrapping CanvasRenderingContext2D
    Handles.ts           -- GPU-first handle rendering with CPU fallback
    FrameHandler.ts      -- RAF deduplication per render target
    FpsMonitor.ts        -- Rolling-window FPS measurement
    Theme.ts             -- DEFAULT_THEME, all visual constants
    constants.ts         -- SCREEN_HIT_RADIUS (8px)
    visibleSceneBounds.ts -- Frustum culling for off-screen elements
    gpu/                 -- WebGL handle shaders and instance packing
    indicators/          -- Guides, BoundingBox, ControlLines, Segments,
                            SnapLines, Anchors, DebugOverlays, handleDrawing
  hit/
    boundingBox.ts       -- hitTestBoundingBox, getHandlePositions
    composite.ts         -- Composite glyph hit testing
  snapping/
    SnapPipelineRunner.ts -- Ordered step pipeline for snap resolution
    steps.ts             -- pointToPoint, metrics, angle snap steps
    types.ts             -- DragSnapSession, RotateSnapSession, SnapIndicator
```

## Key Types

- **`Editor`** -- Facade class (~1750 lines). Owns `Selection`, `ViewportManager`, `HoverManager`, `SnapManager`, `EdgePanManager`, `Viewport` (renderer), `ToolManager`, `CommandHistory`, `Clipboard`, `EventEmitter`. Passed directly to tools.
- **`ViewportManager`** -- Owns zoom/pan/UPM signals, computed affine matrices (`Mat`), and all coordinate projection methods (`projectScreenToScene`, `projectSceneToScreen`, `screenToUpmDistance`).
- **`Viewport`** -- Manages four stacked canvas layers (background, scene, handles/WebGL, overlay) and their `FrameHandler` instances. Calls back into `Editor.renderToolBackground()` / `renderToolScene()` / `renderOverlay()`.
- **`Canvas`** -- Thin wrapper around `CanvasRenderingContext2D` with `pxToUpm()` conversion and themed drawing primitives. Carries `ViewportTransform` and `Theme`.
- **`ViewportTransform`** -- Value object: `{ zoom, panX, panY, centre, upmScale, logicalHeight, padding, descender }`. Snapshot of viewport state passed to rendering code.
- **`Selection`** -- Unified selection state for points, anchors, and segments. Computed `DerivedSelection` tracks which contours are (fully) selected. Exposes both raw signals (`$pointIds`) and unwrapped getters.
- **`Selectable`** -- Discriminated union: `{ kind: "point" | "anchor" | "segment", id }`.
- **`Coordinates`** -- Triple of `{ screen, scene, glyphLocal }` for a single position. Built via `Editor.fromScreen()` etc.
- **`GlyphDraft`** -- Transactional interface for continuous point manipulation: `setPositions()` during drag, `finish(label)` or `discard()` at end.
- **`HoverManager`** -- Tracks which entity (point/anchor/segment/bounding box handle) is hovered. `applyHoverResult()` sets the right signal and clears others. `getPointVisualState()` / `getSegmentVisualState()` return `VisualState` (`"idle" | "hovered" | "selected"`).
- **`SnapManager`** -- Stateless factory for `DragSnapSession` and `RotateSnapSession`. Sessions freeze snap targets at creation, then run `SnapPipelineRunner` on each mouse move.
- **`SnapPipelineRunner`** -- Executes ordered snap steps. Point pipeline: point-to-point wins immediately, otherwise closest result wins. Rotate pipeline: first match wins.
- **`Handles`** -- GPU-first handle rendering. Packs instances via `packHandleInstances()`, falls back to `drawCpu()`.
- **`FrameHandler`** -- Deduplicates `requestAnimationFrame` per render target. Only the latest callback fires.
- **`EdgePanManager`** -- During drags, auto-pans when the cursor is within 50px of canvas edges, using velocity proportional to distance from edge.
- **`EventEmitter`** -- Typed emitter for `LifecycleEventMap` (`fontLoaded`, `fontSaved`, `destroying`).
- **`Theme`** -- Full visual config: colors, sizes, line widths for guides, handles, selection, snapping, bounding box, debug overlays, text run.

## How it works

### Construction and wiring

`new Editor({ bridge })` creates all managers and wires reactive effects. The four rendering effects each read a specific set of signals and schedule the matching canvas layer for redraw. A cursor effect reads tool/hover state and updates the CSS cursor.

### Coordinate pipeline

```
Screen (canvas pixels, Y-down)
  -> ViewportManager.projectScreenToScene() [affine matrix inverse]
Scene (UPM space, Y-up, viewport-relative)
  -> Editor.sceneToGlyphLocal() [subtract drawOffset]
GlyphLocal (origin at glyph baseline-left)
```

`ViewportManager` computes the UPM-to-screen matrix as: baseline positioning + Y-flip + scale, composed with pan + zoom. The inverse is lazily computed. Both are `ComputedSignal<Mat>` so any dependent computed/effect auto-invalidates.

### Four canvas layers

| Layer      | Technology   | Content                                                     | Redraw trigger                     |
| ---------- | ------------ | ----------------------------------------------------------- | ---------------------------------- |
| background | Canvas 2D    | Guides, tool backgrounds                                    | `#staticEffect`                    |
| scene      | Canvas 2D    | Glyph outline, segments, handles (CPU), anchors, tool scene | `#staticEffect`                    |
| handles    | WebGL (regl) | GPU-rendered point handles                                  | `#staticEffect` (via scene render) |
| overlay    | Canvas 2D    | Bounding box handles, snap lines, tool overlays             | `#overlayEffect`                   |

Background and scene are drawn in UPM space (`Viewport.#beginUpmSpace()` applies the affine transform and draw offset). Overlay has a two-pass render: screen-space (bounding box handles) then UPM-space (snap lines, tool overlay).

### Rendering pipeline

`Viewport.#renderScene()` calls `Editor.renderToolScene(canvas)` which:

1. Draws glyph outline (and fill in preview mode)
2. Draws hovered/selected segments
3. Draws debug overlays if enabled
4. Delegates to `ToolManager.renderScene()`
5. Draws control lines with frustum culling via `getVisibleSceneBounds()`
6. Attempts GPU handle rendering; falls back to CPU if unavailable
7. Draws anchors

### Zoom-to-cursor

`ViewportManager.zoomToPoint()` records UPM at cursor before zoom, applies new zoom, re-projects, and adjusts pan to compensate for drift. Because matrices are computed signals, the second projection automatically uses the updated zoom.

### Snapping

`SnapManager.createDragSession()` freezes snap targets (other points, font metrics) at drag start. Each mouse move calls `session.snap(cursor, modifiers)` which runs `SnapPipelineRunner` through ordered steps (point-to-point, metrics, angle). Point-to-point short-circuits; otherwise closest wins. The session returns a `SnapIndicator` that Editor renders on the overlay layer.

### Draft pattern (continuous manipulation)

`Editor.createDraft()` captures a base `GlyphSnapshot`. During drag, `draft.setPositions(updates)` applies position deltas directly to the glyph model. On finish, it syncs with the bridge and records a single `SetNodePositionsCommand`. On discard, it restores the base snapshot.

### Hit testing

`Editor.hitTest(coords)` checks in priority order: contour endpoints (open contour first/last), middle points, anchors, any point, segments. Returns a discriminated `HitResult`. `Editor.updateHover(coords)` checks bounding box handles first (when multi-selected), then delegates to `hitTest()`.

## Workflow recipes

### Add a new signal that triggers scene redraw

1. Declare a `WritableSignal<T>` field on `Editor`.
2. Initialize it in the constructor.
3. Read the signal in `#staticEffect` (just reference `.value`).
4. The `FrameHandler` coalesces the redraw automatically.

### Add a new rendering indicator

1. Create a class under `rendering/indicators/` with a `draw(canvas: Canvas, ...)` method.
2. Instantiate it as a field on `Editor` (e.g. `#myIndicator = new MyIndicator()`).
3. Call `#myIndicator.draw(canvas, ...)` from `renderToolScene()` or `renderOverlay()`.
4. If it depends on new state, read that state in the appropriate effect.

### Add a new snap step

1. Create a function returning `PointSnapStep` in `snapping/steps.ts`.
2. Add it to the `steps` array in `SnapManager.createDragSession()`.
3. Pipeline ordering matters: point-to-point short-circuits, so place it correctly.

### Add a new selectable entity kind

1. Extend the `Selectable` discriminated union.
2. Add a `WritableSignal<ReadonlySet<NewId>>` to `Selection`.
3. Update `select()`, `add()`, `remove()`, `toggle()`, `isSelected()`, `clear()`, `isEmpty`.
4. Read the new signal in the appropriate rendering effect.

## Gotchas

- **Forgetting to read a signal in an effect** -- The canvas will not redraw when that state changes. Each effect must explicitly read `.value` of every signal it depends on.
- **Caching `ViewportTransform` across frames** -- `getViewportTransform()` returns a snapshot object. It is correct for one frame but stale after zoom/pan changes. Rendering code gets a fresh one via `Viewport.#getCanvas()`.
- **Snap indicator cleanup** -- Tools must call `setSnapIndicator(null)` when a drag ends or the tool deactivates, or a stale indicator remains on screen.
- **Draft lifecycle** -- A `GlyphDraft` must be finished or discarded. Calling `finish()` twice is safe (no-op), but forgetting both leaks the intermediate state.
- **Hover mutual exclusion** -- `HoverManager.setHoveredPoint()` clears hovered anchor and segment. `setHoveredAnchor()` clears point and segment. This prevents multiple hover highlights.
- **GPU handle fallback** -- `Handles.draw()` returns `false` if GPU rendering failed or was disabled. The caller must check the return value and fall back to `drawCpu()`.
- **Three-space coordinates** -- Never convert between screen/scene/glyphLocal manually. Always use `Editor.fromScreen()` / `fromScene()` / `fromGlyphLocal()` which guarantee all three are consistent.

## Verification

- `npx vitest run apps/desktop/src/renderer/src/lib/editor/` -- unit tests for managers, hit testing, sidebearings, lifecycle, drafts.
- `npx vitest run --testPathPattern="draft"` -- draft-specific tests.
- `npx vitest run --testPathPattern="EdgePanManager|HoverManager|ViewportManager|SnapManager"` -- manager unit tests.
- Manual: open a font, zoom/pan, select points, drag with snapping, toggle preview mode, verify GPU/CPU handle rendering toggle.

## Related

- `NativeBridge` -- State source; `Editor.#bridge` provides `$glyph`, snapshot sync, boolean ops.
- `CommandHistory` -- Undo/redo stack; `Editor.#commandHistory` records all mutations.
- `ToolManager` -- Tool lifecycle and dispatch; `Editor.#toolManager`. Tools receive `Editor` to access all subsystems.
- `Clipboard` -- Copy/cut/paste via `Editor.#clipboard`.
- `Font` -- Font model access; `Editor.font` for metrics, glyph names, composites.
- `Selection` -- `Editor.selection` (public). Point/anchor/segment selection with computed contour queries.
- `Mat` (from `@shift/geo`) -- 2D affine matrix used by `ViewportManager` for coordinate transforms.
- `Segment` (from `../geo/Segment`) -- Segment iteration and hit testing used by `Editor.getSegmentAt()`.
- `ReglHandleContext` (from `graphics/backends`) -- WebGL context for GPU handle rendering.
