import { GlyphInfo, defaultResources } from "@shift/glyph-info";

let instance: GlyphInfo | null = null;

export function getGlyphInfo(): GlyphInfo {
  if (!instance) instance = new GlyphInfo(defaultResources);
  return instance;
}
