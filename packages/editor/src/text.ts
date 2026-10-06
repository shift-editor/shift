export { TextEditing } from "./lib/text/TextEditing";
export {
  caretForCluster,
  clusterForCaret,
  deleteText,
  selectionRange,
  spliceText,
  wordCluster,
} from "./lib/text/edit";
export { glyphTextItem, lineBreakTextItem } from "./lib/text/layout/types";
export type { GlyphTextItem, SegmentedRun, TextItem } from "./lib/text/layout/types";
export {
  fallbackGlyphNameForUnicode,
  formatCodepointAsUPlus,
  resolveGlyphNameFromUnicode,
  textItemFromCodepoint,
} from "./lib/utils/unicode";
