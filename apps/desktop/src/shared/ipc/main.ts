import type { WebContents, IpcMain, IpcMainInvokeEvent } from "electron";
import type { IpcEvents, IpcCommands } from "./channels";

/** Send a typed event from main to renderer */
export function send<K extends keyof IpcEvents>(
  webContents: WebContents,
  channel: K,
  ...args: Parameters<IpcEvents[K]>
): void {
  webContents.send(channel, ...args);
}

/** Register a typed handler for a renderer command */
export function handle<K extends keyof IpcCommands>(
  ipcMain: IpcMain,
  channel: K,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: Parameters<IpcCommands[K]>
  ) => ReturnType<IpcCommands[K]> | Promise<ReturnType<IpcCommands[K]>>,
): void {
  ipcMain.handle(channel, handler as any);
}
