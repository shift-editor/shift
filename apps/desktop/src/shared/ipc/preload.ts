import type { IpcEvents, IpcCommands } from "./channels";

type IpcRenderer = {
  on(channel: string, listener: (...args: any[]) => void): void;
  removeListener(channel: string, listener: (...args: any[]) => void): void;
  invoke(channel: string, ...args: any[]): Promise<any>;
};

/** Create a subscribe function for a main->renderer event */
export function listener<K extends keyof IpcEvents>(
  ipcRenderer: IpcRenderer,
  channel: K,
): (callback: (...args: Parameters<IpcEvents[K]>) => void) => () => void {
  return (callback) => {
    const handler = (_event: any, ...args: any[]) => (callback as Function)(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

/** Create a typed invoke function for a renderer->main command */
export function command<K extends keyof IpcCommands>(
  ipcRenderer: IpcRenderer,
  channel: K,
): (...args: Parameters<IpcCommands[K]>) => Promise<ReturnType<IpcCommands[K]>> {
  return (...args) => ipcRenderer.invoke(channel, ...args);
}
