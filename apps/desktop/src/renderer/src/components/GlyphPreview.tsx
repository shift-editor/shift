import { memo } from "react";
import { useSignalState } from "@/lib/reactive";
import { computeViewBoxHeight, glyphDataStore, glyphPreviewViewBox } from "@/store/GlyphDataStore";
import type { FontMetrics } from "@shift/types";

export const CELL_HEIGHT = 75;

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
  useSignalState(glyphDataStore.getGlyphVersion(unicode));
  const advance = glyphDataStore.getAdvance(unicode);
  const cellWidth = computeCellWidth(fontMetrics, advance, height);
  const containerStyle = { width: cellWidth, height };
  const path = glyphDataStore.getSvgPath(unicode);

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
