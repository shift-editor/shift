# Graphics

GPU-accelerated rendering backend for editor handle drawing, with SDF-based shape rendering via WebGL (REGL).

## Architecture Invariants

- **Architecture Invariant:** `ReglHandleContext` owns the WebGL lifecycle for a single canvas. It is created once by `CanvasContextProvider` and destroyed on unmount. Never instantiate a second context for the same canvas.

- **Architecture Invariant:** **CRITICAL**: The instance buffer layout (attribute offsets in the draw command) must exactly match the packing order in `writeInstance` inside `packHandleInstances`. If either side changes stride/offset, handles render garbage with no error.

- **Architecture Invariant:** **CRITICAL**: `GPU_HANDLE_INSTANCE_FLOATS` (currently 25) defines both the Float32Array packing stride in `packHandleInstances` and the byte stride in REGL attribute bindings (`stride = GPU_HANDLE_INSTANCE_FLOATS * 4`). Changing this constant requires updating both sides simultaneously.

- **Architecture Invariant:** The REGL extensions `ANGLE_instanced_arrays` and `OES_standard_derivatives` must be available. Initialization catches failures and sets `#available = false`, making `Handles` fall back to CPU drawing silently.

- **Architecture Invariant:** Shape IDs in `SHAPE_IDS` must match the `v_shape` branch order in the fragment shader. Adding a new shape requires a new SDF branch in `handle.frag.glsl`, a new entry in `SHAPE_IDS`, and a new style builder in `handleStyles`.

## Codemap

```
graphics/
  backends/
    ReglHandleContext.ts   — WebGL context: REGL init, instance buffer management, draw command
```

Supporting files live in the editor rendering module:

```
editor/rendering/gpu/
  types.ts                 — GpuHandleFrame, GpuHandleInstance, GPU_HANDLE_INSTANCE_FLOATS
  classifyHandles.ts       — packHandleInstances: glyph points -> packed Float32Array
  handleStyles.ts          — CachedInstanceStyle, STYLES lookup table, SHAPE_IDS
  color.ts                 — parseCssColor: CSS color string -> GpuColor [r,g,b,a] floats
  shaders/
    handle.vert.glsl.ts    — vertex shader: scene-to-clip transform with rotation
    handle.frag.glsl.ts    — fragment shader: SDF shape dispatch (box, circle, triangle, segment)
    sdf.glsl.ts            — SDF primitives: sdCircle, sdBox, sdTriangle, sdSegment + coverage
```

## Key Types

- `ReglHandleContext` -- WebGL context wrapper. Manages REGL instance, instance buffer, and draw command. Provides `resizeCanvas`, `draw`, `clear`, `destroy`, and `isAvailable`.

- `GpuHandleFrame` -- per-frame draw data: packed `Float32Array` of instances, `instanceCount`, `ViewportTransform`, `drawOffset`, and logical canvas dimensions.

- `GpuHandleInstance` -- logical representation of one handle (position, shape, rotation, size, colors). Not used at runtime; `packHandleInstances` writes fields directly into a `Float32Array`.

- `CachedInstanceStyle` -- pre-computed GPU-ready style for a shape+state combination (shapeId, size, lineWidth, colors as `GpuColor`, extent). Built once at module load by `buildStyleByState`.

- `STYLES` -- static lookup: `STYLES[shape][state]` yields a `CachedInstanceStyle`. Shapes: corner, smooth, control, direction, first, last. States: idle, hovered, selected.

- `SHAPE_IDS` -- maps `GpuHandleShape` names to integer IDs consumed by the fragment shader's `v_shape` branching.

## How it works

### Initialization

`CanvasContextProvider` creates a `ReglHandleContext` and passes it to `Editor.setGpuHandleContext`, which forwards it to both `Viewport` and `Handles`. REGL is initialized lazily on the first `resizeCanvas` call. If WebGL init fails (missing extensions, context lost), `#available` stays `false` and `Handles.draw` returns `false`, triggering the CPU fallback path (`Handles.drawCpu`).

### Per-frame draw pipeline

1. `Handles.draw` is called with glyph data, handle states, viewport, and draw offset.
2. `packHandleInstances` iterates glyph contours, culls points outside visible bounds (with 64px margin), classifies each point (corner/smooth/control/direction/first/last + idle/hovered/selected), looks up `STYLES[shape][state]`, and writes 25 floats per visible point into a reusable `Float32Array`.
3. `ReglHandleContext.draw` receives the `GpuHandleFrame`. If the packed array exceeds `#instanceCapacity`, it reallocates the REGL buffer; otherwise it uses `subdata` for a zero-alloc update.
4. The REGL draw command runs instanced rendering: 6 vertices (unit quad) per instance. The vertex shader transforms each handle from scene coordinates to clip space, applying viewport pan/zoom/scale. The fragment shader dispatches on `v_shape` to the appropriate SDF (box for corner, circle for smooth/control, triangle for direction/first, segment for last), computes fill/stroke coverage with anti-aliasing via `fwidth`, and composites an optional overlay color.

### Buffer growth strategy

The instance buffer only grows, never shrinks. When `packedInstances.length > #instanceCapacity`, the entire buffer is replaced. Otherwise, `subdata` overwrites in place. This avoids per-frame allocation for stable glyph sizes.

## Workflow recipes

### Adding a new handle shape

1. Add the shape name to `GpuHandleShape` union in `types.ts`.
2. Add its integer ID to `SHAPE_IDS` in `handleStyles.ts`.
3. Add a theme entry in `Theme` and a style builder function in `handleStyles.ts`.
4. Add the entry to the `STYLES` object.
5. Add a new `else if (v_shape < N.5)` branch in `handle.frag.glsl.ts` with the SDF.
6. Add classification logic in `classifyPoint` inside `classifyHandles.ts`.
7. If the shape needs new SDF primitives, add them to `sdf.glsl.ts`.

### Changing handle colors or sizes

Modify the theme values in `Theme`. `handleStyles.ts` reads from `DEFAULT_THEME` at module load, so changes take effect on next app start (or HMR reload). No shader changes needed.

### Debugging GPU rendering issues

Set a breakpoint or add logging in `ReglHandleContext.draw`. Check `isAvailable()` returns `true`. If handles render as garbage, verify `GPU_HANDLE_INSTANCE_FLOATS` matches the attribute offset layout in `#initialize`. Compare `SHAPE_IDS` values against the `v_shape` branch thresholds in the fragment shader.

## Gotchas

- **Silent CPU fallback**: If WebGL init fails, `Handles` silently falls back to Canvas 2D drawing. There is only a `console.warn` in `ReglHandleContext.#initialize`. Check the browser console if GPU handles are not rendering.

- **Styles are module-level constants**: `STYLES` is built once from `DEFAULT_THEME` when `handleStyles.ts` loads. Runtime theme changes will not update GPU handle styles without a module reload.

- **Instance buffer never shrinks**: If a glyph temporarily has many points (e.g., during a paste), the GPU buffer stays at peak size until the context is destroyed.

- **Shape ID float comparison**: The fragment shader uses `v_shape < N.5` thresholds to branch on shape type. Shape IDs must be sequential integers starting at 0. Gaps or reordering will route to the wrong SDF.

- **No depth buffer**: REGL is initialized with `depth: false`. Handle draw order is determined by instance order in the packed array (contour iteration order). Overlapping handles composite via alpha blending.

## Verification

- No dedicated tests exist for `ReglHandleContext`. Verify GPU handles visually: open a glyph with mixed point types (corner, smooth, off-curve), hover and select points, confirm correct shapes and state colors.
- Check CPU fallback: in `ReglHandleContext.#initialize`, temporarily throw before `this.#available = true`. Handles should still render via Canvas 2D.
- After shader changes, test on both high-DPI and 1x displays -- the `fwidth`-based AA is sensitive to pixel ratio.

## Related

- `Handles` -- orchestrates GPU vs CPU handle drawing; calls `ReglHandleContext.draw`
- `Viewport` -- owns `ReglHandleContext` lifetime; calls `resizeCanvas` on resize
- `Editor` -- receives context from `CanvasContextProvider`, wires it to `Handles` and `Viewport`
- `CanvasContextProvider` -- React context that instantiates `ReglHandleContext` and all 2D canvas contexts
- `packHandleInstances` -- packs glyph point data into the Float32Array consumed by `draw`
- `DEFAULT_THEME` -- theme object whose handle styles feed into `STYLES` at load time
