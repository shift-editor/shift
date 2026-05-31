// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require("electron");
import { createBridge, type BridgeApi } from "@shift/bridge";
import type { ShiftHost } from "../shared/host/ShiftHost";
import { invoke } from "../shared/ipc/renderer";

const bridge = createBridge();

/**
 * Converts a bridge class instance into a contextBridge-safe plain object.
 *
 * @param instance - Bridge instance whose prototype methods should be exposed.
 * @returns a plain method object suitable for `contextBridge.exposeInMainWorld`.
 */
function buildContextBridgeApi<T extends object>(instance: T): T {
  const api: Record<string, unknown> = {};
  const target = instance as Record<string, unknown>;
  const proto = Object.getPrototypeOf(instance);
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === "constructor" || typeof target[name] !== "function") continue;
    api[name] = (...args: unknown[]) => (target[name] as Function)(...args);
  }
  return api as T;
}

const bridgeApi = buildContextBridgeApi<BridgeApi>(bridge);

const shiftHost: ShiftHost = {
  commands: {
    run: invoke(ipcRenderer, "commands.run"),
  },
};

contextBridge.exposeInMainWorld("shiftBridge", bridgeApi);
contextBridge.exposeInMainWorld("shiftHost", shiftHost);
