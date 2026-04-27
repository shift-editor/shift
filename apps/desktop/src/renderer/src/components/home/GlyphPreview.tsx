import type { FontMetrics } from "@shift/types";
import type { Font } from "@/lib/model/Font";
import type { GlyphView } from "@/lib/model/GlyphView";
import { useSignalState } from "@/lib/reactive";

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

interface GlyphPreviewProps {
  unicode: number;
  font: Font;
  height?: number;
}

export function GlyphPreview({ unicode, font, height = CELL_HEIGHT }: GlyphPreviewProps) {
  const name = font.nameForUnicode(unicode);
  const glyph = name ? font.glyph(name) : null;

  if (!glyph) {
    return <FallbackCell unicode={unicode} font={font} height={height} advance={null} />;
  }

  return <GlyphCell unicode={unicode} font={font} height={height} glyph={glyph} />;
}

function GlyphCell({
  unicode,
  font,
  height,
  glyph,
}: {
  unicode: number;
  font: Font;
  height: number;
  glyph: GlyphView;
}) {
  const svgPath = useSignalState(glyph.$svgPath);
  const advance = useSignalState(glyph.$advance);
  const fontMetrics = font.getMetrics();
  const cellWidth = computeCellWidth(fontMetrics, advance, height);
  const containerStyle = { width: cellWidth, height };

  if (!svgPath) {
    return <FallbackCell unicode={unicode} font={font} height={height} advance={advance} />;
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
          <path d={svgPath} fill="currentColor" fillRule="nonzero" />
        </g>
      </svg>
    </div>
  );
}

function FallbackCell({
  unicode,
  font,
  height,
  advance,
}: {
  unicode: number;
  font: Font;
  height: number;
  advance: number | null;
}) {
  const cellWidth = computeCellWidth(font.getMetrics(), advance, height);
  return (
    <div
      style={{ width: cellWidth, height }}
      className="flex items-center justify-center text-secondary"
    >
      <span className="text-2xl" style={{ fontSize: height * 0.5 }}>
        {String.fromCodePoint(unicode)}
      </span>
    </div>
  );
}
