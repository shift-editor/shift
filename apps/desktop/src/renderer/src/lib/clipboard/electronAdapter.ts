import type { ClipboardAdapter } from "./types";

/**
 * Production {@link ClipboardAdapter} backed by Electron's preload-exposed
 * clipboard IPC (`window.electronAPI.clipboard*`). Throws if `electronAPI`
 * is missing so misconfiguration surfaces loudly instead of silently
 * dropping clipboard ops.
 */
export const electronClipboardAdapter: ClipboardAdapter = {
  writeText(text: string): void {
    if (!window.electronAPI) throw new Error("electronAPI is not available");
    window.electronAPI.clipboardWriteText(text);
  },
  readText(): string {
    if (!window.electronAPI) throw new Error("electronAPI is not available");
    return window.electronAPI.clipboardReadText();
  },
};
