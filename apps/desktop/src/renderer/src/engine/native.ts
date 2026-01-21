import type {
  FontEngineAPI,
  JsGlyphSnapshot,
  JsContourSnapshot,
  JsPointSnapshot,
  JsFontMetrics,
  JsFontMetaData,
} from "@shared/bridge/FontEngineAPI";

export type {
  FontEngineAPI,
  JsGlyphSnapshot,
  JsContourSnapshot,
  JsPointSnapshot,
  JsFontMetrics,
  JsFontMetaData,
};

export type NativeFontEngine = FontEngineAPI;
export type NativeGlyphSnapshot = JsGlyphSnapshot;
export type NativeContourSnapshot = JsContourSnapshot;
export type NativePointSnapshot = JsPointSnapshot;
export type NativeFontMetrics = JsFontMetrics;
export type NativeFontMetadata = JsFontMetaData;

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
