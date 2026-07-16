import type { FontMetrics } from "@shift/types";
import { useSignalState } from "@/lib/signals";
import type { GlyphView } from "@/lib/model/Glyph";

export const CELL_HEIGHT = 75;

export const MARGIN_TOP_RATIO = 0.2;
export const MARGIN_BOTTOM_RATIO = 0.05;
export const MARGIN_SIDE_RATIO = 0;

export function glyphPreviewViewBox(metrics: FontMetrics, advance: number | null): string {
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

export function computeCellWidth(
  metrics: FontMetrics,
  advance: number | null,
  cellHeight: number,
): number {
  if (advance === null) {
    return cellHeight;
  }

  const viewBoxHeight = computeViewBoxHeight(metrics);
  const width = (cellHeight * Math.max(1, advance)) / viewBoxHeight;
  return Math.max(cellHeight, width);
}

interface GlyphPreviewProps {
  view: GlyphView | null;
  metrics: FontMetrics;
  height?: number;
}

export function GlyphPreview({ view, metrics, height = CELL_HEIGHT }: GlyphPreviewProps) {
  if (!view) {
    // Showing the system font here makes fast scrolling flash the wrong glyph
    // before the authored projection arrives.
    return <div style={{ width: height, height }} />;
  }

  return <GlyphCell metrics={metrics} height={height} view={view} />;
}

function GlyphCell({
  metrics,
  height,
  view,
}: {
  metrics: FontMetrics;
  height: number;
  view: GlyphView;
}) {
  const svgPath = useSignalState(view.render.outline.svgPathCell, { schedule: "frame" });
  const advance = useSignalState(view.xAdvanceCell, { schedule: "frame" });

  const cellWidth = computeCellWidth(metrics, advance, height);
  const containerStyle = { width: cellWidth, height };

  if (!svgPath) {
    return <div style={containerStyle} />;
  }

  const viewBox = glyphPreviewViewBox(metrics, advance);

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
          <path d={svgPath} fill="currentColor" fillRule="nonzero" />
        </g>
      </svg>
    </div>
  );
}
