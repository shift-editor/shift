import type { SystemClipboard } from "./types";
import { getShiftHost } from "@/host/shiftHost";

/**
 * Production {@link SystemClipboard} backed by the preload-exposed Shift host
 * (Electron's clipboard module, no IPC round trip). Resolves the host lazily
 * per call so importing this module never requires the preload bridge.
 */
export const electronSystemClipboard: SystemClipboard = {
  writeText(text: string): void {
    getShiftHost().clipboard.writeText(text);
  },
  readText(): string {
    return getShiftHost().clipboard.readText();
  },
};
