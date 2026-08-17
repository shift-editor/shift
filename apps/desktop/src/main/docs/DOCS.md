# Main

Electron main process: app startup, windows, menus, document dialogs, and workspace session ownership.

## Architecture Invariants

- **Architecture Invariant:** `WorkspaceManager` owns live font sessions. Windows attach to sessions; commands and IPC resolve the session from the focused window or sender. A session's immutable mode is `"authored"` or `"imported"`.
- **Architecture Invariant:** Every font session owns one `WorkspaceProcess`. Authored sessions additionally own one `DocumentClient` and one `DocumentSession`; imported sessions deliberately have no authored document, persistence, dirty state, save target, or export workflow. Main never reads or mutates font data directly.
- **Architecture Invariant:** Every non-`.shift` font path opens as an immutable imported session. It uses the shared renderer sync lane and `/home` route, but never allocates a SQLite working document or authored Shift model.
- **Architecture Invariant:** Dirty state and save targets come from the utility-owned workspace state. Main shows native dialogs, but state reads, saves, and exports go through the renderer document lane so pending edits flush first.
- **Architecture Invariant:** TTF export snapshots the workspace in the ordered sync lane, then releases that lane before font compilation so subsequent editing is not blocked by fontc.
- **Architecture Invariant:** A `.shift` package session is reused by `(packageId, canonicalPath)`, not by the path string the user selected and not by the current document id.
- **Architecture Invariant:** Closing the last window for a workspace runs `DocumentSession.confirmClose`. Clean documents and explicitly discarded dirty documents are closed through the utility process so package bindings and SQLite documents are pruned.
- **Architecture Invariant:** Closing every window keeps the application alive on macOS. Activating the windowless app opens a fresh launcher; Windows and Linux quit after the last window closes.
- **Architecture Invariant:** Release and Nightly builds have distinct product identities and app-data roots. `Shift` uses `app.shift` and the `Shift` data root; `Shift Nightly` uses `app.shift.nightly` and the `Shift Nightly` data root. An explicit `--user-data-dir` switch takes precedence for tests and diagnostics.
- **Architecture Invariant:** `AppUpdater` owns application update state in main. It accepts only signed descriptors for the compiled distribution and exact platform/architecture, deduplicates Electron downloads, and cannot restart until `AppLifecycle` settles every document. Linux and unsigned Windows builds expose downloads without claiming automatic installation.
- **Architecture Invariant:** Disposable Slug pages live under the app-wide `derived-cache/slug-atlases` root beside `working-documents`, never inside authored `.shift` content. Utility processes share the one-GiB byte-budgeted LRU; each process validates an artifact index once and then verifies and decompresses its fixed pages independently. Staging paths use readable `run-{pid}-{id}/page-{index}-{id}.zst` names, and every retry owns a distinct file until publication. The LRU scans after an artifact is opened or published, never after every page stream. Stale, corrupt, and evicted entries rebuild.
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
  update/
    AppUpdater.ts                  -- update orchestration, scheduling, and Electron events
    nextUpdateState.ts             -- pure legal update transitions
    types.ts                       -- update, artifact, event, and state contracts
    updateDialogs.ts               -- native update result and restart dialogs
    updateFeed.ts                  -- signed channel descriptor verification
  windows/
    Window.ts                     -- BrowserWindow wrapper
    WindowManager.ts              -- live window registry
  workspace/
    WorkspaceManager.ts           -- live workspace session registry and package-session dedupe
    WorkspaceProcess.ts           -- utility-process shell-lane controller
    FontSessionHost.ts            -- process/mode/optional-document/window grouping for one font session
```

## Key Types

- `WorkspaceManager` -- registry for live Shift and imported font sessions and window attachments.
- `FontSessionHost` -- owns the immutable mode, utility process, optional authored document services, and attached windows for one open font.
- `WorkspaceProcess` -- starts the utility process and exposes shell-lane calls such as create, inspect package, open, close, and document state.
- `DocumentClient` -- request client for renderer-served document state/save calls.
- `DocumentSession` -- native document workflow for Save, Save As, Export TrueType, and close confirmation.
- `AppLifecycle` -- coordinates Electron window close, app quit, and update restart around document vetoes.
- `AppUpdater` -- main-process owner of signed feed discovery, Electron auto-update events, and native update UI.
- `UpdateState` -- discriminated union for disabled, idle, checking, current, downloading, ready, restarting, and failed states.
- `WorkspaceDocumentState` -- utility-owned lifecycle state mirrored into main and renderer.

## How it works

### Startup

`main.ts` constructs `App` and calls `start()`. `App.start()` applies the compiled `SHIFT_DISTRIBUTION` identity before its first log entry or path-dependent service action, so logging, settings, caches, and recovery all resolve beneath the correct app-data root. Forge and the E2E builder both write the `main_window` renderer to `.vite/renderer/main_window`; production resolves that same directory through `MAIN_WINDOW_VITE_NAME`. `App` registers commands and IPC handlers, starts `AppLifecycle`, sets the user-data-backed `working-documents` root, creates the launcher window, and installs the application menu. Development uses `Shift Dev` or `Shift Nightly Dev`; an explicit standard `--user-data-dir` switch takes precedence so E2E runs can own isolated browser and working-document state.

On macOS, closing the last window leaves Shift running. A later Dock activation opens a new launcher window. Windows and Linux keep the conventional quit-on-last-window behavior.

Eligible packaged builds start `AppUpdater` after the first window is prepared. The updater makes one delayed quiet check and then checks periodically. Development, Linux, missing-key, and unsigned Windows builds remain explicitly disabled; their manual menu command explains the boundary rather than contacting Electron's updater.

### Application Updates

`AppUpdater.checkForUpdates` first downloads the small signed descriptor for the compiled Release or Nightly distribution. `updateFeed.ts` verifies its Ed25519 signature, schema, increasing semantic version, distribution, and exact platform/architecture before Electron receives an immutable native feed URL. Electron then owns the native download and emits events that pass through `nextUpdateState`; stale or duplicate events are logged and ignored.

Automatic current/error results stay quiet. Manual checks use native dialogs, and a completed download offers Restart or Later. Restart calls `AppLifecycle.confirmQuit("update")`, preserving the same Save / Don't Save / Cancel behavior as normal quit. Cancellation stays ready. A synchronous install failure restores ordinary close guards and returns to ready.

The application menu exposes `app.checkForUpdates` under the macOS app menu and the Windows/Linux Help menu. Update behavior remains main-owned and does not add renderer IPC.

### Workspace Creation And Open

File -> New asks `WorkspaceManager.createUntitled()` for a session. File -> Open shows `showOpenFontDialog()` and then asks `WorkspaceManager.openPath(path)`.

For every non-`.shift` font path, `WorkspaceManager` opens one immutable retained source in the utility process and registers an `"imported"` session without a document lane. For `.shift` paths, `WorkspaceManager` starts a provisional utility process and calls `workspace.inspectPackage` before opening. If a live session already owns the same `(packageId, canonicalPath)`, the provisional process is stopped and the existing session is returned. Otherwise the process opens the package and the resulting state is registered. Main does not start monolithic Slug preparation: the renderer requests the complete fixed-page set before its first Grid presentation. The utility opens and validates a matching cache artifact once, serves independently verified Zstd pages through the bounded stream contract, or compiles native misses and stages them for atomic publication. Page boundaries keep compilation, streaming, cache replacement, and local edit invalidation bounded without putting page acquisition on the scroll path.

### Window Attachment

`App` creates a BrowserWindow, attaches it to the returned `FontSessionHost`, and loads the workspace route. Multiple windows may attach to the same session. Closing one of several windows does not close the document; closing the last window does.

### Save, Export, And Close

Save and Save As start in `DocumentSession`, but the actual save request goes through `DocumentClient` to the renderer document lane. The renderer flushes queued edits through the workspace sync lane before calling `workspace.save` or `workspace.saveAs`.

Export TrueType follows the same document and sync lanes. The utility process captures an immutable native snapshot after prior edits, then awaits direct Shift IR-to-fontc compilation outside the workspace queue. Edits submitted after snapshot capture can proceed and are not included in that export. Export does not change the package binding or dirty state.

Close and quit call `DocumentSession.confirmClose`. If the document is clean, or the user saves successfully, or the user chooses discard, `DocumentSession` calls `workspace.close` in the utility process. The utility drops the Rust workspace handle, removes package bindings, and deletes the clean/discarded SQLite document. Dirty divergent documents created by package-source conflicts are orphaned by the utility process, not by main.

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
- `pnpm test:desktop src/main/update/nextUpdateState.test.ts src/main/update/updateFeed.test.ts`
- `pnpm test:release`
- Electron E2E fixtures copy their startup workspace under a fresh `testRoot`, launch with a fresh `userDataDir`, assert Electron honored that path, and remove the root after force-closing the disposable process.
- Manual: open the same `.shift` package twice and verify the existing workspace session is reused.
- Manual: edit a package, close the last window, and verify the save/discard prompt appears.
- Manual packaged build: choose Check for Updates and verify current, unavailable, ready, Later, and document-canceled Restart paths.

## Related

- `shared/workspace/protocol.ts` -- utility shell/sync channel types.
- `utility/workspace/WorkspaceHost.ts` -- utility-process owner of the Rust bridge and working documents.
- `@shift/bridge` -- runtime native bridge package.
