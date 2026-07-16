import type { FontMetrics, GlyphPreview as GlyphPreviewValue } from "@shift/types";

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
  preview: GlyphPreviewValue | null;
  unicode: number | null;
  metrics: FontMetrics;
  height?: number;
}

export function GlyphPreview({
  preview,
  unicode,
  metrics,
  height = CELL_HEIGHT,
}: GlyphPreviewProps) {
  if (!preview) {
    return <FallbackCell metrics={metrics} height={height} unicode={unicode} advance={null} />;
  }

  return <GlyphCell metrics={metrics} height={height} preview={preview} />;
}

function GlyphCell({
  metrics,
  height,
  preview,
}: {
  metrics: FontMetrics;
  height: number;
  preview: GlyphPreviewValue;
}) {
  const svgPath = preview.svgPath;
  const advance = preview.xAdvance;

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

function FallbackCell({
  metrics,
  height,
  unicode,
  advance,
}: {
  metrics: FontMetrics;
  height: number;
  unicode: number | null;
  advance: number | null;
}) {
  const cellWidth = computeCellWidth(metrics, advance, height);
  const label = unicode === null ? "" : String.fromCodePoint(unicode);

  return (
    <div
      style={{ width: cellWidth, height }}
      className="flex items-center justify-center text-secondary"
    >
      <span className="text-2xl" style={{ fontSize: height * 0.5 }}>
        {label}
      </span>
    </div>
  );
}
