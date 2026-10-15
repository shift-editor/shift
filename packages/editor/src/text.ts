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
  TextItem,
} from "./lib/text/layout/types";
export { fallbackGlyphNameForUnicode, formatCodepointAsUPlus } from "./lib/utils/unicode";
