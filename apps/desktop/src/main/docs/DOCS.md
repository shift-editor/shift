# Main

<!-- reviewed: 2026-10-04 -->

Electron main process: app startup, windows, menus, document dialogs, and workspace session ownership.

## Architecture Invariants

- **Architecture Invariant:** `WorkspaceManager` owns live font sessions. Windows attach to sessions; commands and IPC resolve the session from the focused window or sender. A desktop session's immutable mode is `"workspace"` or `"preview"`.
- **Architecture Invariant:** Every font session owns one `WorkspaceProcess`. Workspace sessions additionally own one `DocumentClient` and one `DocumentSession`; preview sessions deliberately have no authored document, persistence, dirty state, save target, or export workflow. Main never reads or mutates font data directly.
- **Architecture Invariant:** Every non-`.shift` font path opens as an immutable preview session. It uses the shared renderer sync lane and `/home` route, but never allocates a SQLite working document or authored Shift model.
- **Architecture Invariant:** Save or Save As may convert UFO, Designspace, Glyphs, and Glyphspackage previews into a new workspace session. The preview itself never changes mode: `workspace.createFromSource` fully imports and atomically publishes a separate canonical document, then main reattaches and reloads the active window. Source glyph IDs are derived from the canonical source path and glyph name (`SourceGlyphIds`), so the preview and the converted document agree on every glyph and the reloaded editor route survives conversion. The renderer replaces a route whose glyph identity does not belong to the workspace session with Home. Cancel or failure leaves the preview and destination unchanged. TTF and OTF previews cannot convert.
- **Architecture Invariant:** Dirty state and save targets come from the utility-owned workspace state. Main obtains native choices through `NativeDialogs`, but state reads, saves, and exports go through the renderer document lane so pending edits flush first. Production uses Electron dialogs; E2E injects deterministic choices at this outer boundary.
- **Architecture Invariant:** Desktop dialog, update, crash, and settings-failure copy is keyed in `src/shared/messages/en.json` and formatted through `message()`. Native and recoverable failures never interpolate raw diagnostics; React error boundaries retain full diagnostics behind an explicit **Show details** disclosure and in renderer error reports.
- **Architecture Invariant:** TTF export snapshots the workspace in the ordered sync lane, then releases that lane before font compilation so subsequent editing is not blocked by fontc.
- **Architecture Invariant:** Within one app instance, at most one live or in-flight session owns a `DocumentId`. Different documents open concurrently; a raw filesystem copy retains its identity and therefore reuses the existing session until Save As mints an independent `DocumentId`.
- **Architecture Invariant:** `DocumentSession.prepareClose(reason)` may prompt and save, but it never closes a workspace. Overlapping Window Close, Quit, and Restart to Update requests for one document share one retained preparation; the first request owns the reason and native dialog until cancellation, failure, or commit cleanup resets it. Window close prepares and commits its one document. Quit and update restart prepare every document before committing any; cancellation calls `cancelClose()` on every prepared document. Joined `commitClose()` calls share one workspace close, which is the point of no return and clears recovery only for an explicit discard.
- **Architecture Invariant:** In unpackaged development runs, `SIGINT` and `SIGTERM` enter `AppLifecycle`'s irreversible `terminating` state and force-kill main without document preparation or Electron teardown. Recovery prompts and retries stop; completed recovery transactions remain on disk, but in-flight edits are not guaranteed to survive. Ordinary Quit and packaged-app signal handling are unchanged.
- **Architecture Invariant:** Documents open when Shift stops without an ordinary quit reopen on the next launch, matching macOS document apps: a crash, forced termination, or update restart restores them, while Cmd+Q starts fresh. `RecentDocuments` keeps an `open` mark on each entry while its session lives; ending a session outside a quit clears it, and `will-quit` clears every mark only when `AppLifecycle.quitReason` is `"quit"`. Startup takes the marks before recovery discovery, because restoring a document marks it open again.
- **Architecture Invariant:** Main never tracks which glyph a window shows. Crash reopen, recovery, and launch reopen load `#/home?resume`; the renderer owns per-viewer view memory in `localStorage` (`DocumentViews`, keyed by `DocumentId` or untitled workspace) and `useDocumentViewMemory` returns the window to its last glyph. View state is personal, so it never enters the `.shift` document, and normal opens deliberately land on Home.
- **Architecture Invariant:** Closing every window keeps the application alive on macOS. Activating the windowless app opens a fresh launcher; Windows and Linux quit after the last window closes.
- **Architecture Invariant:** Release and Nightly builds have distinct product identities and app-data roots. `Shift` uses `app.shift` and the `Shift` data root; `Shift Nightly` uses `app.shift.nightly` and the `Shift Nightly` data root. An explicit `--user-data-dir` switch takes precedence for tests and diagnostics.
- **Architecture Invariant:** Shift is single-instance within one distribution data root. Operating-system font activations received before readiness queue in order; later activations focus an already-open document or create another workspace window. Release owns the `.shift` document association, while Nightly remains an alternate; both distributions are alternate macOS handlers for supported source fonts.
- **Architecture Invariant:** `AppUpdater` owns application update state in main. It selects only the fixed electron-updater metadata channel for the compiled distribution and exact platform/architecture, requires consent before downloading, deduplicates checks/downloads/restarts, and cannot call `quitAndInstall()` until `AppLifecycle` commits every document. `UpdateWindow` reflects main-owned progress and ready state but never owns updater transitions. macOS Release/Nightly, Windows Nightly x64, and Linux x64 AppImages in a writable folder update automatically. Windows Release and read-only AppImages use distribution-matched manual downloads; DEB and RPM installs are directed to their package manager.
- **Architecture Invariant:** Disposable Slug pages live under the app-wide `derived-cache/slug-atlases` root beside `working-documents`, never inside authored `.shift` content. Utility processes share the one-GiB byte-budgeted LRU; each process validates an artifact index once and then verifies and decompresses its fixed pages independently. Staging paths use readable `run-{pid}-{id}/page-{index}-{id}.zst` names, and every retry owns a distinct file until publication. The LRU scans after an artifact is opened or published, never after every page stream. Stale, corrupt, and evicted entries rebuild.
- **Architecture Invariant:** Recovery discovery prunes only storage that cannot contain authored work: empty workspace directories, document bindings with no working store or recovery overlay, and SQLite sidecars whose primary file is absent. Working stores and recovery overlays are recoverable and never expire by age. A stale binding whose exact recovery overlay is absent is detached from a surviving working store so unsaved-workspace discovery can recover that store. Malformed or unknown artifacts are retained and reported rather than deleted.
- **Architecture Invariant:** IPC channels are type-safe. `ipcMain.handle` calls use the typed wrapper from `shared/ipc/main`, and channel names and payload types live in `shared/ipc/contract.ts` and `shared/workspace/protocol.ts`.
- **Architecture Invariant:** Main owns one local MCP server per app instance. It binds only to loopback on the distribution's fixed port (Shift `17461`, Nightly `17462`, Dev `17463`, Nightly Dev `17464`; E2E uses an explicit ephemeral port), retains a private bearer token under the distribution-specific user-data root across launches, resolves every request through an explicit window/session identity, routes revision-correlated renderer observations over a per-window typed request lane, and captures only that resolved window. Renderer-reported editor bounds select the editor-only crop; Electron main owns pixel capture and serialization and verifies the authored revision before and after capture. Port collisions disable MCP without stopping the app-owned sandbox or preventing the app from opening.
- **Architecture Invariant:** Code submitted to the Shift sandbox never executes in Electron main or a renderer. `SandboxRuntimeProcess` is app-owned, supervises a dedicated utility process, serves only typed capabilities back into main, and terminates the process when a hard execution deadline expires; the next execution restarts it. No long-lived interactive plugin execution mode exists yet.

## Codemap

```text
src/main/
  main.ts                         -- Electron entry point
  AsyncOnce.ts                    -- resettable retained asynchronous one-shot
  release.ts                      -- compiled distribution identity and product name
  about/
    AboutWindow.ts                -- singleton product information window
  feedback/
    FeedbackWindow.ts             -- singleton modeless feedback composer window
  agent/
    AgentClient.ts                -- main client for one renderer's live inspection lane
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
  sandbox/
    SandboxRuntimeProcess.ts       -- isolated code runtime lifecycle and capability lane
  update/
    AppUpdater.ts                  -- update orchestration, scheduling, consent, and restart safety
    UpdateWindow.ts                -- download progress and install prompt window
    linuxInstallation.ts           -- classifies AppImage and system-package Linux installs
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

- `AsyncOnce` -- resettable one-shot that retains the exact pending or settled promise until explicit cleanup.
- `WorkspaceManager` -- registry for live authored documents, immutable preview sessions, and window attachments.
- `FontSessionHost` -- owns the immutable mode, utility process, optional authored document services, and attached windows for one open font.
- `DocumentSessionIndex` -- maps each live `DocumentId` to one app-local workspace session and follows Save As identity changes.
- `WorkspaceProcess` -- starts the utility process and exposes shell-lane calls such as create, inspect document, open, close, and document state.
- `DocumentClient` -- request client for renderer-served document state/save calls.
- `NativeDialogs` -- injected outer boundary for Open, Save As, Export, dirty-close choices, and failure messages.
- `DocumentSession` -- native document workflow for Save, Save As, Export TrueType, and close confirmation.
- `AppLifecycle` -- coordinates Electron window close, app quit, and update restart around document vetoes; `quitReason` is set only once every document has agreed to the quit.
- `RecentDocuments` -- main-owned recent-file list; also marks which documents are open so an interrupted session can reopen them.
- `AppUpdater` -- main-process owner of native feed selection, Electron auto-update events, consent, cancellation, and restart safety.
- `UpdateWindow` -- renderer of download progress and ready-to-install choices.
- `FeedbackWindow` -- singleton modeless composer that routes user-authored feedback to email, GitHub, or Discord without collecting files or diagnostics.
- `UpdateStatus` -- updater lifecycle: idle, checking, available, downloading, ready, or restarting.
- `ShiftMcpServer` -- local code-mode MCP adapter over explicitly targeted live app capabilities.
- `SandboxRuntimeProcess` -- utility-process supervisor for bounded generated-code execution and typed capability callbacks.
- `AgentClient` -- per-window main-process client for renderer-owned editor observations.
- `WorkspaceDocumentState` -- utility-owned lifecycle state mirrored into main and renderer.

## How it works

### Startup

`main.ts` constructs `App` and calls `start()`. `App.start()` applies the compiled `SHIFT_DISTRIBUTION` identity before its first log entry or path-dependent service action, so logging, settings, caches, and recovery all resolve beneath the correct app-data root. Startup recovery discovery calls `DocumentStorage.pruneOrphanedStorage()` before enumerating recoverable work; this cleanup is structural rather than age-based and never removes a recognized working store or recovery overlay. The production/E2E build and development-only Forge runner write the `main_window` renderer to `.vite/renderer/main_window`; production resolves that same directory through `MAIN_WINDOW_VITE_NAME`. `App` registers commands and IPC handlers, starts `AppLifecycle`, starts the sandbox utility process before publishing the MCP descriptor, sets the user-data-backed `working-documents` root, creates the launcher window, and installs the application menu. Development uses `Shift Dev` or `Shift Nightly Dev`; an explicit standard `--user-data-dir` switch takes precedence so E2E runs can own isolated browser and working-document state.

The runtime icon follows the same compiled identity: `AppIcon` selects `nightly-macos.png` when `shiftDistribution` is `"nightly"` and `icon-macos.png` otherwise, so Release and Nightly are visually distinct in the development macOS Dock. Packaged installer icons remain owned by electron-builder configuration. The renderer's shared `app-icon.png` supplies the custom About and Update screens. Both distributions use the shared `shift-document` artwork for `.shift` files; association priority, not document appearance, distinguishes their ownership. Packaged macOS builds also declare TTF, OTF, Glyphs, Glyphspackage, UFO, and Designspace sources as alternate viewer types so Finder recommends Shift under **Open With** without making it the default source-font application.

`App.start()` establishes the distribution-specific data root before taking Electron's single-instance lock. macOS `open-file`, first-instance command-line arguments, and subsequent `second-instance` arguments feed one ordered pending-path queue. Startup drains that queue before deciding whether a launcher is needed. All activation entry points use the same `OPEN_FONT_EXTENSIONS` list as the native Open dialog, accepting `.shift`, TTF, OTF, Glyphs, Glyphspackage, UFO, and Designspace paths case-insensitively; unsupported extensions are ignored.

On macOS, closing the last window leaves Shift running. A later Dock activation opens a new launcher window. The launcher opens at a compact 800×600 native size instead of inheriting the workspace window's 1200-pixel minimum width. Windows and Linux keep the conventional quit-on-last-window behavior.

### Application Commands

Native menu items combine the shared `CommandId` and `commandShortcuts` chord with the label and current capability from `CommandRegistry`. `toElectronAccelerator` converts that platform-neutral chord for Electron, while renderer keyboard routing consumes the same chord when web content has focus. `ApplicationMenu.updateCommandStates()` refreshes enabled state when window focus or session ownership changes and after a command settles. `app.showAbout` opens or focuses the singleton fixed-size custom About window; it displays the embedded `SHIFT_BUILD_COMMIT`, links that identifier to GitHub, and opens renderer-declared HTTPS destinations through Electron's shell boundary. Save and Save As are enabled for authored documents and convertible previews; Export and Edit commands require an authored document.

Edit-menu accelerators and clicks send `RendererCommandId` operations to the active authored renderer instead of using Electron's DOM-only roles. The renderer preserves conventional behavior for a focused text input; otherwise Undo, Redo, Cut, Copy, Paste, Delete, and Select All operate on Shift's canvas editor and canonical workspace history. Commands may remain enabled within an authored document when its current selection, clipboard, or history makes a particular invocation a safe no-op.

The View menu reserves conventional Zoom In and Zoom Out labels and shortcuts for the glyph canvas. Browser-window scaling is exposed separately as Interface Size with Alt-modified shortcuts, preventing native accelerators from intercepting canvas zoom. Canvas and object-tree context menus are renderer-owned Base UI surfaces that reuse the shared menu styling; their items invoke the same command registry used by the native application menu. The canvas derives Make First Point eligibility for exactly one selected on-curve point in an active authored closed contour, and command execution revalidates the current selection before rotating the contour's point order. Object-tree rows establish or preserve their editor selection before opening their Delete menu; focused rows also route Backspace and Delete through the same editor deletion path.

The macOS Window menu is registered through Electron's native `windowMenu` role so AppKit owns system placement, tiling, and open-window affordances. **Home** focuses an existing launcher or creates one without replacing the current document window. **Settings…** sends `app.showSettings` to the active font renderer and opens the existing document-scoped settings surface at Font; it remains unavailable on the launcher until Shift has app-wide settings.

Eligible packaged macOS builds, Windows Nightly x64 builds, and replaceable Linux AppImages start `AppUpdater` after the first window is prepared. The updater waits 30 seconds before its first quiet check to avoid competing with application startup, then checks every four hours. Development builds explain that updates require packaging; Windows Release and read-only AppImages direct manual checks to matching GitHub downloads, and DEB/RPM installs to their package manager.

### Application Updates

`AppUpdater.checkForUpdates(trigger)` derives a fixed HTTPS generic-provider URL from the compiled Release or Nightly distribution and exact platform/architecture. electron-updater reads architecture-specific `latest-mac.yml` on macOS, `latest.yml` for Windows Nightly, and `latest-linux.yml` for AppImages. `detectLinuxInstallation` gates Linux: only an AppImage whose folder is writable receives a feed, because electron-updater replaces the AppImage by deleting and recreating it, and DEB/RPM installs (marked by `resources/package-type`) must never select electron-updater's privileged package installers. It owns numeric version comparison, SHA-512 verification, download, macOS code-signature verification, Authenticode verification when configured, installation, and relaunch. Release and Nightly never share feed paths.

Automatic current/error results stay quiet. When a check finds an update, the update window offers **Download Update** / Later; declining leaves the version available without prompting again during periodic checks. An accepted download replaces those choices with cumulative progress. Closing the window or choosing Cancel cancels the transfer and returns to available. Download completion replaces progress with **Restart and Install** / Later, and a manual check while available or ready reopens the relevant choice. Later retains a verified download without silently installing it on ordinary quit. Restart prepares every document, cancels all prepared closes if one vetoes, commits every agreed close, and only then calls `quitAndInstall()`. A preparation or workspace-close failure blocks installation, remains technical in the log, and presents actionable document-save guidance rather than workspace internals. Electron closes windows before normal `before-quit`, so `AppLifecycle`'s `confirmed` state allows those closes. An install failure after commit relaunches the currently installed application; closed in-memory sessions are never reconstructed.

The application menu exposes `app.checkForUpdates` under the macOS app menu and the Windows/Linux Help menu. Every platform's Help menu also opens the Shift website, Discord, and X account. Its adjacent support actions open the dedicated public Bug report form, reveal electron-log's active file in the platform file manager, or open a singleton modeless feedback composer. The composer retains its draft while open and routes only user-authored text to the mail client; GitHub and the Discord feedback channel remain explicit alternatives. Closing discards the draft. Users review and attach logs manually; Shift does not read or upload their files. Update behavior remains main-owned and does not add renderer IPC.

### Workspace Creation And Open

File -> New asks `WorkspaceManager.createUntitled()` for a session. File -> Open asks `NativeDialogs.openFont()` for a path and then asks `WorkspaceManager.openPath(path)`. Native document and source-font activation uses that same `openPath` boundary: an existing document session is focused, a launcher is replaced, or a new workspace window is added without closing another document. When no window is focused, external activation still uses an existing launcher as its opener rather than leaving it behind.

For every non-`.shift` font path, `WorkspaceManager` opens one immutable retained source in the utility process and registers a `"preview"` session without a document lane. Save and Save As are available for UFO, Designspace, Glyphs, and Glyphspackage previews. After the user chooses a `.shift` destination, `WorkspaceManager.createDocumentFromPreview` starts a separate utility process; `workspace.createFromSource` eagerly imports the complete foreign source and atomically publishes a canonical document. Main then detaches the active window from the preview, attaches it to the new `"authored"` session, disposes an unreferenced preview, and reloads the renderer. The original source is never modified. TTF and OTF remain read-only previews with Save disabled. For `.shift` paths, `WorkspaceManager` starts a provisional utility process and calls `workspace.inspectDocument` before opening. If a live session already owns the same `DocumentId`, the provisional process is stopped and the existing session is returned. Concurrent requests for that identity share one in-flight open, so only one utility process may publish its recovery binding. Otherwise the utility opens the canonical SQLite file directly against the bound app-owned sparse overlay and registers the resulting workspace state. Path-specific bindings distinguish a closed document move from a raw copy: one missing old path can rebind its recovery, while an extant original path prevents its recovery from being attached to the copy. Main does not start monolithic Slug preparation: the renderer requests the complete fixed-page set before its first Grid presentation. The utility opens and validates a matching cache artifact once, serves independently verified Zstd pages through the bounded stream contract, or compiles native misses and stages them for atomic publication. Page boundaries keep compilation, streaming, cache replacement, and local edit invalidation bounded without putting page acquisition on the scroll path.

### Window Attachment

`App` creates a BrowserWindow, attaches it to the returned `FontSessionHost`, and loads the workspace route. Multiple windows may attach to the same session. Closing one of several windows does not close the document; closing the last window does.

Windows created after an interruption (crash or render-failure reopen, recovery discovery, and documents still marked open at launch) load `#/home?resume` instead of `#/home`. A document that recovery already restored has a window, so the launch reopen skips it rather than attaching a second one.

### Save, Export, And Close

For workspace sessions, Save and Save As start in `DocumentSession`, which obtains destinations and confirmations through `NativeDialogs`; the actual save request goes through `DocumentClient` to the renderer document lane. The renderer flushes queued edits through the workspace sync lane before calling `workspace.save` or `workspace.saveAs`.

Convertible previews have no renderer document lane or pending edits. `App.savePreviewAsDocument` obtains the destination first, deduplicates the `"converting"` operation per preview session, and asks `WorkspaceManager.createDocumentFromPreview` to publish the first canonical document through the shell lane. Cancellation does no import work. Import or publication failure removes temporary workspace state, preserves an occupied destination, reports the save error, and keeps the preview attached.

Export TrueType follows the same document and sync lanes. The utility process captures an immutable native snapshot after prior edits, then awaits direct Shift IR-to-fontc compilation outside the workspace queue. Edits submitted after snapshot capture can proceed and are not included in that export. Export does not change the document binding or dirty state.

For a document-backed workspace, Save first reconciles the current canonical commit and then commits only its sparse recovery rows. A changed commit becomes `Conflict` rather than accepting a stale Save. Save As snapshots the merged view to a new canonical `DocumentId`, installs a fresh recovery overlay, and rebinds the existing app-local workspace session. The source canonical document remains unchanged.

Close and quit call `DocumentSession.prepareClose`. The first request retains ownership from state settlement through the native decision and any save; later Window Close, Quit, or Restart to Update requests join that exact result even after it settles but before commit. Cancel and failed preparation reset the transition. If the document is clean, the user saves successfully, or the user chooses discard, the session records the close intent without closing the workspace. Once the whole transition is accepted, joined `commitClose` calls await one `workspace.close`; an explicit discard first clears native recovery state. Completed and failed commit cleanup reset the retained transition. The utility then drops the Rust workspace handle, removes the document binding, and deletes the app-owned workspace directory. A crash or forced termination bypasses this cleanup, allowing the next open of the same document address to resume completed recovery transactions.

Development terminal termination is separate from ordinary Quit: `AppLifecycle.terminate()` may supersede `idle`, `confirming`, or `confirmed`, with no transition out of `terminating`. Signal listeners are installed on `ready`, after Electron installs its own POSIX handlers. Main sends itself `SIGKILL` rather than calling `app.quit()` or `app.exit()`: the former prompts to save, while the latter still runs Chromium teardown and can restart children killed by a process-group signal. The parent dev command therefore observes a killed process, not a successful exit code. No Save, Discard, or workspace-close cleanup is started by termination; the next launch owns recovery of completed transactions.

Message lanes reject in-flight calls when their remote port closes. An unexpected utility-process exit also disconnects the renderer document lane: Save remains blocked because pending edits cannot be settled, while an explicit Discard treats the unavailable workspace as already closed so window and quit guards can finish.

### IPC

Renderer IPC in `App` is limited to shell capabilities: command execution, clipboard, update-window progress/actions, optional document-lane and agent-lane port transfer, immutable session mode, readiness, and shared session sync-lane port transfer. Font data stays on the sync lane between renderer and utility. The agent lane returns renderer-owned view facts, authored revision checks, editor capture bounds, read-only font/location/glyph projections, nested authored layers, resolved layer geometry, and portable point-in-time SVG. Layer reads address one stable `LayerId` and go through the serialized sync lane to one native accepted-state query (`workspace.layers.read` / `workspace.layers.resolve`); Rust resolves components at the layer's own source, so the renderer neither loads glyph models nor sees gesture previews. In the renderer, `AgentBridge` owns only the port and revision guard; `ShiftFontReader` serves the reads, and `ShiftLayer` wraps one layer read so `layers.get`, `layers.resolve`, and `layers.render` all derive from it. Main resolves the explicit window and session before routing each MCP call; editor observations also carry their window and session identities. Window and editor screenshots use `webContents.capturePage()` and return immutable PNG values with unique capture IDs inside the same revision observation contract. A capture ID identifies an image; the surrounding opaque font revision correlates authored state and is verified before and after pixel capture.

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
- macOS source-font associations must remain alternate viewers. Shift previews imported sources and only edits a separate canonical `.shift` document, so claiming editor or owner rank would misrepresent the persistence boundary.
- Linux file associations use `application/x-shift-document`. electron-builder hardcodes generic document artwork for generated MIME definitions, so the DEB/RPM configuration packages explicit MIME XML and hicolor MIME icons instead.
- Windows keeps its per-user NSIS policy. The custom installer include registers Release as the `.shift` owner and Nightly only under Open With; do not replace it with electron-builder's documented per-machine-only association shortcut.

## Verification

- `pnpm test:desktop src/utility/workspace/WorkspaceHost.test.ts`
- `pnpm test:desktop src/renderer/src/lib/workspace/WorkspaceEditCoordinator.test.ts`
- `pnpm typecheck`
- `pnpm test:desktop src/main/AsyncOnce.test.ts src/main/document/DocumentSession.test.ts src/main/app/AppLifecycle.test.ts src/main/recents/RecentDocuments.test.ts`
- `pnpm test:desktop src/main/update/updateFeed.test.ts`
- `pnpm test:release`
- Electron E2E fixtures materialize a native startup document under a fresh `testRoot`, launch with a fresh `userDataDir`, assert Electron honored that path, and remove the root after force-closing the disposable process.
- `document-lifecycle.spec.ts` injects ordered scripted paths/choices and verifies New/Open, convertible-preview Save and authored handoff, TTF/OTF exclusion, first and ordinary Save, independent Save As, saved-document discard/reopen, raw-copy identity reuse, Save cancellation/failure safety, dirty-close choices, clean quit/relaunch/reopen, and Export safety through application commands.
- `application-menu.spec.ts` invokes actual native menu items and verifies Help, Settings, canvas/interface zoom, launcher/binary/convertible/authored capability states, focused-text Copy/Paste, and canvas Select All, Copy, Paste, Undo, Redo, Delete, and Cut behavior.
- Manual: right-click an authored glyph canvas or object-tree row and verify the shared Base UI menu opens at the pointer, its actions target the current editor selection, and no canvas menu appears on launcher or preview surfaces.
- `application-quit.spec.ts` verifies dirty Save/Discard/Cancel, every dirty document in a multi-document quit, re-entrant quit suppression, and document isolation across windows. Ordered scripted choices are consumed once per actual confirmation. POSIX signal cases exercise `SIGINT` and `SIGTERM` against main and its entire process group with native dialogs enabled, verifying prompt-free forced exit, unchanged canonical files, and recovery of both dirty documents. Another case interrupts an outstanding quit preparation and verifies recovery without saving or discarding.
- `document-recovery.spec.ts` force-terminates Electron, reopens the same document and user-data directory, verifies recovery, then verifies explicit Save changes the canonical document. It also verifies a clean document open on a glyph reopens on that glyph after forced termination.
- `document-crash.spec.ts` crashes a document renderer and verifies the reopened window returns to the glyph it was editing.
- Standard workspace E2E fixtures launch Electron with a `.shift` command-line argument, so document activation owns the same document lifecycle coverage as File -> Open. `document-lifecycle.spec.ts` also covers all six source formats through cold-start arguments and real second-instance launches, launcher replacement, existing-document preservation, uppercase extensions with spaces, and unsupported-extension fallback.
- Manual installed builds: double-click a `.shift` file on macOS, Windows, GNOME, and KDE; verify the document icon, first launch, existing-instance activation, and Release/Nightly handler priority.
- Manual installed macOS builds: right-click TTF, OTF, Glyphs, Glyphspackage, UFO, and Designspace sources and verify Shift appears under **Open With** without replacing the current default application.
- Manual: open the same `.shift` document twice and verify the existing workspace session is reused.
- Manual: edit a document, close the last window, and verify the save/discard prompt appears.
- Manual installed N → N+1: verify macOS arm64/x64 and unsigned Windows Nightly x64 consent, download progress, progress-window close/Cancel, retry, Later before and after download, **Restart and Install**, canceled document close, save, discard, install, and relaunch paths. Electron orchestration has no worthwhile unit test without mocking Electron, native dialogs, and electron-updater.

## Related

- `shared/workspace/protocol.ts` -- utility shell/sync channel types.
- `utility/workspace/WorkspaceHost.ts` -- utility-process owner of the Rust bridge and working documents.
- `@shift/bridge` -- runtime native bridge package.
