// Minimal Electron host: a hidden BrowserWindow loads the bundled bench as a
// classic script in a real renderer (no node integration), and forwards its
// console lines to stdout. Usage: Electron main.cjs [--quick]
const { app, BrowserWindow } = require("electron");
const path = require("node:path");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.on("console-message", (event, _level, legacyMessage) => {
    const message = event.message ?? legacyMessage;
    process.stdout.write(message + "\n");
    if (message.startsWith("DONE") || message.startsWith("ERROR")) app.quit();
  });
  win.webContents.on("render-process-gone", (_e, d) => { console.error("renderer gone", d); app.exit(1); });
  await win.loadFile(path.join(__dirname, "index.html"));
});
