import { Mat } from "@shift/geo";
import type { GlyphRenderModel } from "./Glyph";
import type { GlyphRenderInput } from "@/types/glyphRender";

/** Projects the authored render model onto the source-independent canvas boundary. */
export function glyphRenderInput(view: GlyphRenderModel): GlyphRenderInput {
  return {
    contours: view.contours.map((contour) => ({
      contour: {
        points: contour.contour.points.map((point) => ({
          ...Mat.applyToPoint(contour.transform, point),
          pointType: point.pointType,
          smooth: point.smooth,
        })),
        closed: contour.contour.closed,
      },
      root: contour.component === null,
      path: contour.path,
      svgPath: contour.svgPath,
      bounds: contour.bounds,
    })),
    anchors: view.anchors.map((anchor) => ({
      name: anchor.name,
      x: anchor.x,
      y: anchor.y,
    })),
    drawPath: view.drawPath,
    bounds: view.bounds,
    xAdvance: view.xAdvance,
  };
}
