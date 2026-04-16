# Preload

Electron preload script that bridges the native Rust `FontEngine` and typed IPC channels to the renderer via `contextBridge`.

## Architecture Invariants

- **Architecture Invariant:** `sandbox: false` is required in `WindowManager.create` `webPreferences` because the preload uses `require("shift-node")` to load the native NAPI addon. **CRITICAL**: enabling the sandbox silently breaks font engine access with no error at bridge creation time -- it only fails when the renderer calls a method.

- **Architecture Invariant:** `buildBridgeAPI` dynamically wraps every prototype method of the `FontEngine` instance. This means the exposed API surface automatically tracks whatever `#[napi]` methods exist on the Rust side -- no manual method listing required. **CRITICAL**: if a native method is removed from Rust, the preload will still expose a wrapper that throws at call time, not at startup.

- **Architecture Invariant:** Two separate `contextBridge.exposeInMainWorld` calls create two non-overlapping namespaces: `window.shiftFont` (native font engine) and `window.electronAPI` (IPC + system). These must stay separate because `shiftFont` is synchronous NAPI calls while `electronAPI` is async IPC.

- **Architecture Invariant:** The `electronAPI` object must satisfy the `ElectronAPI` interface exactly. TypeScript enforces this at compile time. Adding a new IPC channel requires updating `IpcEvents` or `IpcCommands` first, then wiring it here.

## Codemap

```
preload/
  preload.ts          -- single entry point; creates FontEngine instance,
                         builds bridge API, wires IPC, exposes both namespaces
```

## Key Types

- `FontEngineAPI` -- derived as `Omit<FontEngine, "constructor">`, defined in the bridge module. Single source of truth for the native API surface.
- `ElectronAPI` -- typed interface for all IPC commands, event listeners, system utilities, and clipboard access. Defined in the ipc module.
- `IpcEvents` -- main-to-renderer broadcast channel map (menu actions, theme, debug).
- `IpcCommands` -- renderer-to-main request/response channel map (dialogs, window control, document state).

## How it works

The preload runs once before the renderer loads. It does three things:

1. **Native font engine bridge.** Creates a single `FontEngine` instance from `shift-node`. `buildBridgeAPI` walks the prototype, wrapping each method in a forwarding closure so `contextBridge` can serialize/deserialize arguments correctly. The result is exposed as `window.shiftFont`.

2. **Typed IPC bridge.** Uses the `listener` and `command` helpers from the ipc module to create typed wrappers around `ipcRenderer.on` and `ipcRenderer.invoke`. Each IPC channel is wired by name to a property on the `electronAPI` object, then exposed as `window.electronAPI`.

3. **Direct system access.** `homePath` is captured once from `os.homedir()`. Clipboard read/write goes through Electron's `clipboard` module directly (no IPC round-trip).

The renderer accesses the font engine through `getNative()` in the bridge module, which caches `window.shiftFont`. All mutation calls go through `NativeBridge`, which wraps `getNative()` with session management, snapshot parsing, and reactive state.

## Workflow recipes

### Add a new IPC command (renderer-to-main)

1. Add the channel signature to `IpcCommands` in the ipc channels module.
2. Add the corresponding property to `ElectronAPI` using the `CommandInvoker` type.
3. Add `yourCommand: invoke("your:channel")` to the `electronAPI` object in `preload.ts`.
4. Handle the channel in the main process with `ipcMain.handle`.

### Add a new IPC event (main-to-renderer)

1. Add the channel signature to `IpcEvents` in the ipc channels module.
2. Add the corresponding property to `ElectronAPI` using the `EventListener` type.
3. Add `onYourEvent: on("your:channel")` to the `electronAPI` object in `preload.ts`.
4. Send from main process with `webContents.send`.

### New native FontEngine method appears after Rust rebuild

Nothing to do in the preload. `buildBridgeAPI` auto-discovers prototype methods. The `FontEngineAPI` type updates automatically since it derives from the napi-generated `FontEngine` class.

## Gotchas

- `buildBridgeAPI` only wraps own prototype methods (skips `constructor` and non-function properties). If a native method is defined as an own property rather than on the prototype, it will not be exposed.
- `contextBridge` serialization means you cannot pass functions, Promises, or class instances through `window.shiftFont` -- only plain data. The native methods already return strings/numbers/booleans so this works, but keep it in mind if extending.
- The `listener` helper returns an unsubscribe function. If the renderer does not call it, the listener leaks. This is the renderer's responsibility, not the preload's.

## Verification

```bash
# Type-check (catches mismatches between ElectronAPI interface and preload wiring)
pnpm --filter @shift/desktop typecheck

# Lint
pnpm --filter @shift/desktop lint
```

## Related

- `FontEngineAPI` (bridge module) -- type definition for the native API surface
- `ElectronAPI` (ipc module) -- type definition for the IPC/system API surface
- `IpcEvents`, `IpcCommands` (ipc channels module) -- channel maps
- `listener`, `command` (ipc preload module) -- typed IPC wrapper factories
- `NativeBridge` (renderer bridge) -- renderer-side wrapper that consumes `window.shiftFont`
- `getNative` (renderer bridge/native) -- cached accessor for `window.shiftFont`
- `WindowManager` (main module) -- loads the preload script via `webPreferences.preload`
