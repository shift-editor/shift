import { Mat, type Bounds } from "@shift/geo";
import type { Contour } from "@shift/glyph-state";
import { ContourPath } from "@shift/editor/rendering";
import type { GlyphIconFrame, PlacedContour } from "@/types/objectTree";

/**
 * A square icon that outlines are drawn into: y-down, `size` pixels a side,
 * with `padding` inside each edge.
 */
export class IconBox {
  readonly size: number;
  readonly padding: number;

  constructor(size: number, padding: number) {
    this.size = size;
    this.padding = padding;
  }

  /** A contour's icon: the contour fitted to the box, or undefined when it has no extent. */
  contourPath(contour: Contour): string | undefined {
    const fit = this.#fitBounds(contour.bounds);
    return fit ? ContourPath.fromContour(contour, fit).svgPath : undefined;
  }

  /**
   * A whole glyph's icon, components included.
   *
   * @remarks
   * Every glyph is drawn at the same scale, the font's height from descender
   * to ascender fitting the box, and centred on its advance, so a dot stays
   * small and a wide form stays wide, as in the glyph grid.
   *
   * @returns undefined for a glyph with no contours or a font with no height.
   */
  glyphPath(contours: readonly PlacedContour[], frame: GlyphIconFrame): string | undefined {
    const height = frame.ascender - frame.descender;
    if (contours.length === 0 || height <= 0) return undefined;

    const scale = (this.size - this.padding * 2) / height;
    const fit = new Mat(
      scale,
      0,
      0,
      -scale,
      (this.size - frame.advance * scale) / 2,
      this.padding + frame.ascender * scale,
    );
    return contours
      .map(
        ({ contour, transform }) =>
          ContourPath.fromContour(contour, Mat.Compose(fit, transform)).svgPath,
      )
      .join(" ");
  }

  /** Fits bounds, y-up, into the box, centred; null for bounds with no extent. */
  #fitBounds(bounds: Bounds | null): Mat | null {
    if (!bounds) return null;

    const width = bounds.max.x - bounds.min.x;
    const height = bounds.max.y - bounds.min.y;
    const longestSide = Math.max(width, height);
    if (longestSide === 0) return null;

    const contentSize = this.size - this.padding * 2;
    const scale = contentSize / longestSide;
    const translateX = this.padding + (contentSize - width * scale) / 2 - bounds.min.x * scale;
    const translateY = this.padding + (contentSize - height * scale) / 2 + bounds.max.y * scale;
    return new Mat(scale, 0, 0, -scale, translateX, translateY);
  }
}

/** The box a contour row's icon is drawn in. */
export const CONTOUR_ICON = new IconBox(14, 1);
/** The box the glyph row's preview is drawn in. */
export const GLYPH_ICON = new IconBox(16, 1);
