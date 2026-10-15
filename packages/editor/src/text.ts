export { TextEditing } from "./lib/text/TextEditing";
export {
  caretForCluster,
  clusterForCaret,
  deleteText,
  graphemeCluster,
  selectionRange,
  spliceText,
  wordCluster,
} from "./lib/text/edit";
export { characterTextItem, glyphTextItem, lineBreakTextItem } from "./lib/text/layout/types";
export type {
  CharacterTextItem,
  GlyphicTextItem,
  GlyphTextItem,
  SegmentedRun,
  TextAlign,
  TextItem,
} from "./lib/text/layout/types";
export { fallbackGlyphNameForUnicode, formatCodepointAsUPlus } from "./lib/utils/unicode";
export type { TextRunRecord } from "./types/text";
export type { TextHighlight } from "./lib/text/Text";
