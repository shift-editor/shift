# Main

Electron main process managing application lifecycle, windows, menus, and document state.

## Overview

The main process is the entry point for the Shift Electron application. It uses a modular manager architecture to separate concerns: app lifecycle events, window management, menu creation, and document state tracking.

## Architecture

```
src/main/
├── main.ts                 # Entry point, wires managers together
└── managers/
    ├── AppLifecycle.ts     # App events (ready, quit, activate)
    ├── WindowManager.ts    # Window creation and IPC handlers
    ├── DocumentState.ts    # Dirty tracking, save dialogs, autosave
    ├── MenuManager.ts      # Menu creation and theme management
    └── index.ts            # Re-exports
```

### Manager Responsibilities

| Manager | Responsibility |
|---------|---------------|
| AppLifecycle | App events, quit coordination, dock icon, dev shortcuts |
| WindowManager | BrowserWindow creation, IPC handlers, title updates |
| DocumentState | Dirty state, file path, save dialogs, autosave |
| MenuManager | Application menu, theme switching |

### Data Flow

```
App Launch
    ↓
main.ts (wire managers)
    ↓
AppLifecycle.initialize()
    ├── app.on("ready") → MenuManager.create() + WindowManager.create()
    ├── app.on("before-quit") → DocumentState.confirmClose()
    └── app.on("will-quit") → cleanup shortcuts
    ↓
User Interaction
    ├── Menu actions → DocumentState (save/open)
    ├── Window close → DocumentState.confirmClose()
    └── Cmd+Q → triggers before-quit → DocumentState.confirmClose()
```

## Key Design Decisions

1. **No Global Cmd+Q Shortcut**: Uses standard macOS app menu quit instead. The `before-quit` event intercepts all quit attempts and checks for unsaved changes.

2. **Centralized Document State**: All dirty tracking and save dialogs go through `DocumentState`, ensuring consistent behavior regardless of how quit is triggered.

3. **Proper Quit Flow**: The `before-quit` handler prevents quit if document is dirty and user cancels. This fixes the zombie app state issue.

4. **Manager Dependencies**: Managers are instantiated with their dependencies via constructor injection, making the architecture testable.

## Key Concepts

### Quit Flow

When user triggers quit (Cmd+Q, menu, or window close):

1. `before-quit` event fires
2. `AppLifecycle` calls `DocumentState.confirmClose()`
3. If dirty, shows save dialog
4. User chooses: Save, Don't Save, or Cancel
5. Cancel prevents quit; others allow it

### Window Close vs App Quit

- **Window close** (red button): Handled by `WindowManager`, delegates to `DocumentState.confirmClose()`
- **App quit** (Cmd+Q): Handled by `AppLifecycle.before-quit`, same dialog flow

### Autosave

`DocumentState` manages a 30-second autosave interval. Autosave only triggers if:
- Document is dirty
- File path exists (not untitled)

## API Reference

### AppLifecycle

- `initialize()` - Register all app event handlers

### WindowManager

- `create()` - Create and configure main window
- `getWindow()` - Get current BrowserWindow
- `setQuitting(boolean)` - Mark app as quitting to skip close dialogs
- `destroy()` - Clean up and destroy window

### DocumentState

- `isDirty()` / `setDirty(boolean)` - Dirty state
- `getFilePath()` / `setFilePath(string)` - Current file
- `save(saveAs?: boolean)` - Save document
- `confirmClose()` - Show save dialog if dirty, returns whether to proceed
- `startAutosave()` / `stopAutosave()` - Autosave management

### MenuManager

- `create()` - Build and set application menu
- `getTheme()` / `setTheme(theme)` - Theme management

## IPC Handlers

| Channel | Handler | Description |
|---------|---------|-------------|
| `window:close` | WindowManager | Close main window |
| `window:minimize` | WindowManager | Minimize window |
| `window:maximize` | WindowManager | Toggle maximize |
| `window:isMaximized` | WindowManager | Check maximize state |
| `document:setDirty` | WindowManager | Update dirty state |
| `document:setFilePath` | WindowManager | Update file path |
| `document:saveCompleted` | WindowManager | Handle save completion |
| `theme:get` | AppLifecycle | Get current theme |
| `theme:set` | AppLifecycle | Set theme |
| `dialog:openFont` | AppLifecycle | Show open dialog |

## Related Systems

- [preload](../../preload/docs/DOCS.md) - Native API bridge
- [engine](../../renderer/src/engine/docs/DOCS.md) - Uses exposed APIs
