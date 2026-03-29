import type { LayoutGlyph } from "@/lib/tools/text/types";

export interface TextContent {
  text: string;
  layout: LayoutGlyph[];
  baseGlyphUnicode: number;
  editingGlyphIndex: number | null;
  editingXOffset: number;
}
