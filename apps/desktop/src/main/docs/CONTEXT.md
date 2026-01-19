# Main - LLM Context

## Quick Facts

- **Purpose**: Electron main process for app lifecycle and window management
- **Language**: TypeScript
- **Key Files**: `main.ts`
- **Dependencies**: Electron
- **Dependents**: preload, renderer

## File Structure

```
src/main/
└── main.ts    # Single file, ~90 lines
```

## Core Abstractions

### Window Creation (main.ts:15-53)

```typescript
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: "Shift",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: false,
    },
  });

  mainWindow.maximize();

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/index.html`));
  }

  mainWindow.webContents.openDevTools();
}
```

### Shortcut Registration (main.ts:41-52)

```typescript
mainWindow.webContents.on("did-finish-load", () => {
  globalShortcut.register(
    process.platform === "darwin" ? "Command+Shift+R" : "Control+Shift+R",
    () => mainWindow?.reload(),
  );

  globalShortcut.register(
    process.platform === "darwin" ? "Command+Q" : "Control+Q",
    () => app.quit(),
  );
});
```

### App Events (main.ts:55-86)

```typescript
// App ready
app.whenReady().then(createWindow);

// Window closed
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// macOS activate
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Cleanup
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});
```

## Key Patterns

### Platform Detection

```typescript
// macOS vs others
process.platform === "darwin" ? "Command+Shift+R" : "Control+Shift+R";

// macOS keeps app alive with no windows
if (process.platform !== "darwin") {
  app.quit();
}
```

### Squirrel Startup (Windows)

```typescript
if (require("electron-squirrel-startup")) {
  app.quit();
}
```

### Deferred Shortcut Registration

```typescript
// Register after window content loads
mainWindow.webContents.on('did-finish-load', () => {
  globalShortcut.register(...);
});

// Unregister on quit
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
```

## API Surface

| Event/Method        | Trigger            | Action            |
| ------------------- | ------------------ | ----------------- |
| `app.whenReady()`   | App initialized    | Create window     |
| `window-all-closed` | All windows closed | Quit (non-macOS)  |
| `activate`          | Dock click (macOS) | Recreate window   |
| `will-quit`         | Before quit        | Cleanup shortcuts |
| `Cmd/Ctrl+Shift+R`  | Global shortcut    | Reload window     |
| `Cmd/Ctrl+Q`        | Global shortcut    | Force quit        |

## Common Operations

### Create window

```typescript
const win = new BrowserWindow({
  webPreferences: {
    preload: path.join(__dirname, "preload.js"),
    sandbox: false,
  },
});
win.maximize();
win.loadFile("index.html");
```

### Register shortcut

```typescript
globalShortcut.register("CommandOrControl+K", () => {
  // Action
});
```

### Check platform

```typescript
if (process.platform === "darwin") {
  app.dock.setIcon(iconPath);
}
```

## Build Configuration

### Electron Forge (forge.config.ts)

```typescript
{
  entry: 'src/main/main.ts',
  config: 'vite.main.config.ts',
}
```

### Vite Main Config (vite.main.config.ts)

- Externalize dependencies
- Target: electron-main
- Output: .vite/build/main.js

## Constraints and Invariants

1. **Single Window**: Only one mainWindow at a time
2. **Sandbox Disabled**: Required for NAPI access
3. **Shortcut Cleanup**: Must unregister on quit
4. **macOS Behavior**: App stays alive without windows
5. **DevTools**: Opened automatically in development
6. **Preload Path**: Must match build output location
