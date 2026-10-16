export { TextEditing } from "./lib/text/TextEditing";
export { TextBuffer } from "./lib/text/TextBuffer";
export { characterTextItem, glyphTextItem, lineBreakTextItem } from "./lib/text/layout/types";
export type {
  CharacterTextItem,
  Paragraph,
  ParagraphItem,
  GlyphTextItem,
  SegmentedRun,
  TextItem,
} from "./lib/text/layout/types";
export { fallbackGlyphNameForUnicode, formatCodepointAsUPlus } from "./lib/utils/unicode";
