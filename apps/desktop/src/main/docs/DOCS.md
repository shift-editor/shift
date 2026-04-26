# Main

Electron main process: application lifecycle, window management, menus, document state, and external file opening.

## Architecture Invariants

- **Architecture Invariant:** All managers receive dependencies via constructor injection in `main.ts`. `DocumentState` is the root dependency; `WindowManager` depends on it; `MenuManager` depends on both; `AppLifecycle` depends on all three.
- **Architecture Invariant:** `DocumentState` is the single source of truth for dirty state and file path. All save/close dialogs flow through `DocumentState.confirmClose`. No manager may show its own save dialog.
- **Architecture Invariant:** IPC channels are type-safe. All `ipcMain.handle` calls use the typed `ipc.handle` wrapper from `shared/ipc/main`, and all `webContents.send` calls use the typed `ipc.send` wrapper. Channel names and payload types are defined in `IpcCommands` (renderer-to-main) and `IpcEvents` (main-to-renderer).
- **Architecture Invariant: CRITICAL:** `main.ts` enforces a single-instance lock via `app.requestSingleInstanceLock()`. The second instance forwards its argv to the first instance via the `second-instance` event and then quits. Removing this breaks file-association double-click on all platforms.
- **Architecture Invariant: CRITICAL:** The `before-quit` handler in `AppLifecycle` must call `event.preventDefault()` before the async `confirmClose` check. If the guard is removed, the app quits before the save dialog can appear.
- **Architecture Invariant:** Only `.ufo` is a writable format (`DocumentState.isWritableFormat`). Saving a non-UFO file always triggers Save As. Autosave skips non-UFO files silently.

## Codemap

```
src/main/
  main.ts                       # Entry point: single-instance lock, manager wiring
  managers/
    AppLifecycle.ts              # App events, quit flow, external file open queue, IPC for theme/dialog/debug/fs
    WindowManager.ts             # BrowserWindow creation, close handling, IPC for window/document channels
    DocumentState.ts             # Dirty tracking, file path, save/confirmClose dialogs, autosave
    MenuManager.ts               # Application menu (File/Edit/View/Debug), theme switching, zoom, debug overlays
    openFontPath.ts              # Font path validation and argv extraction
    openFontPath.test.ts         # Tests for openFontPath
    index.ts                     # Re-exports
```

## Key Types

- `ThemeName` -- `"light" | "dark" | "system"`, stored in `MenuManager.currentTheme`
- `Debug` -- aggregates `reactScanEnabled`, `debugPanelOpen`, and `DebugOverlays`; only used in dev builds
- `DebugOverlays` -- per-overlay booleans (`tightBounds`, `hitRadii`, `segmentBounds`, `glyphBbox`)
- `IpcCommands` -- renderer-to-main request/response channels (invoke/handle)
- `IpcEvents` -- main-to-renderer broadcast channels (send/on)
- `SUPPORTED_FONT_EXTENSIONS` -- the set of file extensions accepted for opening (`.ufo`, `.ttf`, `.otf`, `.glyphs`, `.glyphspackage`)

## How it works

### Startup

`main.ts` checks `electron-squirrel-startup` (Windows installer events), then acquires a single-instance lock. If this is the second instance, it quits and the first instance receives `second-instance` with the new argv. Otherwise, it constructs the four managers and calls `AppLifecycle.handleLaunchArgs` (to queue any CLI font path) then `AppLifecycle.initialize`.

### Window creation

`WindowManager.create` builds a frameless `BrowserWindow` (hidden traffic lights, custom title bar), maximizes it, wires `DocumentState` for title updates, starts autosave, and loads the Vite dev server URL or the built `index.html`. The window's `close` event delegates to `DocumentState.confirmClose` when dirty.

### Quit flow

Any quit trigger (Cmd+Q, menu, window close button) eventually hits `AppLifecycle`'s `before-quit` handler. It calls `event.preventDefault()`, runs the async `DocumentState.confirmClose` dialog, and only if the user confirms does it set `isQuitting = true`, mark `WindowManager` as quitting (to skip the per-window close dialog), stop autosave, and call `app.quit()` again.

### External file opening

Files arrive via three paths: CLI launch args (`handleLaunchArgs`), second-instance argv (`handleSecondInstance`), and macOS `open-file` events. All three funnel through `enqueueExternalOpenPath`, which validates via `normalizeFontPath` and pushes to `pendingExternalOpenPaths`. The queue is drained serially by `processPendingExternalOpenPaths`, which waits for the window to finish loading, then calls `openExternalFont`. If the current document is dirty, `confirmClose` runs first; on confirmation the path is sent to the renderer via the `external:open-font` IPC event.

### Save and autosave

`DocumentState.save` checks `isWritableFormat` -- only `.ufo` can be saved in-place. Non-UFO files and Save As always show the save dialog with a UFO filter. On save, the main process sends `menu:save-font` to the renderer, which does the actual write and calls back `document:saveCompleted`. Autosave runs on a 30-second interval (`AUTOSAVE_INTERVAL_MS`) and only fires if dirty and the file is writable UFO.

### Menu

`MenuManager.create` rebuilds the entire menu template each time it is called (to update radio/checkbox state). It includes File (open/save), Edit (undo/redo/delete/select-all forwarded to renderer), View (zoom, theme, devtools), and a Debug menu (only in dev builds) for React Scan, debug panel, snapshot dumps, and overlay toggles.

### IPC registration

IPC handlers are split across managers. `WindowManager` registers window-control and document-state channels in its constructor. `AppLifecycle` registers theme, debug, dialog, and filesystem channels in `registerIpcHandlers`.

## Workflow recipes

### Add a new IPC command (renderer calls main)

1. Add the channel signature to `IpcCommands` in `shared/ipc/channels.ts`.
2. Add the handler using `ipc.handle(ipcMain, "your:channel", ...)` in whichever manager owns the domain.
3. Expose it in the preload layer (see preload DOCS.md).

### Add a new main-to-renderer event

1. Add the channel signature to `IpcEvents` in `shared/ipc/channels.ts`.
2. Send via `ipc.send(webContents, "your:channel", ...)` from a manager.
3. Listen in the renderer via the preload bridge.

### Add a menu item

1. Add a new entry in `MenuManager.create`'s template array under the appropriate submenu.
2. If it triggers a renderer action, add a channel to `IpcEvents` and call `this.sendToRenderer(...)`.
3. Call `this.create()` if the menu item state needs to update after clicking (checkboxes, radios).

### Support a new writable format

1. Update `DocumentState.isWritableFormat` to accept the new extension.
2. Update the save dialog filter in `DocumentState.save`.
3. Update `SUPPORTED_FONT_EXTENSIONS` in `openFontPath.ts` if the format should also be openable.

## Gotchas

- `MenuManager.create` rebuilds the entire Electron menu from scratch. This is intentional -- Electron menus are immutable once built. Mutating the template object has no effect; you must call `Menu.setApplicationMenu` again.
- The `before-quit` handler uses a re-entrant pattern: it prevents quit, does async work, then calls `app.quit()` again with `isQuitting = true` to skip the guard on the second pass. Breaking this flag logic causes an infinite quit loop.
- `WindowManager` registers its IPC handlers in the constructor, before `create` is called. This means `this.window` is null during handler registration and handlers must null-check it.
- The Debug menu is conditionally included only when `!app.isPackaged`. Debug IPC handlers are always registered regardless, but they are harmless in production since no menu triggers them.
- `processPendingExternalOpenPaths` is designed to be re-entrant safe via the `processingExternalOpenPath` flag. It processes one file at a time and recurses through `.finally()`.

## Verification

- `npx vitest run apps/desktop/src/main/managers/openFontPath.test.ts` -- openFontPath unit tests
- Manual: launch with a font path argument, verify it opens
- Manual: edit a document, Cmd+Q, verify save dialog appears
- Manual: open a .ttf, Cmd+S, verify Save As dialog forces .ufo

## Related

- `IpcCommands`, `IpcEvents` -- type-safe IPC channel definitions in `shared/ipc/channels.ts`
- `ipc.send`, `ipc.handle` -- typed wrappers in `shared/ipc/main.ts`
- `ThemeName`, `Debug`, `DebugOverlays` -- shared types in `shared/ipc/types.ts`
- Preload bridge -- exposes IPC to renderer (see preload DOCS.md)
