import type { FontMetrics } from "@shift/types";
import type { Font } from "@/lib/model/Font";
import type { Glyph } from "@/lib/model/Glyph";
import { useSignalState } from "@/lib/signals";
import { getEditor } from "@/store/appStore";
import type { GlyphHandle } from "@shift/bridge";

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
  handle: GlyphHandle;
  font: Font;
  height?: number;
}

export function GlyphPreview({ handle, font, height = CELL_HEIGHT }: GlyphPreviewProps) {
  if (!font.loaded) {
    return <FallbackCell handle={handle} font={font} height={height} advance={null} />;
  }

  const glyph = font.glyph(handle);
  if (!glyph) {
    return <FallbackCell handle={handle} font={font} height={height} advance={null} />;
  }

  return <GlyphCell font={font} height={height} glyph={glyph} />;
}

function GlyphCell({ font, height, glyph }: { font: Font; height: number; glyph: Glyph }) {
  const editor = getEditor();
  const outline = glyph.instance(editor.$designLocation).render.outline;

  const svgPath = useSignalState(outline.$svgPath);
  const advance = useSignalState(glyph.$xAdvance);

  const fontMetrics = font.metrics;

  const cellWidth = computeCellWidth(fontMetrics, advance, height);
  const containerStyle = { width: cellWidth, height };

  if (!svgPath) {
    return <FallbackCell handle={glyph.handle} font={font} height={height} advance={advance} />;
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
  handle,
  font,
  height,
  advance,
}: {
  handle: GlyphHandle;
  font: Font;
  height: number;
  advance: number | null;
}) {
  const cellWidth = computeCellWidth(font.metrics, advance, height);
  let label: string = "";

  const record = font.recordForName(handle.name);
  if (record && record.unicodes.length > 0) {
    label = String.fromCodePoint(record.unicodes[0]);
  }

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
