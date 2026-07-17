# Main

Electron main process: app startup, windows, menus, document dialogs, and workspace session ownership.

## Architecture Invariants

- **Architecture Invariant:** `WorkspaceManager` owns live workspace sessions. Windows attach to sessions; commands and IPC resolve the session from the focused window or sender.
- **Architecture Invariant:** Each workspace session owns one `WorkspaceProcess`, one `DocumentClient`, and one `DocumentSession`. Main never reads or mutates font data directly.
- **Architecture Invariant:** Dirty state and save targets come from the utility-owned workspace state. Main shows native dialogs, but state reads, saves, and exports go through the renderer document lane so pending edits flush first.
- **Architecture Invariant:** TTF export snapshots the workspace in the ordered sync lane, then releases that lane before font compilation so subsequent editing is not blocked by fontc.
- **Architecture Invariant:** A `.shift` package session is reused by `(packageId, canonicalPath)`, not by the path string the user selected and not by the current document id.
- **Architecture Invariant:** Closing the last window for a workspace runs `DocumentSession.confirmClose`. Clean documents and explicitly discarded dirty documents are closed through the utility process so package bindings and SQLite documents are pruned.
- **Architecture Invariant:** Closing every window keeps the application alive on macOS. Activating the windowless app opens a fresh launcher; Windows and Linux quit after the last window closes.
- **Architecture Invariant:** IPC channels are type-safe. `ipcMain.handle` calls use the typed wrapper from `shared/ipc/main`, and channel names and payload types live in `shared/ipc/contract.ts` and `shared/workspace/protocol.ts`.

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
    WorkspaceManager.ts           -- live workspace session registry and package-session dedupe
    WorkspaceProcess.ts           -- utility-process shell-lane controller
    WorkspaceSession.ts           -- process/document/window grouping for one workspace
```

## Key Types

- `WorkspaceManager` -- registry for live workspace sessions and window attachments.
- `WorkspaceSession` -- owns the utility process, renderer document lane, document workflow, and attached windows for one workspace.
- `WorkspaceProcess` -- starts the utility process and exposes shell-lane calls such as create, inspect package, open, close, and document state.
- `DocumentClient` -- request client for renderer-served document state/save calls.
- `DocumentSession` -- native document workflow for Save, Save As, Export TrueType, and close confirmation.
- `AppLifecycle` -- coordinates Electron window close and app quit around document vetoes.
- `WorkspaceDocumentState` -- utility-owned lifecycle state mirrored into main and renderer.

## How it works

### Startup

`main.ts` constructs `App` and calls `start()`. `App` registers commands and IPC handlers, starts `AppLifecycle`, sets the user-data-backed `working-documents` root, creates the launcher window, and installs the application menu.

On macOS, closing the last window leaves Shift running. A later Dock activation opens a new launcher window. Windows and Linux keep the conventional quit-on-last-window behavior.

### Workspace Creation And Open

File -> New asks `WorkspaceManager.createUntitled()` for a session. File -> Open shows `showOpenFontDialog()` and then asks `WorkspaceManager.openPath(path)`.

For `.shift` paths, `WorkspaceManager` starts a provisional utility process and calls `workspace.inspectPackage` before opening. If a live session already owns the same `(packageId, canonicalPath)`, the provisional process is stopped and the existing session is returned. Otherwise the process opens the package and the resulting state is registered.

### Window Attachment

`App` creates a BrowserWindow, attaches it to the returned `WorkspaceSession`, and loads the workspace route. Multiple windows may attach to the same session. Closing one of several windows does not close the document; closing the last window does.

### Save, Export, And Close

Save and Save As start in `DocumentSession`, but the actual save request goes through `DocumentClient` to the renderer document lane. The renderer flushes queued edits through the workspace sync lane before calling `workspace.save` or `workspace.saveAs`.

Export TrueType follows the same document and sync lanes. The utility process captures an immutable native snapshot after prior edits, then awaits direct Shift IR-to-fontc compilation outside the workspace queue. Edits submitted after snapshot capture can proceed and are not included in that export. Export does not change the package binding or dirty state.

Close and quit call `DocumentSession.confirmClose`. If the document is clean, or the user saves successfully, or the user chooses discard, `DocumentSession` calls `workspace.close` in the utility process. The utility drops the Rust workspace handle, removes package bindings, and deletes the clean/discarded SQLite document. Dirty divergent documents created by package-source conflicts are orphaned by the utility process, not by main.

Message lanes reject in-flight calls when their remote port closes. An unexpected utility-process exit also disconnects the renderer document lane: Save remains blocked because pending edits cannot be settled, while an explicit Discard treats the unavailable workspace as already closed so window and quit guards can finish.

### IPC

Renderer IPC in `App` is limited to shell capabilities: command execution, clipboard, document-lane port transfer, and workspace sync-lane port transfer. Font data stays on the workspace sync lane between renderer and utility.

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
- Manual: open the same `.shift` package twice and verify the existing workspace session is reused.
- Manual: edit a package, close the last window, and verify the save/discard prompt appears.

## Related

- `shared/workspace/protocol.ts` -- utility shell/sync channel types.
- `utility/workspace/WorkspaceHost.ts` -- utility-process owner of the Rust bridge and working documents.
- `@shift/bridge` -- runtime native bridge package.
