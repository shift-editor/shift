import type { IpcMain, IpcMainInvokeEvent, WebContents } from "electron";
import type { MainToRenderer, RendererToMain } from "./contract";

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

/**
 * Sends a typed main-to-renderer broadcast to one window.
 *
 * @param webContents - Target window's web contents.
 * @param channel - Channel declared in {@link MainToRenderer}.
 * @param args - Payload inferred from the channel contract.
 */
export function send<K extends keyof MainToRenderer>(
  webContents: WebContents,
  channel: K,
  ...args: Parameters<MainToRenderer[K]>
): void {
  webContents.send(channel, ...args);
}
