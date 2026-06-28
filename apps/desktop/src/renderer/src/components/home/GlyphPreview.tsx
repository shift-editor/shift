import type { FontMetrics, GlyphId } from "@shift/types";
import type { Font } from "@/lib/model/Font";
import { type Signal, useSignalTrigger } from "@/lib/signals";
import type { AxisLocation } from "@/types/variation";

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
  font: Font;
  glyphId: GlyphId | null;
  unicode: number | null;
  metrics: FontMetrics;
  designLocation: Signal<AxisLocation>;
  height?: number;
}

export function GlyphPreview({
  font,
  glyphId,
  unicode,
  metrics,
  designLocation,
  height = CELL_HEIGHT,
}: GlyphPreviewProps) {
  if (!glyphId) {
    return <FallbackCell metrics={metrics} height={height} unicode={unicode} advance={null} />;
  }

  return (
    <GlyphCell
      font={font}
      metrics={metrics}
      height={height}
      glyphId={glyphId}
      unicode={unicode}
      designLocation={designLocation}
    />
  );
}

function GlyphCell({
  font,
  metrics,
  height,
  glyphId,
  unicode,
  designLocation,
}: {
  font: Font;
  metrics: FontMetrics;
  height: number;
  glyphId: GlyphId;
  unicode: number | null;
  designLocation: Signal<AxisLocation>;
}) {
  const instance = font.instance(glyphId, designLocation);
  const outline = instance?.render.outline ?? null;

  useSignalTrigger(outline?.svgPathCell);
  useSignalTrigger(instance?.xAdvanceCell);
  const svgPath = outline?.svgPath ?? "";
  const advance = instance?.xAdvance ?? null;

  const cellWidth = computeCellWidth(metrics, advance, height);
  const containerStyle = { width: cellWidth, height };

  if (!svgPath) {
    return <FallbackCell metrics={metrics} height={height} unicode={unicode} advance={advance} />;
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
