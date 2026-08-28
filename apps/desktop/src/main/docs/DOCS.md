# Main

<!-- reviewed: 2026-08-27 -->

Electron main process: app startup, windows, menus, document dialogs, and workspace session ownership.

## Architecture Invariants

- **Architecture Invariant:** `WorkspaceManager` owns live font sessions. Windows attach to sessions; commands and IPC resolve the session from the focused window or sender. A session's immutable mode is `"authored"` or `"preview"`.
- **Architecture Invariant:** Every font session owns one `WorkspaceProcess`. Authored sessions additionally own one `DocumentClient` and one `DocumentSession`; preview sessions deliberately have no authored document, persistence, dirty state, save target, or export workflow. Main never reads or mutates font data directly.
- **Architecture Invariant:** Every non-`.shift` font path opens as an immutable preview session. It uses the shared renderer sync lane and `/home` route, but never allocates a SQLite working document or authored Shift model.
- **Architecture Invariant:** Save or Save As may convert UFO, Designspace, Glyphs, and Glyphspackage previews into a new authored session. The preview itself never changes mode: `workspace.createFromSource` fully imports and atomically publishes a separate canonical document, then main reattaches and reloads the active window. Cancel or failure leaves the preview and destination unchanged. TTF and OTF previews cannot convert.
- **Architecture Invariant:** Dirty state and save targets come from the utility-owned workspace state. Main obtains native choices through `NativeDialogs`, but state reads, saves, and exports go through the renderer document lane so pending edits flush first. Production uses Electron dialogs; E2E injects deterministic choices at this outer boundary.
- **Architecture Invariant:** TTF export snapshots the workspace in the ordered sync lane, then releases that lane before font compilation so subsequent editing is not blocked by fontc.
- **Architecture Invariant:** Within one app instance, at most one live or in-flight session owns a `DocumentId`. Different documents open concurrently; a raw filesystem copy retains its identity and therefore reuses the existing session until Save As mints an independent `DocumentId`.
- **Architecture Invariant:** `DocumentSession.prepareClose(reason)` may prompt and save, but it never closes a workspace. Window close prepares and commits its one document. Quit and update restart prepare every document before committing any; cancellation calls `cancelClose()` on every prepared document. `commitClose()` is the point of no return and clears recovery only for an explicit discard.
- **Architecture Invariant:** Closing every window keeps the application alive on macOS. Activating the windowless app opens a fresh launcher; Windows and Linux quit after the last window closes.
- **Architecture Invariant:** Release and Nightly builds have distinct product identities and app-data roots. `Shift` uses `app.shift` and the `Shift` data root; `Shift Nightly` uses `app.shift.nightly` and the `Shift Nightly` data root. An explicit `--user-data-dir` switch takes precedence for tests and diagnostics.
- **Architecture Invariant:** Shift is single-instance within one distribution data root. Operating-system `.shift` activations received before readiness queue in order; later activations focus an already-open document or create another workspace window. Release owns the document association, while Nightly remains an alternate handler.
- **Architecture Invariant:** `AppUpdater` owns application update state in main. It selects only the fixed electron-updater metadata channel for the compiled distribution and exact platform/architecture, requires consent before downloading, deduplicates checks/downloads/restarts, and cannot call `quitAndInstall()` until `AppLifecycle` commits every document. `UpdateWindow` reflects main-owned progress and ready state but never owns updater transitions. macOS Release/Nightly and Windows Nightly x64 update automatically; Windows Release and Linux use distribution-matched manual downloads.
- **Architecture Invariant:** Disposable Slug pages live under the app-wide `derived-cache/slug-atlases` root beside `working-documents`, never inside authored `.shift` content. Utility processes share the one-GiB byte-budgeted LRU; each process validates an artifact index once and then verifies and decompresses its fixed pages independently. Staging paths use readable `run-{pid}-{id}/page-{index}-{id}.zst` names, and every retry owns a distinct file until publication. The LRU scans after an artifact is opened or published, never after every page stream. Stale, corrupt, and evicted entries rebuild.
- **Architecture Invariant:** IPC channels are type-safe. `ipcMain.handle` calls use the typed wrapper from `shared/ipc/main`, and channel names and payload types live in `shared/ipc/contract.ts` and `shared/workspace/protocol.ts`.

## Codemap

```text
src/main/
  main.ts                         -- Electron entry point
  release.ts                      -- compiled distribution identity and product name
  about/
    AboutWindow.ts                -- singleton native-framed product information window
  app/
    App.ts                        -- app service graph, IPC handlers, command context
    AppLifecycle.ts               -- close/quit confirmation flow
    AppIcon.ts                    -- distribution-aware development Dock icon
  commands/
    Command.ts                    -- command registry and command context types
    Commands.ts                   -- built-in shell commands
  dialogs/
    NativeDialogs.ts              -- outer boundary for native file and document choices
    electronNativeDialogs.ts      -- production Electron dialog implementation
    scriptedNativeDialogs.ts      -- deterministic E2E dialog implementation
  document/
    DocumentClient.ts             -- main client for the renderer document lane
    DocumentSession.ts            -- native save/save-as/export/close workflow
    types.ts                      -- close reasons and dirty-document choices
  menu/
    ApplicationMenu.ts            -- Electron application menu
  update/
    AppUpdater.ts                  -- update orchestration, scheduling, consent, and restart safety
    UpdateWindow.ts                -- native-framed download progress and install prompt window
    types.ts                       -- update status and feed contracts
    updateFeed.ts                  -- pure native feed selection
  windows/
    Window.ts                     -- BrowserWindow wrapper
    WindowManager.ts              -- live window registry
  workspace/
    WorkspaceManager.ts           -- live workspace session registry
    DocumentSessionIndex.ts       -- one live workspace owner per canonical DocumentId
    WorkspaceProcess.ts           -- utility-process shell-lane controller
    FontSessionHost.ts            -- process/mode/optional-document/window grouping for one font session
```

## Key Types

- `WorkspaceManager` -- registry for live authored documents, immutable preview sessions, and window attachments.
- `FontSessionHost` -- owns the immutable mode, utility process, optional authored document services, and attached windows for one open font.
- `DocumentSessionIndex` -- maps each live `DocumentId` to one app-local workspace session and follows Save As identity changes.
- `WorkspaceProcess` -- starts the utility process and exposes shell-lane calls such as create, inspect document, open, close, and document state.
- `DocumentClient` -- request client for renderer-served document state/save calls.
- `NativeDialogs` -- injected outer boundary for Open, Save As, Export, dirty-close choices, and failure messages.
- `DocumentSession` -- native document workflow for Save, Save As, Export TrueType, and close confirmation.
- `AppLifecycle` -- coordinates Electron window close, app quit, and update restart around document vetoes.
- `AppUpdater` -- main-process owner of native feed selection, Electron auto-update events, consent, cancellation, and restart safety.
- `UpdateWindow` -- native-framed renderer of download progress and ready-to-install choices.
- `UpdateStatus` -- updater lifecycle: idle, checking, available, downloading, ready, or restarting.
- `WorkspaceDocumentState` -- utility-owned lifecycle state mirrored into main and renderer.

## How it works

### Startup

`main.ts` constructs `App` and calls `start()`. `App.start()` applies the compiled `SHIFT_DISTRIBUTION` identity before its first log entry or path-dependent service action, so logging, settings, caches, and recovery all resolve beneath the correct app-data root. The production/E2E build and development-only Forge runner write the `main_window` renderer to `.vite/renderer/main_window`; production resolves that same directory through `MAIN_WINDOW_VITE_NAME`. `App` registers commands and IPC handlers, starts `AppLifecycle`, sets the user-data-backed `working-documents` root, creates the launcher window, and installs the application menu. Development uses `Shift Dev` or `Shift Nightly Dev`; an explicit standard `--user-data-dir` switch takes precedence so E2E runs can own isolated browser and working-document state.

The runtime icon follows the same compiled identity: `AppIcon` selects `nightly-macos.png` when `shiftDistribution` is `"nightly"` and `icon-macos.png` otherwise, so Release and Nightly are visually distinct in the development macOS Dock. Packaged installer icons remain owned by electron-builder configuration. The renderer's shared `app-icon.png` supplies the custom About and Update screens. Both distributions use the shared `shift-document` artwork for `.shift` files; association priority, not document appearance, distinguishes their ownership.

`App.start()` establishes the distribution-specific data root before taking Electron's single-instance lock. macOS `open-file`, first-instance command-line arguments, and subsequent `second-instance` arguments feed one ordered pending-path queue. Startup drains that queue before deciding whether a launcher is needed.

On macOS, closing the last window leaves Shift running. A later Dock activation opens a new launcher window. Windows and Linux keep the conventional quit-on-last-window behavior.

### Application Commands

Native menu items carry the shared `CommandId`, label, accelerator, and current `CommandRegistry` capability. `ApplicationMenu.updateCommandStates()` refreshes enabled state when window focus or session ownership changes and after a command settles. `app.showAbout` opens or focuses the singleton fixed-size custom About window; its HTTPS links remain renderer-declared while `AboutWindow` opens them through Electron's shell boundary. Save and Save As are enabled for authored documents and convertible previews; Export and Edit commands require an authored document.

Edit-menu accelerators and clicks send `RendererCommandId` operations to the active authored renderer instead of using Electron's DOM-only roles. The renderer preserves conventional behavior for a focused text input; otherwise Undo, Redo, Cut, Copy, Paste, Delete, and Select All operate on Shift's canvas editor and canonical workspace history. Commands may remain enabled within an authored document when its current selection, clipboard, or history makes a particular invocation a safe no-op.

The View menu reserves conventional Zoom In and Zoom Out labels and shortcuts for the glyph canvas. Browser-window scaling is exposed separately as Interface Size with Alt-modified shortcuts, preventing native accelerators from intercepting canvas zoom. The renderer requests the native canvas context menu through `menu.showCanvasContextMenu`; main resolves the sender's authored workspace and binds Cut, Copy, Paste, Duplicate, Delete, Select All, Deselect, and Reverse Selected Contour to that same sender window.

The macOS Window menu is registered through Electron's native `windowMenu` role so AppKit owns system placement, tiling, and open-window affordances. **Home** focuses an existing launcher or creates one without replacing the current document window. **Settings…** sends `app.showSettings` to the active font renderer and opens the existing document-scoped settings surface at Font; it remains unavailable on the launcher until Shift has app-wide settings.

Eligible packaged macOS builds and Windows Nightly x64 builds start `AppUpdater` after the first window is prepared. The updater waits 30 seconds before its first quiet check to avoid competing with application startup, then checks every four hours. Development builds explain that updates require packaging; Windows Release and Linux direct manual checks to matching GitHub downloads.

### Application Updates

`AppUpdater.checkForUpdates(trigger)` derives a fixed HTTPS generic-provider URL from the compiled Release or Nightly distribution and exact platform/architecture. electron-updater reads architecture-specific `latest-mac.yml` on macOS and `latest.yml` for Windows Nightly. It owns numeric version comparison, SHA-512 verification, download, macOS code-signature verification, Authenticode verification when configured, installation, and relaunch. Release and Nightly never share feed paths.

Automatic current/error results stay quiet. When a check finds an update, the native-framed update window offers **Download Update** / Later; declining leaves the version available without prompting again during periodic checks. An accepted download replaces those choices with cumulative progress. Closing the window or choosing Cancel cancels the transfer and returns to available. Download completion replaces progress with **Restart and Install** / Later, and a manual check while available or ready reopens the relevant choice. Later retains a verified download without silently installing it on ordinary quit. Restart prepares every document, cancels all prepared closes if one vetoes, commits every agreed close, and only then calls `quitAndInstall()`. Electron closes windows before normal `before-quit`, so `AppLifecycle`'s `confirmed` state allows those closes. An install failure after commit relaunches the currently installed application; closed in-memory sessions are never reconstructed.

The application menu exposes `app.checkForUpdates` under the macOS app menu and the Windows/Linux Help menu. Every platform's Help menu also opens the Shift website, Discord, X account, and GitHub issue form through fixed main-owned URLs. Update behavior remains main-owned and does not add renderer IPC.

### Workspace Creation And Open

File -> New asks `WorkspaceManager.createUntitled()` for a session. File -> Open asks `NativeDialogs.openFont()` for a path and then asks `WorkspaceManager.openPath(path)`. Native `.shift` activation uses that same `openPath` boundary: an existing document session is focused, a launcher is replaced, or a new workspace window is added without closing another document.

For every non-`.shift` font path, `WorkspaceManager` opens one immutable retained source in the utility process and registers a `"preview"` session without a document lane. Save and Save As are available for UFO, Designspace, Glyphs, and Glyphspackage previews. After the user chooses a `.shift` destination, `WorkspaceManager.createDocumentFromPreview` starts a separate utility process; `workspace.createFromSource` eagerly imports the complete foreign source and atomically publishes a canonical document. Main then detaches the active window from the preview, attaches it to the new `"authored"` session, disposes an unreferenced preview, and reloads the renderer. The original source is never modified. TTF and OTF remain read-only previews with Save disabled. For `.shift` paths, `WorkspaceManager` starts a provisional utility process and calls `workspace.inspectDocument` before opening. If a live session already owns the same `DocumentId`, the provisional process is stopped and the existing session is returned. Concurrent requests for that identity share one in-flight open, so only one utility process may publish its recovery binding. Otherwise the utility opens the canonical SQLite file directly against the bound app-owned sparse overlay and registers the resulting workspace state. Path-specific bindings distinguish a closed document move from a raw copy: one missing old path can rebind its recovery, while an extant original path prevents its recovery from being attached to the copy. Main does not start monolithic Slug preparation: the renderer requests the complete fixed-page set before its first Grid presentation. The utility opens and validates a matching cache artifact once, serves independently verified Zstd pages through the bounded stream contract, or compiles native misses and stages them for atomic publication. Page boundaries keep compilation, streaming, cache replacement, and local edit invalidation bounded without putting page acquisition on the scroll path.

### Window Attachment

`App` creates a BrowserWindow, attaches it to the returned `FontSessionHost`, and loads the workspace route. Multiple windows may attach to the same session. Closing one of several windows does not close the document; closing the last window does.

### Save, Export, And Close

For authored sessions, Save and Save As start in `DocumentSession`, which obtains destinations and confirmations through `NativeDialogs`; the actual save request goes through `DocumentClient` to the renderer document lane. The renderer flushes queued edits through the workspace sync lane before calling `workspace.save` or `workspace.saveAs`.

Convertible previews have no renderer document lane or pending edits. `App.savePreviewAsDocument` obtains the destination first, deduplicates the `"converting"` operation per preview session, and asks `WorkspaceManager.createDocumentFromPreview` to publish the first canonical document through the shell lane. Cancellation does no import work. Import or publication failure removes temporary workspace state, preserves an occupied destination, reports the save error, and keeps the preview attached.

Export TrueType follows the same document and sync lanes. The utility process captures an immutable native snapshot after prior edits, then awaits direct Shift IR-to-fontc compilation outside the workspace queue. Edits submitted after snapshot capture can proceed and are not included in that export. Export does not change the document binding or dirty state.

For a document-backed workspace, Save first reconciles the current canonical commit and then commits only its sparse recovery rows. A changed commit becomes `Conflict` rather than accepting a stale Save. Save As snapshots the merged view to a new canonical `DocumentId`, installs a fresh recovery overlay, and rebinds the existing app-local workspace session. The source canonical document remains unchanged.

Close and quit call `DocumentSession.prepareClose`. If the document is clean, the user saves successfully, or the user chooses discard, the session records the close intent without closing the workspace. Once the whole transition is accepted, `commitClose` calls `workspace.close`; an explicit discard first clears native recovery state. The utility then drops the Rust workspace handle, removes the document binding, and deletes the app-owned workspace directory. A crash or forced termination bypasses this cleanup, allowing the next open of the same document address to resume completed recovery transactions.

Message lanes reject in-flight calls when their remote port closes. An unexpected utility-process exit also disconnects the renderer document lane: Save remains blocked because pending edits cannot be settled, while an explicit Discard treats the unavailable workspace as already closed so window and quit guards can finish.

### IPC

Renderer IPC in `App` is limited to shell capabilities: command execution, native context-menu presentation, clipboard, update-window progress/actions, optional document-lane port transfer, immutable session mode, readiness, and shared session sync-lane port transfer. Font data stays on that sync lane between renderer and utility.

## Workflow recipes

### Add a workspace shell call

1. Add the request/response type to `shared/workspace/protocol.ts`.
2. Serve it in `utility/workspace/WorkspaceHost.ts`.
3. Add a method on `main/workspace/WorkspaceProcess.ts` if main needs to call it.
4. Add or update `WorkspaceHost.test.ts` with observable state assertions.

### Add a File menu command

1. Add a command in `commands/Commands.ts`.
2. Implement it through the command context in `app/App.ts`.
3. Add native choices to `NativeDialogs` with Electron and scripted implementations in `dialogs/`; keep workspace ownership in `workspace/`.

## Gotchas

- Electron/electron-updater orchestration is verified with installed N → N+1 builds; mocking Electron, native dialogs, or the updater does not provide a worthwhile unit test.
- SHA-512 update metadata verifies package integrity, not publisher authenticity. Windows Release remains manual until Authenticode signing is configured.
- IPC handlers are registered once, before any window exists, and resolve the font session from `event.sender` on every call. Never cache a window or session inside a handler closure — multiple windows can attach to one session, and windows outlive none of them.
- `document.connect` throws for preview sessions because they have no `documentClient`. Renderer code must check `session.mode` before requesting the document lane.
- When a `MessagePort` transfer fails partway (e.g. `session.connect` when the sync lane cannot attach), both halves of the `MessageChannelMain` must be closed, as the handler does — a leaked half keeps the channel alive with no owner.
- On macOS the app runs with zero windows after the last one closes. Menu commands can therefore fire with no focused window; the command context resolves the active window at run time and command implementations must tolerate its absence.
- In development `AppIcon.install()` resolves `../../icons` relative to `process.cwd()`, so the runtime Dock icon only resolves when Electron is launched with `apps/desktop` as the working directory (the `dev` script does this).
- Linux file associations use `application/x-shift-document`. electron-builder hardcodes generic document artwork for generated MIME definitions, so the DEB/RPM configuration packages explicit MIME XML and hicolor MIME icons instead.
- Windows keeps its per-user NSIS policy. The custom installer include registers Release as the `.shift` owner and Nightly only under Open With; do not replace it with electron-builder's documented per-machine-only association shortcut.

## Verification

- `pnpm --filter @shift/desktop test src/utility/workspace/WorkspaceHost.test.ts`
- `pnpm --filter @shift/desktop test src/renderer/src/lib/workspace/WorkspaceEditCoordinator.test.ts`
- `pnpm typecheck`
- `pnpm test:desktop src/main/update/updateFeed.test.ts`
- `pnpm test:release`
- Electron E2E fixtures materialize a native startup document under a fresh `testRoot`, launch with a fresh `userDataDir`, assert Electron honored that path, and remove the root after force-closing the disposable process.
- `document-lifecycle.spec.ts` injects ordered scripted paths/choices and verifies New/Open, convertible-preview Save and authored handoff, TTF/OTF exclusion, first and ordinary Save, independent Save As, saved-document discard/reopen, raw-copy identity reuse, Save cancellation/failure safety, dirty-close choices, clean quit/relaunch/reopen, and Export safety through application commands.
- `application-menu.spec.ts` invokes actual native menu items and verifies Help, Settings, canvas/interface zoom, launcher/binary/convertible/authored capability states, focused-text Copy/Paste, and canvas Select All, Copy, Paste, Undo, Redo, Delete, and Cut behavior.
- Manual: right-click an authored glyph canvas and verify the native menu opens at the pointer, each action targets that window, and no canvas menu appears on launcher or preview surfaces.
- `application-quit.spec.ts` verifies dirty Save/Discard/Cancel, every dirty document in a multi-document quit, re-entrant quit suppression, and document isolation across windows. Ordered scripted choices are consumed once per actual confirmation.
- `document-recovery.spec.ts` force-terminates Electron, reopens the same document and user-data directory, verifies recovery, then verifies explicit Save changes the canonical document.
- Standard workspace E2E fixtures launch Electron with a `.shift` command-line argument, so document activation owns the same document lifecycle coverage as File -> Open.
- Manual installed builds: double-click a `.shift` file on macOS, Windows, GNOME, and KDE; verify the document icon, first launch, existing-instance activation, and Release/Nightly handler priority.
- Manual: open the same `.shift` document twice and verify the existing workspace session is reused.
- Manual: edit a document, close the last window, and verify the save/discard prompt appears.
- Manual installed N → N+1: verify macOS arm64/x64 and unsigned Windows Nightly x64 consent, download progress, progress-window close/Cancel, retry, Later before and after download, **Restart and Install**, canceled document close, save, discard, install, and relaunch paths. Electron orchestration has no worthwhile unit test without mocking Electron, native dialogs, and electron-updater.

## Related

- `shared/workspace/protocol.ts` -- utility shell/sync channel types.
- `utility/workspace/WorkspaceHost.ts` -- utility-process owner of the Rust bridge and working documents.
- `@shift/bridge` -- runtime native bridge package.
