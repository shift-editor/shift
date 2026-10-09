// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require("electron");
import type { IpcRendererEvent } from "electron";
import type { ShiftHost } from "../shared/host/ShiftHost";
import { invoke, listen } from "../shared/ipc/renderer";

const shiftHost: ShiftHost = {
  platform: process.platform,
  commands: {
    run: invoke(ipcRenderer, "commands.run"),
    onRunRendererCommand: listen(ipcRenderer, "commands.runRenderer"),
  },
  document: {
    connect: invoke(ipcRenderer, "document.connect"),
  },
  session: {
    mode: invoke(ipcRenderer, "session.mode"),
    connect: invoke(ipcRenderer, "session.connect"),
    ready: invoke(ipcRenderer, "session.ready"),
  },
  window: {
    reopenDocument: invoke(ipcRenderer, "window.reopenDocument"),
    ready: invoke(ipcRenderer, "window.ready"),
    setTitleBarColors: invoke(ipcRenderer, "window.setTitleBarColors"),
    buttonLayout: invoke(ipcRenderer, "window.buttonLayout"),
  },
  menu: {
    bar: invoke(ipcRenderer, "menu.bar"),
    activate: invoke(ipcRenderer, "menu.activate"),
    onBarChanged: listen(ipcRenderer, "menu.barChanged"),
  },
  errors: {
    reportRenderer: invoke(ipcRenderer, "errors.reportRenderer"),
  },
  update: {
    startDownload: invoke(ipcRenderer, "update.startDownload"),
    cancelDownload: invoke(ipcRenderer, "update.cancelDownload"),
    restartToUpdate: invoke(ipcRenderer, "update.restartToUpdate"),
    later: invoke(ipcRenderer, "update.later"),
    onProgress: listen(ipcRenderer, "update.progress"),
    onAvailable: listen(ipcRenderer, "update.available"),
    onReady: listen(ipcRenderer, "update.ready"),
  },
  ui: {
    onZoomChanged: listen(ipcRenderer, "ui.zoomChanged"),
  },
  recents: {
    list: invoke(ipcRenderer, "recents.list"),
    open: invoke(ipcRenderer, "recents.open"),
    remove: invoke(ipcRenderer, "recents.remove"),
    restore: invoke(ipcRenderer, "recents.restore"),
    reveal: invoke(ipcRenderer, "recents.reveal"),
    locate: invoke(ipcRenderer, "recents.locate"),
    onChanged: listen(ipcRenderer, "recents.changed"),
  },
  clipboard: {
    writeText: invoke(ipcRenderer, "clipboard.writeText"),
    readText: invoke(ipcRenderer, "clipboard.readText"),
  },
};

contextBridge.exposeInMainWorld("shiftHost", shiftHost);

// MessagePorts cannot cross the context bridge; relay them into the page.
ipcRenderer.on("session.port", (event: IpcRendererEvent) => {
  window.postMessage({ type: "session.port" }, "*", event.ports);
});

ipcRenderer.on("document.port", (event: IpcRendererEvent) => {
  window.postMessage({ type: "document.port" }, "*", event.ports);
});
