# Main

Electron main process: app startup, windows, menus, document dialogs, and workspace session ownership.

## Architecture Invariants

- **Architecture Invariant:** `WorkspaceManager` owns live font sessions. Windows attach to sessions; commands and IPC resolve the session from the focused window or sender. A session's immutable mode is `"authored"` or `"imported"`.
- **Architecture Invariant:** Every font session owns one `WorkspaceProcess`. Authored sessions additionally own one `DocumentClient` and one `DocumentSession`; imported sessions deliberately have no authored document, persistence, dirty state, save target, or export workflow. Main never reads or mutates font data directly.
- **Architecture Invariant:** Every non-`.shift` font path opens as an immutable imported session. It uses the shared renderer sync lane and `/home` route, but never allocates a SQLite working document or authored Shift model.
- **Architecture Invariant:** Dirty state and save targets come from the utility-owned workspace state. Main shows native dialogs, but state reads, saves, and exports go through the renderer document lane so pending edits flush first.
- **Architecture Invariant:** TTF export snapshots the workspace in the ordered sync lane, then releases that lane before font compilation so subsequent editing is not blocked by fontc.
- **Architecture Invariant:** Within one app instance, at most one live or in-flight session owns a `DocumentId`. Different documents open concurrently; a raw filesystem copy retains its identity and therefore reuses the existing session until Save As mints an independent `DocumentId`.
- **Architecture Invariant:** Closing the last window for a workspace runs `DocumentSession.confirmClose`. Clean documents and explicitly discarded dirty documents are closed through the utility process so app-owned recovery bindings and SQLite overlays are pruned. Unexpected process termination leaves completed recovery transactions intact.
- **Architecture Invariant:** Closing every window keeps the application alive on macOS. Activating the windowless app opens a fresh launcher; Windows and Linux quit after the last window closes.
- **Architecture Invariant:** Disposable Slug pages live under the app-wide `derived-cache/slug-atlases` root beside `working-documents`, never inside authored `.shift` content. Utility processes share the one-GiB byte-budgeted LRU; each process validates an artifact index once and then verifies and decompresses its fixed pages independently. Staging paths use readable `run-{pid}-{id}/page-{index}-{id}.zst` names, and every retry owns a distinct file until publication. The LRU scans after an artifact is opened or published, never after every page stream. Stale, corrupt, and evicted entries rebuild.
- **Architecture Invariant:** IPC channels are type-safe. `ipcMain.handle` calls use the typed wrapper from `shared/ipc/main`, and channel names and payload types live in `shared/ipc/contract.ts` and `shared/workspace/protocol.ts`.
- **Architecture Invariant:** `shared/workspace/channel.ts` owns only correlated calls/events over the required `Transport` shape. Electron, DOM and Node-port adapters live in `localTransports.ts`; WebSocket lanes use bounded standard-map CBOR from `channelCodec.ts`, preserving `Float64Array`/`Uint8Array` without structured-clone extensions. One ordinary frame is limited to 32 MiB, malformed or unsupported values close the socket, and WebSocket lanes reject transferred ports. Atlas byte streams remain on local transferred ports until a separately bounded network stream protocol lands.

## Codemap

```text
src/main/
  main.ts                         -- Electron entry point
  app/
    App.ts                        -- app service graph, IPC handlers, command context
    AppLifecycle.ts               -- close/quit confirmation flow
    AppIcon.ts                    -- dock/tray icon asset helper
  commands/
    Command.ts                    -- command registry and command context types
    Commands.ts                   -- built-in shell commands
  document/
    DocumentClient.ts             -- main client for the renderer document lane
    DocumentSession.ts            -- native save/save-as/export/close workflow
    openFontDialog.ts             -- native open dialog
  menu/
    ApplicationMenu.ts            -- Electron application menu
  windows/
    Window.ts                     -- BrowserWindow wrapper
    WindowManager.ts              -- live window registry
  workspace/
    WorkspaceManager.ts           -- live workspace registry and document-open coalescing
    DocumentSessionIndex.ts        -- one live workspace owner per canonical DocumentId
    WorkspaceProcess.ts           -- utility-process shell-lane controller
    FontSessionHost.ts            -- process/mode/optional-document/window grouping for one font session
```

## Key Types

- `WorkspaceManager` -- registry for live Shift and imported font sessions and window attachments.
- `FontSessionHost` -- owns the immutable mode, utility process, optional authored document services, and attached windows for one open font.
- `DocumentSessionIndex` -- maps each live `DocumentId` to one app-local workspace session and follows Save As identity changes.
- `WorkspaceProcess` -- starts the utility process and exposes shell-lane calls such as create, inspect document, open, close, and document state.
- `DocumentClient` -- request client for renderer-served document state/save calls.
- `DocumentSession` -- native document workflow for Save, Save As, Export TrueType, and close confirmation.
- `AppLifecycle` -- coordinates Electron window close and app quit around document vetoes.
- `WorkspaceDocumentState` -- utility-owned lifecycle state mirrored into main and renderer.

## How it works

### Startup

`main.ts` constructs `App` and calls `start()`. `App` registers commands and IPC handlers, starts `AppLifecycle`, sets the user-data-backed `working-documents` root, creates the launcher window, and installs the application menu. That app-owned root contains workspace allocations, sparse recovery overlays, and document-address bindings; canonical `.shift` files remain at their user-selected paths. Development normally uses `Shift Dev` below Electron's app-data directory, but an explicit standard `--user-data-dir` switch takes precedence so E2E runs can own isolated browser and recovery state.

On macOS, closing the last window leaves Shift running. A later Dock activation opens a new launcher window. Windows and Linux keep the conventional quit-on-last-window behavior.

### Workspace Creation And Open

File -> New asks `WorkspaceManager.createUntitled()` for a session. File -> Open shows `showOpenFontDialog()` and then asks `WorkspaceManager.openPath(path)`.

For every non-`.shift` font path, `WorkspaceManager` opens one immutable retained source in the utility process and registers an `"imported"` session without a document lane. For `.shift` paths, `WorkspaceManager` starts a provisional utility process and calls `workspace.inspectDocument` before opening. If a live session already owns the same `DocumentId`, the provisional process is stopped and the existing session is returned. Concurrent requests for that identity share one in-flight open, so only one utility process may publish its recovery binding. Otherwise the utility opens the canonical SQLite file directly against the bound app-owned sparse overlay and registers the resulting workspace state. Path-specific bindings distinguish a closed document move from a raw copy: one missing old path can rebind its recovery, while an extant original path prevents its recovery from being attached to the copy. Main does not start monolithic Slug preparation: the renderer requests the complete fixed-page set before its first Grid presentation. The utility opens and validates a matching cache artifact once, serves independently verified Zstd pages through the bounded stream contract, or compiles native misses and stages them for atomic publication. Page boundaries keep compilation, streaming, cache replacement, and local edit invalidation bounded without putting page acquisition on the scroll path.

### Window Attachment

`App` creates a BrowserWindow, attaches it to the returned `FontSessionHost`, and loads the workspace route. Multiple windows may attach to the same session. Closing one of several windows does not close the document; closing the last window does.

### Save, Export, And Close

Save and Save As start in `DocumentSession`, but the actual save request goes through `DocumentClient` to the renderer document lane. The renderer flushes queued edits through the workspace sync lane before calling `workspace.save` or `workspace.saveAs`.

Export TrueType follows the same document and sync lanes. The utility process captures an immutable native snapshot after prior edits, then awaits direct Shift IR-to-fontc compilation outside the workspace queue. Edits submitted after snapshot capture can proceed and are not included in that export. Export does not change the document binding or dirty state.

For a document-backed workspace, Save first reconciles the current canonical commit and then commits only its sparse recovery rows. A changed commit becomes `Conflict` rather than accepting a stale Save. Save As snapshots the merged view to a new canonical `DocumentId`, installs a fresh recovery overlay, and rebinds the existing app-local workspace session. The source canonical document remains unchanged.

Close and quit call `DocumentSession.confirmClose`. If the document is clean, or the user saves successfully, or the user chooses Don't Save, `DocumentSession` calls `workspace.close` in the utility process. Don't Save first clears native recovery state. The utility then drops the Rust workspace handle, removes the document binding, and deletes the clean/discarded app-owned workspace directory. A crash or forced termination bypasses this cleanup, allowing the next open of the same document address to resume the completed recovery transactions.

Message lanes reject in-flight calls when their remote port closes. An unexpected utility-process exit also disconnects the renderer document lane: Save remains blocked because pending edits cannot be settled, while an explicit Discard treats the unavailable workspace as already closed so window and quit guards can finish.

### IPC

Renderer IPC in `App` is limited to shell capabilities: command execution, clipboard, optional document-lane port transfer, immutable session mode, readiness, and shared session sync-lane port transfer. Font data stays on that sync lane between renderer and utility.

## Workflow Recipes

### Add a workspace shell call

1. Add the request/response type to `shared/workspace/protocol.ts`.
2. Serve it in `utility/workspace/WorkspaceHost.ts`.
3. Add a method on `main/workspace/WorkspaceProcess.ts` if main needs to call it.
4. Add or update `WorkspaceHost.test.ts` with observable state assertions.

### Add a File menu command

1. Add a command in `commands/Commands.ts`.
2. Implement it through the command context in `app/App.ts`.
3. Keep native dialogs in `document/` and workspace ownership in `workspace/`.

## Verification

- `pnpm --filter @shift/desktop test src/utility/workspace/WorkspaceHost.test.ts`
- `pnpm --filter @shift/desktop test src/renderer/src/lib/workspace/WorkspaceEditCoordinator.test.ts`
- `pnpm typecheck`
- Electron E2E fixtures materialize a native startup document under a fresh `testRoot`, launch with a fresh `userDataDir`, assert Electron honored that path, and remove the root after force-closing the disposable process.
- `document-recovery.spec.ts` force-terminates Electron, reopens the same document and user-data directory, verifies recovery, then verifies explicit Save changes the canonical document.
- Manual: open the same `.shift` document twice and verify the existing workspace session is reused.
- Manual: edit a document, close the last window, and verify the Save / Don't Save / Cancel prompt appears.

## Related

- `shared/workspace/protocol.ts` -- utility shell/sync channel types.
- `shared/workspace/channel.ts` -- platform-neutral request/response/event channel.
- `shared/workspace/localTransports.ts` -- Electron, DOM and Node message-port adapters.
- `shared/workspace/channelCodec.ts` -- bounded CBOR envelope codec with typed-array preservation.
- `shared/workspace/webSocketTransport.ts` -- established-WebSocket adapter; no port transfer or large-stream multiplexing.
- `utility/workspace/WorkspaceHost.ts` -- utility-process owner of the Rust bridge and working documents.
- `@shift/bridge` -- runtime native bridge package.
