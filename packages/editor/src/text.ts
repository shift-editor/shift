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
  TextItem,
} from "./lib/text/layout/types";
export type {
  FeatureDefault,
  FontFeature,
  TextAlign,
  TextRunRecord,
  TextRunSettings,
} from "./types/text";
export { fallbackGlyphNameForUnicode, formatCodepointAsUPlus } from "./lib/utils/unicode";
