import type { IpcMain, IpcMainInvokeEvent } from "electron";
import type { RendererToMain } from "./contract";

/**
 * Registers a typed renderer-to-main request handler.
 *
 * @param ipcMain - Electron's process-wide IPC main object.
 * @param channel - Channel declared in {@link RendererToMain}.
 * @param handler - Function that receives the Electron event plus the channel payload.
 */
export function handle<K extends keyof RendererToMain>(
  ipcMain: IpcMain,
  channel: K,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: Parameters<RendererToMain[K]>
  ) => ReturnType<RendererToMain[K]> | Promise<ReturnType<RendererToMain[K]>>,
): void {
  ipcMain.handle(channel, handler as any);
}
