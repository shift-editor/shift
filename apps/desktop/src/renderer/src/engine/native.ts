import type { FontEngineAPI } from "@shared/bridge/FontEngineAPI";
import type {
  GlyphSnapshot,
  ContourSnapshot,
  PointSnapshot,
  FontMetrics,
  FontMetadata,
} from "@shift/types";

export type { FontEngineAPI };
export type NativeFontEngine = FontEngineAPI;
export type NativeGlyphSnapshot = GlyphSnapshot;
export type NativeContourSnapshot = ContourSnapshot;
export type NativePointSnapshot = PointSnapshot;
export type NativeFontMetrics = FontMetrics;
export type NativeFontMetadata = FontMetadata;

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
