import type { CatalogMetrics } from "@shift/types";

const MARGIN_TOP_RATIO = 0.2;
const MARGIN_BOTTOM_RATIO = 0.05;
const MARGIN_SIDE_RATIO = 0;

/** Immutable dimensions for one complete Glyph preview output. */
export class GlyphPreviewLayout {
  readonly width: number;
  readonly height: number;
  readonly viewBox: string;

  constructor(metrics: CatalogMetrics, xAdvance: number, height: number) {
    const marginSide = GlyphPreviewLayout.sideMargin(metrics);
    const viewBoxX = -marginSide;
    const viewBoxWidth = Math.max(1, xAdvance + 2 * marginSide);
    const [viewBoxHeight, fontTop] = GlyphPreviewLayout.fontViewport(metrics);

    this.width = Math.max(height, (height * viewBoxWidth) / viewBoxHeight);
    this.height = height;
    this.viewBox = `${viewBoxX} ${-fontTop} ${viewBoxWidth} ${viewBoxHeight}`;
  }

  /** Shared horizontal margin used by fallback and resident previews. */
  static sideMargin(metrics: CatalogMetrics): number {
    return metrics.unitsPerEm * MARGIN_SIDE_RATIO;
  }

  /** Shared font-space viewport used by fallback and resident previews. */
  static fontViewport(metrics: CatalogMetrics): readonly [viewHeight: number, fontTop: number] {
    const marginTop = metrics.unitsPerEm * MARGIN_TOP_RATIO;
    const marginBottom = metrics.unitsPerEm * MARGIN_BOTTOM_RATIO;
    return [
      metrics.ascender - metrics.descender + marginTop + marginBottom,
      metrics.ascender + marginTop,
    ];
  }
}
