export { TextEditing } from "./lib/text/TextEditing";
export { TextBuffer } from "./lib/text/TextBuffer";
export {
  GlyphNameParser,
  PlainTextParser,
  type TextParseContext,
  type TextParser,
} from "./lib/text/parsing";
export { characterTextItem, glyphTextItem, lineBreakTextItem } from "./lib/text/layout/types";
export type {
  CharacterTextItem,
  Paragraph,
  ParagraphItem,
  GlyphTextItem,
  SegmentedRun,
  TextAlign,
  TextItem,
} from "./lib/text/layout/types";
export { fallbackGlyphNameForUnicode, formatCodepointAsUPlus } from "./lib/utils/unicode";
export type { TextRunRecord } from "./types/text";
export type { TextHighlight } from "./lib/text/Text";
