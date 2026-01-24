import {
  app,
  BrowserWindow,
  globalShortcut,
  Menu,
  dialog,
  ipcMain,
  nativeTheme,
} from "electron";
import path from "node:path";
import started from "electron-squirrel-startup";

// Declare global variables provided by Electron Forge Vite plugin
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const AUTOSAVE_INTERVAL_MS = 30_000;

let mainWindow: BrowserWindow | null = null;
let currentTheme: "light" | "dark" | "system" = "light";
let currentFilePath: string | null = null;
let documentIsDirty = false;
let autosaveIntervalId: ReturnType<typeof setInterval> | null = null;

function setTheme(theme: "light" | "dark" | "system") {
  currentTheme = theme;
  mainWindow?.webContents.send("theme:set", theme);

  if (theme === "system") {
    nativeTheme.themeSource = "system";
  } else {
    nativeTheme.themeSource = theme;
  }
}

function updateWindowTitle() {
  if (!mainWindow) return;

  let title: string;
  if (currentFilePath) {
    const fileName = path.basename(currentFilePath);
    title = `${fileName}${documentIsDirty ? "— Edited" : ""}`;
  } else {
    title = `Untitled Font${documentIsDirty ? "— Edited" : ""}`;
  }

  mainWindow.setTitle(title);
  mainWindow.setDocumentEdited(documentIsDirty);
}

function setCurrentFilePath(filePath: string | null) {
  currentFilePath = filePath;
  updateWindowTitle();
}

function setDocumentDirty(dirty: boolean) {
  documentIsDirty = dirty;
  updateWindowTitle();
}

async function saveFont(saveAs = false) {
  let savePath = currentFilePath;

  if (!savePath || saveAs) {
    const result = await dialog.showSaveDialog({
      defaultPath: currentFilePath || "Untitled.ufo",
      filters: [{ name: "UFO Files", extensions: ["ufo"] }],
    });

    if (result.canceled || !result.filePath) {
      return;
    }

    savePath = result.filePath;
    if (!savePath.endsWith(".ufo")) {
      savePath += ".ufo";
    }
  }

  mainWindow?.webContents.send("menu:save-font", savePath);
}

function startAutosave() {
  if (autosaveIntervalId) return;

  autosaveIntervalId = setInterval(() => {
    if (documentIsDirty && currentFilePath) {
      saveFont(false);
    }
  }, AUTOSAVE_INTERVAL_MS);
}

function stopAutosave() {
  if (autosaveIntervalId) {
    clearInterval(autosaveIntervalId);
    autosaveIntervalId = null;
  }
}

function createMenu() {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Font...",
          accelerator: "CmdOrCtrl+O",
          click: async () => {
            const result = await dialog.showOpenDialog({
              properties: ["openFile", "openDirectory"],
              filters: [{ name: "Fonts", extensions: ["ttf", "otf", "ufo"] }],
            });
            if (!result.canceled && result.filePaths[0]) {
              setCurrentFilePath(result.filePaths[0]);
              mainWindow?.webContents.send(
                "menu:open-font",
                result.filePaths[0],
              );
            }
          },
        },
        { type: "separator" },
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          click: () => saveFont(false),
        },
        {
          label: "Save As...",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => saveFont(true),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        {
          label: "Undo",
          accelerator: "CmdOrCtrl+Z",
          click: () => mainWindow?.webContents.send("menu:undo"),
        },
        {
          label: "Redo",
          accelerator: "CmdOrCtrl+Shift+Z",
          click: () => mainWindow?.webContents.send("menu:redo"),
        },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        {
          label: "Delete",
          accelerator: "Backspace",
          click: () => mainWindow?.webContents.send("menu:delete"),
        },
        { type: "separator" },
        {
          label: "Select All",
          accelerator: "CmdOrCtrl+A",
          click: () => mainWindow?.webContents.send("menu:select-all"),
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" },
        { type: "separator" },
        {
          label: "Theme",
          submenu: [
            {
              label: "Light",
              type: "radio",
              checked: currentTheme === "light",
              click: () => setTheme("light"),
            },
            {
              label: "Dark",
              type: "radio",
              checked: currentTheme === "dark",
              click: () => setTheme("dark"),
            },
            {
              label: "System",
              type: "radio",
              checked: currentTheme === "system",
              click: () => setTheme("system"),
            },
          ],
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

const createWindow = () => {
  // Create the browser window with frameless style for custom titlebar
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: "Shift",
    titleBarStyle: "hidden",
    trafficLightPosition: { x: -100, y: -100 }, // Hide native traffic lights off-screen
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: false,
    },
  });

  // Maximize the window
  mainWindow.maximize();

  // Set initial window title
  updateWindowTitle();

  // Start autosave timer
  startAutosave();

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/index.html`));
  }

  mainWindow.on("close", async (event) => {
    if (!documentIsDirty) {
      stopAutosave();
      return;
    }

    event.preventDefault();

    const fileName = currentFilePath
      ? path.basename(currentFilePath)
      : "Untitled";

    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "question",
      buttons: ["Don't Save", "Cancel", "Save"],
      defaultId: 2,
      cancelId: 1,
      message: `Do you want to save changes to "${fileName}"?`,
      detail: "Your changes will be lost if you don't save.",
    });

    if (response === 0) {
      stopAutosave();
      mainWindow.destroy();
    } else if (response === 2) {
      await saveFont(false);
      stopAutosave();
      mainWindow.destroy();
    }
  });

  // Register keyboard shortcuts for reload
  mainWindow.webContents.once("did-finish-load", () => {
    // Cmd+Shift+R or Ctrl+Shift+R for full reload (reloads preload script and native modules)
    globalShortcut.register(
      process.platform === "darwin" ? "Command+Shift+R" : "Control+Shift+R",
      () => {
        // Reload the window - this will reload the preload script and pick up new native modules
        mainWindow?.reload();
      },
    );

    // Cmd+Q or Ctrl+Q to force quit
    globalShortcut.register(
      process.platform === "darwin" ? "Command+Q" : "Control+Q",
      () => {
        app.quit();
      },
    );
  });
};

// Register IPC handlers before window creation
ipcMain.handle("window:close", () => {
  mainWindow?.close();
});

ipcMain.handle("window:minimize", () => {
  mainWindow?.minimize();
});

ipcMain.handle("window:maximize", () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle("window:isMaximized", () => {
  return mainWindow?.isMaximized() ?? false;
});

ipcMain.handle("document:setDirty", (_event, dirty: boolean) => {
  setDocumentDirty(dirty);
});

ipcMain.handle("document:setFilePath", (_event, filePath: string | null) => {
  setCurrentFilePath(filePath);
});

ipcMain.handle("document:saveCompleted", (_event, filePath: string) => {
  setCurrentFilePath(filePath);
  setDocumentDirty(false);
});

ipcMain.handle("dialog:openFont", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile", "openDirectory"],
    filters: [{ name: "Fonts", extensions: ["ttf", "otf", "ufo"] }],
  });
  if (!result.canceled && result.filePaths[0]) {
    setCurrentFilePath(result.filePaths[0]);
    return result.filePaths[0];
  }
  return null;
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", () => {
  createMenu();
  createWindow();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.whenReady().then(() => {
  if (process.platform === "darwin") {
    // app.getAppPath() returns the app directory (apps/desktop in dev, app.asar in prod)
    // This is more reliable than __dirname which varies based on build output location
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, "icon.png")
      : path.join(app.getAppPath(), "../../icons/icon.png");
    app.dock?.setIcon(iconPath);
  }

  ipcMain.handle("theme:get", () => currentTheme);
  ipcMain.handle("theme:set", (_event, theme: "light" | "dark" | "system") => {
    setTheme(theme);
    createMenu();
  });
});

// Clean up shortcuts on quit
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
