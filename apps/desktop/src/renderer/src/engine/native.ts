import type { FontEngineAPI } from "@shared/bridge/FontEngineAPI";

export type { FontEngineAPI };
export type NativeFontEngine = FontEngineAPI;

let cached: FontEngineAPI | null = null;

export function getNative(): FontEngineAPI {
  if (cached) return cached;
  if (!window.shiftFont) {
    throw new Error("Native FontEngine not available");
  }
  cached = window.shiftFont;
  return cached;
}

export function hasNative(): boolean {
  return !!window.shiftFont;
}
