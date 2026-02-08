import type { GlyphData } from "@shift/glyph-info";

export interface GlyphInfoAPI {
  getGlyphData(cp: number): GlyphData | null;
  getGlyphName(cp: number): string | null;
  getGlyphCategories(): string[];
  getGlyphsByCategory(category: string): GlyphData[];
  getDecomposition(cp: number): number[];
  getUsedBy(cp: number): number[];
}

declare global {
  interface Window {
    shiftGlyphInfo?: GlyphInfoAPI;
  }
}
