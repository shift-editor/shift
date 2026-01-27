# Main - LLM Context

## Quick Facts

- **Purpose**: Electron main process for app lifecycle and window management
- **Language**: TypeScript
- **Key Files**: `main.ts`, `managers/*.ts`
- **Dependencies**: Electron
- **Dependents**: preload, renderer

## File Structure

```
src/main/
├── main.ts                 # Entry point (~20 lines)
└── managers/
    ├── AppLifecycle.ts     # App events, quit handling (~110 lines)
    ├── DocumentState.ts    # Dirty state, save dialogs (~120 lines)
    ├── MenuManager.ts      # Menu creation (~130 lines)
    ├── WindowManager.ts    # Window, IPC handlers (~120 lines)
    └── index.ts            # Re-exports (~5 lines)
```

## Core Abstractions

### Entry Point (main.ts)

```typescript
const documentState = new DocumentState();
const windowManager = new WindowManager(documentState);
const menuManager = new MenuManager(documentState, windowManager);
const appLifecycle = new AppLifecycle(documentState, windowManager, menuManager);

appLifecycle.initialize();
```

### DocumentState (managers/DocumentState.ts)

Tracks document dirty state and handles save confirmation:

```typescript
class DocumentState {
  isDirty(): boolean;
  setDirty(dirty: boolean): void;
  getFilePath(): string | null;
  setFilePath(filePath: string | null): void;
  save(saveAs?: boolean): Promise<boolean>;
  confirmClose(): Promise<boolean>; // Shows dialog if dirty
  startAutosave(): void;
  stopAutosave(): void;
}
```

### WindowManager (managers/WindowManager.ts)

Creates window and registers IPC handlers:

```typescript
class WindowManager {
  create(): BrowserWindow;
  getWindow(): BrowserWindow | null;
  setQuitting(quitting: boolean): void;
  destroy(): void;
}
```

### MenuManager (managers/MenuManager.ts)

Creates application menu:

```typescript
class MenuManager {
  create(): void;
  getTheme(): Theme;
  setTheme(theme: Theme): void;
}
```

### AppLifecycle (managers/AppLifecycle.ts)

Coordinates app events:

```typescript
class AppLifecycle {
  initialize(): void; // Registers all event handlers
}
```

## Key Patterns

### Quit Flow

```typescript
app.on("before-quit", async (event) => {
  if (this.isQuitting) return;

  event.preventDefault();
  const shouldQuit = await this.documentState.confirmClose();

  if (shouldQuit) {
    this.isQuitting = true;
    this.windowManager.setQuitting(true);
    app.quit();
  }
});
```

### Save Confirmation Dialog

```typescript
async confirmClose(): Promise<boolean> {
  if (!this.dirty) return true;

  const { response } = await dialog.showMessageBox(this.window, {
    buttons: ["Don't Save", "Cancel", "Save"],
    message: `Do you want to save changes to "${fileName}"?`,
  });

  if (response === 1) return false;  // Cancel
  if (response === 2) await this.save();
  return true;
}
```

### Platform Detection

```typescript
// macOS vs others
process.platform === "darwin" ? "Command+Shift+R" : "Control+Shift+R";

// macOS keeps app alive with no windows
if (process.platform !== "darwin") {
  app.quit();
}
```

## API Surface

| Event/Method        | Trigger            | Action                   |
| ------------------- | ------------------ | ------------------------ |
| `app.ready`         | App initialized    | Create menu and window   |
| `before-quit`       | Quit requested     | Check dirty, show dialog |
| `window-all-closed` | All windows closed | Quit (non-macOS)         |
| `activate`          | Dock click (macOS) | Recreate window          |
| `will-quit`         | Before quit        | Cleanup shortcuts        |
| `Cmd/Ctrl+Shift+R`  | Global shortcut    | Reload window            |

## Common Operations

### Check dirty and quit

```typescript
const shouldQuit = await documentState.confirmClose();
if (shouldQuit) {
  windowManager.destroy();
  app.quit();
}
```

### Save document

```typescript
await documentState.save(false); // Save to current path
await documentState.save(true); // Save As...
```

### Update dirty state from renderer

```typescript
// In renderer
window.electron.document.setDirty(true);

// Handled in WindowManager via IPC
ipcMain.handle("document:setDirty", (_event, dirty) => {
  documentState.setDirty(dirty);
});
```

## Constraints and Invariants

1. **Single Window**: Only one mainWindow at a time
2. **Sandbox Disabled**: Required for NAPI access
3. **No Global Cmd+Q**: Uses menu role instead to ensure dirty check
4. **Quit Requires Confirmation**: All quit paths go through `confirmClose()`
5. **macOS Behavior**: App stays alive without windows
6. **Manager Dependencies**: DocumentState is shared by all managers
