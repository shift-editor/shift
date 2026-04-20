# Shared Bridge

Type-safe API boundary between the Rust `FontEngine` (via NAPI) and the TypeScript renderer.

## Architecture Invariants

- **Architecture Invariant:** `FontEngineAPI` is derived as `Omit<FontEngine, "constructor">` -- it is never hand-maintained. When a `#[napi]` method is added in Rust and rebuilt, `FontEngineAPI` picks it up automatically.
- **Architecture Invariant:** The `Window.shiftFont` global declaration lives here, making this module the single source of truth for the bridge contract. Both the preload (producer) and renderer (consumer) import from this file.
- **Architecture Invariant: CRITICAL:** `buildBridgeAPI` in the preload reflects _all_ prototype methods of the `FontEngine` instance at runtime. If `FontEngineAPI` drifts from the actual `FontEngine` class (e.g., shift-node is not rebuilt), the TypeScript types will lie -- calls will fail at runtime with no compile-time warning.
- **Architecture Invariant:** `NodeRef` and `NodePositionUpdate` are re-exported aliases for `JsNodeRef` and `JsNodePositionUpdate` from shift-node. Renderer code should import these aliases, not the `Js`-prefixed originals.

## Codemap

```
shared/bridge/
  FontEngineAPI.ts   — derives FontEngineAPI from FontEngine, declares Window.shiftFont,
                        exports composite payload types and node-ref aliases

preload/
  preload.ts         — buildBridgeAPI reflects FontEngine onto window.shiftFont

renderer/src/bridge/
  native.ts          — getNative() accessor, caches window.shiftFont
  NativeBridge.ts    — high-level wrapper: reactive $glyph signal, dispatch/sync
```

## Key Types

- **`FontEngineAPI`** -- `Omit<FontEngine, "constructor">`. The complete method surface exposed to the renderer. Derived, not hand-written.
- **`NodeRef`** -- alias for `JsNodeRef`. Tagged union `{ kind: "point" | "anchor" | "guideline", id: string }`.
- **`NodePositionUpdate`** -- alias for `JsNodePositionUpdate`. `{ node: NodeRef, x: number, y: number }`.
- **`CompositeComponent`** / **`CompositeComponents`** -- shapes for composite glyph component data (component glyph name, source unicodes, contours).
- **`Window.shiftFont`** -- global declaration (`FontEngineAPI | undefined`) that both preload and renderer rely on.

## How it works

### Data flow: Rust to renderer

```
FontEngine (Rust, #[napi])
  → shift-node index.d.ts (generated class + interfaces)
    → FontEngineAPI.ts: Omit<FontEngine, "constructor">
      → preload.ts: buildBridgeAPI() reflects all methods onto a plain object
        → contextBridge.exposeInMainWorld("shiftFont", ...)
          → native.ts: getNative() reads window.shiftFont, caches it
            → NativeBridge wraps getNative() with reactive state + error handling
```

### Why `Omit` instead of `satisfies`

The old design hand-listed every method in a `FontEngineAPI` interface and used `satisfies` in the preload to catch missing implementations. The current design derives the type directly from `FontEngine` via `Omit<FontEngine, "constructor">`, and the preload uses `buildBridgeAPI` to reflect all prototype methods at runtime. This means:

1. Zero maintenance when Rust methods change -- no interface to update.
2. No compile-time check that individual methods exist in the preload, because `buildBridgeAPI` copies them all by reflection.
3. The trade-off: correctness now depends on shift-node being rebuilt. If the `.d.ts` is stale, types and runtime diverge silently.

### `buildBridgeAPI` (preload)

Generic function that walks `Object.getPrototypeOf(instance)`, skips `constructor`, and wraps each method in a forwarding closure. Returns the result typed as `T` (which is `FontEngineAPI`). This creates the plain object that `contextBridge.exposeInMainWorld` requires (Electron strips prototype chains across the context boundary).

### `NativeBridge` (renderer)

The high-level consumer. Holds a `#raw: FontEngineAPI` (from `getNative()`) and a reactive `$glyph` signal. Mutations go through `#dispatch` / `#dispatchVoid`, which call the native method, parse the JSON command response, and sync the reactive glyph model. Position-only updates use `setPositions` with `Float64Array` for zero-copy performance.

## Workflow recipes

### Add a new Rust function to the bridge

1. Add `#[napi]` method to `FontEngine` in shift-node.
2. Run `pnpm dev` (turbo rebuilds native, regenerates `index.d.ts`).
3. Done -- `FontEngineAPI` picks up the new method automatically via `Omit<FontEngine, "constructor">`.
4. Use the method through `getNative().myNewMethod(...)` or wrap it in `NativeBridge`.

### Add a renderer-only type to the bridge module

1. Add the type/interface to `FontEngineAPI.ts`.
2. Import from `@shared/bridge/FontEngineAPI` in renderer code.

### Access native engine from renderer code

```typescript
import { getNative } from "@/bridge/native";
const native = getNative(); // throws if window.shiftFont is missing
native.loadFont(path);
```

Or use `NativeBridge` for reactive glyph state.

## Gotchas

- **Stale native build**: If shift-node is not rebuilt after Rust changes, `FontEngineAPI` will match the old `.d.ts` while the actual NAPI binary has new/changed methods. `pnpm dev` handles this via turbo dependency ordering, but manual workflows can miss it.
- **contextBridge strips prototypes**: Electron's `contextBridge` serializes objects across the context boundary. `buildBridgeAPI` exists specifically to flatten methods onto a plain object. Never try to expose the `FontEngine` instance directly.
- **JSON serialization boundary**: Most native methods return JSON strings. `NativeBridge` parses them (`JSON.parse`), but `FontEngineAPI` types show `string` return types, not the parsed shapes. The parsed types (`GlyphSnapshot`, `FontMetrics`, etc.) live in `@shift/types`.
- **`setPositions` null guards**: napi-rs panics on zero-length `Float64Array`. `NativeBridge.#syncPositions` passes `null` instead of empty arrays.

## Verification

- `pnpm typecheck` -- confirms `FontEngineAPI` still matches the generated `FontEngine` class.
- `pnpm dev` -- turbo rebuilds native before starting the dev server, ensuring types and binary are in sync.

## Related

- **`FontEngine`** (shift-node) -- the NAPI class whose type `FontEngineAPI` derives from.
- **`buildBridgeAPI`** (preload) -- reflects the engine instance for contextBridge.
- **`getNative`** (renderer bridge) -- cached accessor for `window.shiftFont`.
- **`NativeBridge`** (renderer bridge) -- reactive wrapper with `$glyph` signal, dispatch/sync logic.
- **`@shift/types`** -- domain types (`GlyphSnapshot`, `FontMetrics`, `RenderContourSnapshot`) that native JSON responses are parsed into.
