import { app, BrowserWindow, globalShortcut } from "electron";
import path from "node:path";
import started from "electron-squirrel-startup";

// Declare global variables provided by Electron Forge Vite plugin
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: "Shift",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: false,
    },
  });

  // Maximize the window
  mainWindow.maximize();

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/index.html`));
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();

  // Register keyboard shortcuts for reload
  mainWindow.webContents.once("did-finish-load", () => {
    // Cmd+Shift+R or Ctrl+Shift+R for full reload (reloads preload script and native modules)
    globalShortcut.register(process.platform === "darwin" ? "Command+Shift+R" : "Control+Shift+R", () => {
      // Reload the window - this will reload the preload script and pick up new native modules
      mainWindow?.reload();
    });

    // Cmd+Q or Ctrl+Q to force quit
    globalShortcut.register(process.platform === "darwin" ? "Command+Q" : "Control+Q", () => {
      app.quit();
    });
  });
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", createWindow);

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
    app.dock?.setIcon(path.join(__dirname, "../../icons/icon.png"));
  }
});

// Clean up shortcuts on quit
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
