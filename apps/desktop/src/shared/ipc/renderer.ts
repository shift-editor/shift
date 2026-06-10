import type { RendererToMain } from "./contract";

type IpcRenderer = {
  on(channel: string, listener: (...args: any[]) => void): void;
  removeListener(channel: string, listener: (...args: any[]) => void): void;
  invoke(channel: string, ...args: any[]): Promise<any>;
};

/**
 * Creates a typed invoke helper for one renderer-to-main request channel.
 *
 * @param ipcRenderer - Electron renderer IPC object supplied by preload.
 * @param channel - Channel declared in {@link RendererToMain}.
 * @returns a function whose arguments and result are inferred from the channel contract.
 */
export function invoke<K extends keyof RendererToMain>(
  ipcRenderer: IpcRenderer,
  channel: K,
): (...args: Parameters<RendererToMain[K]>) => Promise<ReturnType<RendererToMain[K]>> {
  return (...args) => ipcRenderer.invoke(channel, ...args);
}
