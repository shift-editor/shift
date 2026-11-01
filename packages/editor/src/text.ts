export { TextEditing, type ShownCaret } from "./lib/text/TextEditing";
export { TextBuffer } from "./lib/text/TextBuffer";
export type { ParsedText } from "./types/text";
export {
  characterTextItem,
  glyphTextItem,
  lineBreakTextItem,
  typedTextItems,
} from "./lib/text/layout/types";
export type {
  CharacterTextItem,
  Paragraph,
  ParagraphItem,
  GlyphTextItem,
  SegmentedRun,
  TextItem,
} from "./lib/text/layout/types";
export { fallbackGlyphNameForUnicode, formatCodepointAsUPlus } from "./lib/utils/unicode";
export { NONSPACING_MARK_EDITOR_ADVANCE } from "./lib/utils/displayAdvance";
