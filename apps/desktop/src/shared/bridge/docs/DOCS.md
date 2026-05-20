# Shared Bridge

Shared TypeScript declaration point for the preload-to-renderer bridge contract.

## Architecture Invariants

- **Architecture Invariant:** `BridgeApi` comes from `@shift/bridge`, which re-exports the generated `@shift/types` DTO API. **WHY:** app code does not depend on the raw NAPI package declaration.
- **Architecture Invariant:** `Window.shiftBridge` is declared here. **WHY:** preload and renderer agree on one global native bridge name.
- **Architecture Invariant:** This shared module is type-only. **WHY:** runtime native loading belongs in `@shift/bridge` and preload wiring belongs in `preload.ts`.

## Codemap

```
shared/bridge/
  BridgeApi.ts -- re-exports bridge types and declares Window.shiftBridge

preload/
  preload.ts -- exposes BridgeApi as window.shiftBridge
```

## Key Types

- `BridgeApi` -- complete native bridge API surface.
- `GlyphHandle` -- bridge glyph session handle.
- `Window.shiftBridge` -- optional global bridge exposed by preload.

## Data Flow

```
shift-bridge       raw napi-rs package
  -> @shift/bridge createBridge()
    -> preload.ts buildContextBridgeApi()
      -> contextBridge.exposeInMainWorld("shiftBridge", ...)
        -> renderer/editor reactive wrapper
```

## Gotchas

- `BridgeApi` is a bridge DTO/API contract, not the editor domain model.
- Renderer code should adapt bridge DTOs into editor model state rather than leaking transport names through the app.
- If Rust declarations change, rebuild `shift-bridge` and run `pnpm generate:bridge-types`.

## Related

- `@shift/bridge` -- runtime bridge package.
- `@shift/types` -- generated bridge DTO/API types plus shared primitive DTO types.
- `preload.ts` -- producer of `window.shiftBridge`.
