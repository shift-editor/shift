import type { CatalogMetrics } from "@shift/types";
import { GlyphPreviewLayout } from "@/components/home/GlyphPreviewLayout";
import type { GlyphPreviewValue } from "@/types/glyphPreview";

interface GlyphPreviewSvgProps {
  readonly preview: GlyphPreviewValue;
  readonly metrics: CatalogMetrics;
  /** The box the outline is fitted into, in CSS pixels. */
  readonly width: number;
  readonly height: number;
}

/** A glyph's outline fitted between the font's vertical metrics, in the text colour. */
export function GlyphPreviewSvg({ preview, metrics, width, height }: GlyphPreviewSvgProps) {
  const layout = new GlyphPreviewLayout(metrics, preview.xAdvance, height);

  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={layout.viewBox}
      preserveAspectRatio="xMidYMid meet"
      className="overflow-hidden"
    >
      <g transform="scale(1, -1)">
        <path d={preview.svgPath} fill="currentColor" fillRule="nonzero" />
      </g>
    </svg>
  );
}
