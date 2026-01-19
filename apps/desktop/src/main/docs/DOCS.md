# Main

Electron main process managing application lifecycle, windows, and global shortcuts.

## Overview

The main process is the entry point for the Shift Electron application. It handles BrowserWindow creation, app lifecycle events, global keyboard shortcuts, and coordinates with the preload script for native module access.

## Architecture

```
Electron App
├── app.whenReady() → createWindow()
├── BrowserWindow
│   ├── webPreferences.preload → preload.js
│   └── loadURL/loadFile → renderer
├── globalShortcut
│   ├── Cmd/Ctrl+Shift+R → reload
│   └── Cmd/Ctrl+Q → quit
└── app events
    ├── window-all-closed → quit (non-macOS)
    ├── activate → recreate window (macOS)
    └── will-quit → cleanup shortcuts
```

### Key Design Decisions

1. **Single Window**: One main BrowserWindow, maximized on creation
2. **Global Shortcuts**: System-wide shortcuts for reload and quit
3. **Platform Handling**: macOS-specific dock icon and window behavior
4. **Sandbox Disabled**: Required for NAPI native module access

## Key Concepts

### Window Creation

BrowserWindow configured for the editor:

```typescript
mainWindow = new BrowserWindow({
  width: 800,
  height: 600,
  title: "Shift",
  webPreferences: {
    preload: path.join(__dirname, "preload.js"),
    sandbox: false, // Required for shift-node
  },
});
mainWindow.maximize();
```

### Content Loading

Development vs production loading:

```typescript
if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
  mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
} else {
  mainWindow.loadFile("../renderer/index.html");
}
```

### Global Shortcuts

Registered after window loads:

```typescript
// Full reload (includes preload and native modules)
globalShortcut.register("CommandOrControl+Shift+R", () => {
  mainWindow?.reload();
});

// Force quit
globalShortcut.register("CommandOrControl+Q", () => {
  app.quit();
});
```

## API Reference

### App Events

- `ready` - Create main window
- `window-all-closed` - Quit on non-macOS
- `activate` - Recreate window on macOS
- `will-quit` - Cleanup shortcuts

### Global Shortcuts

- `Cmd/Ctrl+Shift+R` - Full reload
- `Cmd/Ctrl+Q` - Force quit

### Window Methods

- `mainWindow.maximize()` - Maximize on creation
- `mainWindow.reload()` - Reload window
- `mainWindow.webContents.openDevTools()` - Open DevTools

## Usage Examples

### App Lifecycle

```typescript
app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
```

### Shortcut Registration

```typescript
mainWindow.webContents.on("did-finish-load", () => {
  globalShortcut.register(
    process.platform === "darwin" ? "Command+Shift+R" : "Control+Shift+R",
    () => mainWindow?.reload(),
  );
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
```

### macOS Dock Icon

```typescript
app.whenReady().then(() => {
  if (process.platform === "darwin") {
    app.dock.setIcon(path.join(__dirname, "icon.png"));
  }
});
```

## Data Flow

```
App Launch
    ↓
app.whenReady()
    ↓
createWindow()
    ├── new BrowserWindow(config)
    ├── mainWindow.maximize()
    ├── loadURL or loadFile
    └── Register shortcuts on did-finish-load
    ↓
User Interaction
    ├── Global shortcuts → reload/quit
    └── Window events → lifecycle handling
    ↓
app.quit()
    └── will-quit → unregisterAll shortcuts
```

## Related Systems

- [preload](../../preload/docs/DOCS.md) - Native API bridge
- [engine](../../renderer/src/engine/docs/DOCS.md) - Uses exposed APIs
