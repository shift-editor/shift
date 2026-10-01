export { TextBuffer } from "./lib/text/TextBuffer";
export { TextInteraction } from "./lib/text/TextInteraction";
export { glyphTextItem, lineBreakTextItem } from "./lib/text/layout/types";
export type { GlyphTextItem, SegmentedRun, TextItem } from "./lib/text/layout/types";
export {
  fallbackGlyphNameForUnicode,
  formatCodepointAsUPlus,
  resolveGlyphNameFromUnicode,
  textItemFromCodepoint,
} from "./lib/utils/unicode";
