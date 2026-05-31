import type { WebContents, IpcMain, IpcMainInvokeEvent } from "electron";
import type { MainToRenderer, RendererToMain } from "./contract";

/**
 * Sends a typed main-to-renderer event to one renderer target.
 *
 * @param webContents - Renderer target that should receive the event.
 * @param channel - Channel declared in {@link MainToRenderer}.
 * @param args - Payload required by the selected channel.
 */
export function send<K extends keyof MainToRenderer>(
  webContents: WebContents,
  channel: K,
  ...args: Parameters<MainToRenderer[K]>
): void {
  webContents.send(channel, ...args);
}

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
