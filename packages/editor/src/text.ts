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
  ParagraphItem,
  GlyphTextItem,
  TextItem,
} from "./lib/text/layout/types";
export { fallbackGlyphNameForUnicode, formatCodepointAsUPlus } from "./lib/utils/unicode";
export { NONSPACING_MARK_EDITOR_ADVANCE } from "./lib/utils/displayAdvance";
export type {
  FeatureHighlight,
  FeatureListing,
  TextHighlight,
  TextLayoutFailure,
  TextRunRecord,
  TextRunSettings,
  TextRunSettingsChange,
} from "./types/text";
export type { FeatureSubstitution, FontFeature } from "@shift/wasm/protocol";
export { featureReadMessage } from "./lib/text/featureErrors";
