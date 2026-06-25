// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer, clipboard } = require("electron");
import type { IpcRendererEvent } from "electron";
import type { ShiftHost } from "../shared/host/ShiftHost";
import { invoke, listen } from "../shared/ipc/renderer";

const shiftHost: ShiftHost = {
  commands: {
    run: invoke(ipcRenderer, "commands.run"),
  },
  document: {
    connect: invoke(ipcRenderer, "document.connect"),
  },
  workspace: {
    create: invoke(ipcRenderer, "workspace.create"),
    open: invoke(ipcRenderer, "workspace.open"),
    connect: invoke(ipcRenderer, "workspace.connect"),
  },
  ui: {
    onZoomChanged: listen(ipcRenderer, "ui.zoomChanged"),
  },
  clipboard: {
    writeText: (text: string): void => clipboard.writeText(text),
    readText: (): string => clipboard.readText(),
  },
};

contextBridge.exposeInMainWorld("shiftHost", shiftHost);

// MessagePorts cannot cross the context bridge; relay them into the page.
ipcRenderer.on("workspace.port", (event: IpcRendererEvent) => {
  window.postMessage({ type: "workspace.port" }, window.location.origin, event.ports);
});

ipcRenderer.on("document.port", (event: IpcRendererEvent) => {
  window.postMessage({ type: "document.port" }, window.location.origin, event.ports);
});
