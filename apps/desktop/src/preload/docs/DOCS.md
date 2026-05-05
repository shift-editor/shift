# Preload

Electron preload script that exposes the native Rust bridge and typed IPC channels to the renderer through `contextBridge`.

## Architecture Invariants

- **Architecture Invariant:** The native bridge is created through `@shift/bridge`, not by importing the raw `shift-bridge` NAPI package here. **WHY:** native loading and native-module typing stay in one package boundary.
- **Architecture Invariant:** `buildContextBridgeApi` flattens prototype methods into a plain object before exposing them. **WHY:** `contextBridge` does not preserve class prototype semantics across the isolated context boundary.
- **Architecture Invariant:** Two separate globals are exposed: `window.shiftBridge` for Rust bridge calls and `window.electronAPI` for IPC/system access. **WHY:** native bridge calls and Electron IPC have different lifecycles and failure modes.
- **Architecture Invariant:** The `electronAPI` object must satisfy the `ElectronAPI` interface exactly. **WHY:** adding IPC channels should fail at typecheck time unless preload wiring is updated.

## Codemap

```
preload/
  preload.ts -- creates BridgeApi, flattens it for contextBridge, wires IPC globals
```

## Key Types

- `BridgeApi` -- native bridge API generated from Rust declarations and exposed by `@shift/bridge`.
- `ElectronAPI` -- typed interface for IPC commands, event listeners, system utilities, and clipboard access.
- `IpcEvents` -- main-to-renderer broadcast channel map.
- `IpcCommands` -- renderer-to-main request/response channel map.

## How It Works

The preload runs once before the renderer loads:

1. Calls `createBridge()` from `@shift/bridge`.
2. Converts the bridge class instance into a plain method object with `buildContextBridgeApi`.
3. Exposes that object as `window.shiftBridge`.
4. Builds typed IPC helpers and exposes them as `window.electronAPI`.

## Gotchas

- `buildContextBridgeApi` only wraps prototype methods. If a native method is added as an own property, it will not be exposed.
- `contextBridge` values must be plain data/functions. Do not expose the native class instance directly.
- `window.shiftBridge` is the raw bridge boundary. Editor/reactive behavior belongs in renderer-side model code, not preload.

## Verification

```bash
pnpm --filter @shift/desktop typecheck
pnpm --filter @shift/desktop lint
```

## Related

- `@shift/bridge` -- runtime native bridge loader and bridge type exports.
- `@shift/types` -- generated bridge DTO/API facade plus shared primitive DTO types.
- `ElectronAPI` -- IPC/system API surface exposed as `window.electronAPI`.
- `WindowManager` -- loads this preload script through `webPreferences.preload`.
