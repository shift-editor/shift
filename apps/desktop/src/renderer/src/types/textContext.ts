export interface TextContentGlyph {
  unicode: number;
  char: string;
  svgPath: string | null;
  xOffset: number;
  advance: number;
}

export interface TextContent {
  text: string;
  layout: TextContentGlyph[];
  baseGlyphUnicode: number;
  editingGlyphIndex: number | null;
  editingXOffset: number;
}
