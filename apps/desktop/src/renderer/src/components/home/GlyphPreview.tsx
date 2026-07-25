import type { SourceMetrics } from "@shift/types";
import { GlyphPreviewLayout } from "./GlyphPreviewLayout";

export const CELL_HEIGHT = 75;

export interface GlyphGridPreview {
  readonly svgPath: string;
  readonly xAdvance: number;
}

interface GlyphPreviewProps {
  preview: GlyphGridPreview;
  metrics: SourceMetrics;
  height?: number;
}

export function GlyphPreview({ preview, metrics, height = CELL_HEIGHT }: GlyphPreviewProps) {
  const layout = new GlyphPreviewLayout(metrics, preview.xAdvance, height);
  const containerStyle = { width: layout.width, height: layout.height };

  if (!preview.svgPath) return <div style={containerStyle} />;

  return (
    <div style={containerStyle} className="flex items-center justify-center">
      <svg
        width="100%"
        height="100%"
        viewBox={layout.viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="overflow-hidden"
      >
        <g transform="scale(1, -1)">
          <path d={preview.svgPath} fill="currentColor" fillRule="nonzero" />
        </g>
      </svg>
    </div>
  );
}
