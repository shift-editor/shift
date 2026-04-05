import { memo } from "react";
import type { FontMetrics } from "@shift/types";
import { getNative } from "@/engine/native";

export const CELL_HEIGHT = 75;

export const MARGIN_TOP_RATIO = 0.2;
export const MARGIN_BOTTOM_RATIO = 0.05;
export const MARGIN_SIDE_RATIO = 0;

export function glyphPreviewViewBox(metrics: FontMetrics | null, advance: number | null): string {
  if (!metrics) {
    return "0 -800 1000 1000";
  }

  const upm = metrics.unitsPerEm;
  const marginTop = upm * MARGIN_TOP_RATIO;
  const marginBottom = upm * MARGIN_BOTTOM_RATIO;
  const marginSide = upm * MARGIN_SIDE_RATIO;
  const x = -marginSide;
  const y = -(metrics.ascender + marginTop);
  const w = Math.max(1, (advance ?? upm) + 2 * marginSide);
  const h = metrics.ascender - metrics.descender + marginTop + marginBottom;
  return `${x} ${y} ${w} ${h}`;
}

export function computeViewBoxHeight(metrics: FontMetrics): number {
  const upm = metrics.unitsPerEm;
  const marginTop = upm * MARGIN_TOP_RATIO;
  const marginBottom = upm * MARGIN_BOTTOM_RATIO;
  return metrics.ascender - metrics.descender + marginTop + marginBottom;
}

export interface GlyphPreviewProps {
  unicode: number;
  height?: number;
  fontMetrics: FontMetrics | null;
}

export function computeCellWidth(
  metrics: FontMetrics | null,
  advance: number | null,
  cellHeight: number,
): number {
  if (!metrics || advance === null) {
    return cellHeight;
  }

  const viewBoxHeight = computeViewBoxHeight(metrics);
  const width = (cellHeight * Math.max(1, advance)) / viewBoxHeight;
  return Math.max(cellHeight, width);
}

export const GlyphPreview = memo(function GlyphPreview({
  unicode,
  height = CELL_HEIGHT,
  fontMetrics,
}: GlyphPreviewProps) {
  const native = getNative();
  const advance = native.getGlyphAdvance(unicode) ?? null;
  const cellWidth = computeCellWidth(fontMetrics, advance, height);
  const containerStyle = { width: cellWidth, height };
  const path = native.getGlyphSvgPath(unicode) ?? null;

  if (!path) {
    return (
      <div style={containerStyle} className="flex items-center justify-center text-secondary">
        <span className="text-2xl" style={{ fontSize: height * 0.5 }}>
          {String.fromCodePoint(unicode)}
        </span>
      </div>
    );
  }

  const viewBox = glyphPreviewViewBox(fontMetrics, advance);

  return (
    <div style={containerStyle} className="flex items-center justify-center">
      <svg
        width="100%"
        height="100%"
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="overflow-hidden"
      >
        <g transform="scale(1, -1)">
          <path d={path} fill="currentColor" fillRule="nonzero" />
        </g>
      </svg>
    </div>
  );
});
