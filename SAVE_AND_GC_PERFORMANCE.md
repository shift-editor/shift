# Save Font, GC, and Pointer/Hover Performance

Summary of profiling findings for **saveFont**, **custom_gc**, and **pointerover** bottlenecks so someone else can implement optimizations.

## What the traces show

### Trace 1: saveFont + custom_gc

Two dominant entries:

1. **custom_gc** – ~395 ms (40.4%), location `VM120 preload.js:12:13`
2. **saveFont** – ~393 ms (40.2%), deep sync call stack through preload → io → Editor → App

### saveFont call stack

```
saveFont (preload / fontEngineAPI)
  → saveFont (io.ts:33)           ← IOManager, calls native
    → saveFont (Editor.ts:559)
      → (anonymous) (App.tsx:23)  ← onMenuSaveFont callback
        → handler (preload.js:181) ← IPC handler
          → onMessage (renderer_init)
            → Function call
```

So: **File → Save** runs the whole save path **synchronously** on the renderer thread (App → Editor → FontEngine.io → preload bridge → Rust).

### custom_gc

There is **no** `custom_gc` in the app source. The name and `VM120 preload.js:12:13` point to:

- **V8 / runtime garbage collection** (often labeled “custom_gc” or similar in profilers), or
- Some other runtime/Electron behavior in the preload/renderer context.

Line 12 in `preload.ts` is the start of the `fontEngineAPI` object; the GC entry is likely **not** a direct call from our code but **GC running in that context**, often triggered by:

- Large or many allocations (e.g. during/after save), or
- General heap pressure in the same time window as save.

So the two ~40% costs can be **related**: save does heavy, allocation-heavy work → then (or overlapping) GC runs.

---

## Root cause: save path

### 1. Synchronous save on renderer thread

- **App.tsx** – `onMenuSaveFont` callback calls `editor.saveFont(savePath)` and only then `saveCompleted(savePath)`.
- **Editor** → **IOManager** → **preload** → **Rust** `save_font` run in one synchronous chain.
- The **entire** save (Rust clone + UFO write) blocks the **renderer** for ~393 ms, so the UI freezes.

### 2. What Rust `save_font` does (`crates/shift-node/src/font_engine.rs`)

- If there is an edit session:
  - `glyph.clone()`, `session.layer().clone()`, `font_with_edits = self.font.clone()`.
  - `font_with_edits.put_glyph(glyph_copy)` then `font_loader.write_font(&font_with_edits, &path)`.
- If no session: `font_loader.write_font(&self.font, &path)`.
- **FontLoader** (`crates/shift-core/src/font_loader.rs`) dispatches by extension; for **.ufo** it uses **UfoWriter.save()** (`crates/shift-backends/src/ufo/writer.rs`), which does synchronous **UFO serialization and disk I/O** (many files for one UFO).

So the ~393 ms is: **cloning Font (and glyph/layer)** + **UFO write (CPU + sync disk I/O)** on the same thread that invoked save from JS.

### 3. Allocations and GC

- Cloning `Font` and building UFO output in Rust (and any N-API / JS boundary traffic) can allocate a lot.
- When that work finishes, or under general pressure, **GC** runs in the JS/renderer context and shows up as **custom_gc** (~395 ms). So a large part of the “cost of save” may be **save work + GC** together.

---

## Recommended optimizations (for someone to pick up)

### 1. Run save off the renderer thread (main fix)

- **Goal:** Don’t block the UI for ~400 ms.
- **Options:**
  - **Electron main process:** Move the actual save (Rust `save_font`) to the **main** process. Renderer sends “save to path” via IPC; main loads font state (or receives serialized data), calls into native save, then notifies renderer. Renderer stays responsive.
  - **Worker / separate thread:** If the native module can be used from a worker or a dedicated Node thread, run `save_font` there and post a message when done; renderer only handles “save started” / “save completed” / “save failed”.
- **JS side:** Keep `editor.saveFont(savePath)` (or similar) but make it **async**: it should return a Promise that resolves when the save done (or reject on error). **App.tsx** already uses `async (savePath)` and `await saveCompleted(savePath)`; the missing piece is that the **actual** save should not run synchronously on the renderer.

**Relevant files:**

- `apps/desktop/src/renderer/src/app/App.tsx` (onMenuSaveFont)
- `apps/desktop/src/renderer/src/lib/editor/Editor.ts` (saveFont)
- `apps/desktop/src/renderer/src/engine/io.ts` (IOManager.saveFont)
- `apps/desktop/src/preload/preload.ts` (bridge + IPC)
- Main process: where “Save” is triggered and how to invoke native save from main (or another process).

### 2. Reduce allocation in the save path (Rust)

- **Goal:** Shrink peak memory and churn so GC is less heavy and less frequent.
- **Ideas:**
  - Avoid full `self.font.clone()` if possible (e.g. write from a reference, or clone only what changed).
  - Reuse buffers or streams in UFO write instead of allocating large temporary structures per glyph/layer.
  - Profile Rust with something like `cargo flamegraph` or `dhat` to see where time and allocations go in `write_font` / UfoWriter.

**Relevant files:**

- `crates/shift-node/src/font_engine.rs` (`save_font`: clones and `write_font`)
- `crates/shift-core/src/font_loader.rs` (write path)
- `crates/shift-backends/src/ufo/writer.rs` (UfoWriter.save)

### 3. Don’t block renderer on save (short-term)

- Until save is moved off the renderer thread, at least **don’t block the renderer**:
  - Use `setTimeout`/`queueMicrotask` or a **worker** to call the current sync save so the UI can update (e.g. show “Saving…”). Note: the long work will still run on the main thread until you move it to main process or a worker; this only defers when it runs.
  - Better: implement (1) so the long work never runs on the renderer.

### 4. custom_gc

- **No code named “custom_gc”**; treat it as **GC time** in the renderer/preload context.
- Reducing allocations (especially in the save path and in any large JS/Rust data exchange) should reduce GC frequency and duration.
- If needed, use the runtime’s memory/GC tools to confirm GC is triggered by save-related allocations.

---

## Files reference

| Area                  | Path                                                           |
| --------------------- | -------------------------------------------------------------- |
| Save menu handler     | `apps/desktop/src/renderer/src/app/App.tsx`                    |
| Editor.saveFont       | `apps/desktop/src/renderer/src/lib/editor/Editor.ts` (~559)    |
| IOManager.saveFont    | `apps/desktop/src/renderer/src/engine/io.ts` (33)              |
| Preload bridge        | `apps/desktop/src/preload/preload.ts` (saveFont ~21, IPC ~239) |
| Rust save_font        | `crates/shift-node/src/font_engine.rs` (52–74)                 |
| FontLoader.write_font | `crates/shift-core/src/font_loader.rs` (85–100)                |
| UFO write             | `crates/shift-backends/src/ufo/writer.rs`                      |

---

## Success criteria

- **Save no longer blocks the UI** for hundreds of ms (save runs off renderer thread or in background).
- **Time in “saveFont”** in the renderer profile drops to near zero for the actual I/O/serialization; any remaining time should be small (e.g. sending a message or updating “Saving…” state).
- **GC (custom_gc)** share of time decreases as a result of less allocation in the save path and/or moving heavy work out of the renderer process.

---

## Trace 2: Event pointerover (~120 ms, 12.3%)

A second trace shows **Event: pointerover** with **120.0 ms** total time (12.3%) and **27.2 ms** self time (2.8%). So pointer/hover handling is a notable cost alongside save.

### Likely flow

- **pointerover** / **pointermove** fire as the user moves the pointer over the canvas.
- **ToolManager.handlePointerMove** → **GestureDetector.pointerMove** → **dispatchEvents** → active tool **handleEvent({ type: "pointerMove", point })**.
- Select tool **HoverBehavior** (or Pen **HoverBehavior**) returns new state with intent **setHoveredPoint** / **setHoveredSegment** / **clearHover**.
- **onTransition** runs → **executeIntent** → **editor.hover.setHoveredPoint** / **setHoveredSegment** / **clearHover**, or **editor.hitTest.updateHover(pos)**.
- **Editor.updateHover(pos)** does **getPointAt(pos)** then **getSegmentAt(pos)** (both iterate contours/points), then sets hover signals.
- Hover is part of **$renderState** → effect runs → **requestRedraw()**.
- **BaseTool.handleEvent** also calls **editor.render.requestRedraw()** whenever **state** changes (including hover state).

So every pointer move that **changes** hover does: hit test (point + segment over full glyph) → set signals → effect → requestRedraw, and every state change triggers another requestRedraw. Over many pointer events in one trace, that can add up to ~120 ms.

### Recommended optimizations (pointerover)

1. **Throttle or coalesce hover updates**
   Don’t run full hit test + signal update + redraw on every pointer move. Options:
   - **Throttle by time** (e.g. 16–32 ms) so hover updates at most once per frame.
   - **Coalesce**: only update hover when the result actually changes (same point/segment/clear as before → skip set + redraw).

2. **Avoid redraw when only hover changed**
   If the only change is hover state (no geometry change), consider:
   - A lighter redraw path that only repaints hover overlays, or
   - Batching hover-driven redraws with RAF so multiple pointer moves in one frame produce one redraw.

3. **Optimize hit test**
   **getPointAt** / **getSegmentAt** may be O(points) or O(segments). If the glyph is large, consider spatial indexing (e.g. quadtree or simple grid) so hover hit test is sublinear.

4. **Skip work when pointer hasn’t moved much**
   Ignore or throttle very small pointer deltas so hover doesn’t recompute on tiny jitter.

### Files reference (pointerover / hover)

| Area                                     | Path                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Pointer move dispatch                    | `apps/desktop/src/renderer/src/lib/tools/core/ToolManager.ts` (handlePointerMove)                 |
| Gesture → events                         | `apps/desktop/src/renderer/src/lib/tools/core/GestureDetector.ts` (pointerMove)                   |
| Select hover behavior                    | `apps/desktop/src/renderer/src/lib/tools/select/behaviors/HoverBehavior.ts`                       |
| Pen hover                                | `apps/desktop/src/renderer/src/lib/tools/pen/behaviors/HoverBehavior.ts`                          |
| Editor.updateHover                       | `apps/desktop/src/renderer/src/lib/editor/Editor.ts` (~829)                                       |
| Hit test (getPointAt, getSegmentAt)      | Editor / HitTestService                                                                           |
| Hover state + redraw                     | `apps/desktop/src/renderer/src/lib/editor/managers/HoverManager.ts`, Editor `$renderState` effect |
| BaseTool (requestRedraw on state change) | `apps/desktop/src/renderer/src/lib/tools/core/BaseTool.ts` (~53)                                  |

### Success criteria (pointerover)

- **Total time under “Event: pointerover”** (and related pointer/hover handling) drops after throttling/coalescing and/or lighter redraws.
- Moving the pointer over the canvas feels smooth; no visible jank from hover updates.
