import type { SourceMetrics } from "@shift/types";

const MARGIN_TOP_RATIO = 0.2;
const MARGIN_BOTTOM_RATIO = 0.05;
const MARGIN_SIDE_RATIO = 0;

/** Immutable dimensions for one complete Glyph preview output. */
export class GlyphPreviewLayout {
  readonly width: number;
  readonly height: number;
  readonly viewBox: string;

  constructor(metrics: SourceMetrics, xAdvance: number, height: number) {
    const upm = metrics.unitsPerEm;
    const marginTop = upm * MARGIN_TOP_RATIO;
    const marginBottom = upm * MARGIN_BOTTOM_RATIO;
    const marginSide = upm * MARGIN_SIDE_RATIO;
    const viewBoxX = -marginSide;
    const viewBoxY = -(metrics.ascender + marginTop);
    const viewBoxWidth = Math.max(1, xAdvance + 2 * marginSide);
    const viewBoxHeight = metrics.ascender - metrics.descender + marginTop + marginBottom;

    this.width = Math.max(height, (height * viewBoxWidth) / viewBoxHeight);
    this.height = height;
    this.viewBox = `${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`;
  }
}
