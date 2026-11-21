import type { GlyphId, SourceId } from "@shift/types";
import type { Font } from "../lib/model/Font";

export interface GlyphReapplyMetricsProps {
  readonly font: Font;
  readonly glyphId: GlyphId | null;
  readonly sourceId: SourceId | null;
}
