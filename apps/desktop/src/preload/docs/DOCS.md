# Preload

Electron preload script that exposes the typed Shift host API and relays session ports to the renderer.

## Architecture Invariants

- **Architecture Invariant:** Preload exposes only `window.shiftHost`; the native bridge lives in the utility process behind the typed font-session lane. **WHY:** renderer isolation must not expose native font methods directly.
- **Architecture Invariant:** Every `shiftHost` method delegates through typed IPC helpers and contains only context-bridge-compatible functions and values.
- **Architecture Invariant:** Session and document `MessagePort`s are relayed with `window.postMessage` because ports cannot cross Electron's context bridge. Renderer listeners authenticate the same window and expected message type before accepting a port.

## Codemap

```
preload/
  preload.ts -- exposes shiftHost and relays session/document MessagePorts
```

## Key Types

- `ShiftHost` -- renderer-facing app-shell API for commands, documents, sessions, UI events, and clipboard access.
- `RendererToMain` -- renderer-to-main request/response channel map.
- `MainToRenderer` -- main-to-renderer broadcast channel map.

## How it works

The preload runs once before the renderer loads:

1. Builds `ShiftHost` methods from typed `invoke` and `listen` IPC helpers.
2. Exposes that object as `window.shiftHost` through `contextBridge`.
3. Relays session and document `MessagePort`s into the page. Because packaged `file://` pages have opaque origins, receivers authenticate these relays with `event.source === window` plus the expected message type rather than comparing origin strings.

## Gotchas

- `contextBridge` values must remain plain data and functions.
- Native font access belongs to `WorkspaceHost` in the utility process, not preload.
- Port relays use `"*"` only as the `postMessage` delivery target required by opaque `file://` origins. Renderer listeners must retain the same-window source and message-type checks before accepting transferred ports.

## Verification

```bash
pnpm --filter @shift/desktop typecheck
pnpm --filter @shift/desktop lint
```

## Related

- `ShiftHost` -- app-shell API surface exposed as `window.shiftHost`.
- `WorkspaceHost` -- utility-process owner of the native bridge and font-session service.
- `FontSessionClient` -- renderer consumer of relayed session ports.
- `Window` -- loads this preload script through `webPreferences.preload`.
