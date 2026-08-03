// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require("electron");
import type { IpcRendererEvent } from "electron";
import type { ShiftHost } from "../shared/host/ShiftHost";
import { invoke, listen } from "../shared/ipc/renderer";

const shiftHost: ShiftHost = {
  commands: {
    run: invoke(ipcRenderer, "commands.run"),
    onRunRendererCommand: listen(ipcRenderer, "commands.runRenderer"),
  },
  document: {
    connect: invoke(ipcRenderer, "document.connect"),
  },
  session: {
    kind: invoke(ipcRenderer, "session.kind"),
    connect: invoke(ipcRenderer, "session.connect"),
    ready: invoke(ipcRenderer, "session.ready"),
  },
  ui: {
    onZoomChanged: listen(ipcRenderer, "ui.zoomChanged"),
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
