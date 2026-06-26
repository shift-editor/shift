import { defaultResources, GlyphInfo } from "@shift/glyph-info";

let glyphInfo: GlyphInfo | null = null;

export function getGlyphInfo(): GlyphInfo {
  glyphInfo ??= new GlyphInfo(defaultResources);
  return glyphInfo;
}
