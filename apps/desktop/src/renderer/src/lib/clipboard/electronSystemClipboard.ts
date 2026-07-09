import type { SystemClipboard } from "./types";
import { getShiftHost } from "@/host/shiftHost";

/**
 * Production {@link SystemClipboard} backed by the preload-exposed Shift host
 * clipboard API. Resolves the host lazily per call so importing this module
 * never requires the preload bridge.
 */
export const electronSystemClipboard: SystemClipboard = {
  writeText(text: string): Promise<void> {
    return getShiftHost().clipboard.writeText(text);
  },
  readText(): Promise<string> {
    return getShiftHost().clipboard.readText();
  },
};
