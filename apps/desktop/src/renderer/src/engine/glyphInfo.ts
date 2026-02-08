import type { GlyphInfoAPI } from "@shared/bridge/GlyphInfoAPI";

export type { GlyphInfoAPI };

let cached: GlyphInfoAPI | null = null;

export function getGlyphInfo(): GlyphInfoAPI {
  if (cached) return cached;
  if (!window.shiftGlyphInfo) {
    throw new Error("GlyphInfo not available");
  }
  cached = window.shiftGlyphInfo;
  return cached;
}

export function hasGlyphInfo(): boolean {
  return !!window.shiftGlyphInfo;
}
