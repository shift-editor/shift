import type { SystemClipboard } from "./types";

/**
 * Production {@link SystemClipboard} placeholder while clipboard moves onto
 * the renderer host API.
 */
export const electronSystemClipboard: SystemClipboard = {
  writeText(text: string): void {
    void text;
    throw new Error("clipboard host API is not wired");
  },
  readText(): string {
    throw new Error("clipboard host API is not wired");
  },
};
