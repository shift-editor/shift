import { Vec2, type Point2D } from "@shift/geo";
import type { PositionGuide } from "@/types/positionEdit";
import type { Canvas } from "../Canvas";

/** Draws direction feedback as solid lines with screen-sized endpoint crosses. */
export class SnapLines {
  /**
   * Draws direction guides in scene space without retaining feedback or changing geometry.
   *
   * @param canvas - Overlay canvas already transformed into scene space.
   * @param guides - Glyph-local preview feedback; metric guides are not drawn.
   * @param nodePosition - Scene placement of the glyph that owns the preview.
   */
  draw(canvas: Canvas, guides: readonly PositionGuide[], nodePosition: Point2D): void {
    const { color, widthPx, crossSizePx } = canvas.theme.snap;
    const crossHalf = canvas.pxToUpm(crossSizePx);
    const markers = new Map<string, Point2D>();

    for (const guide of guides) {
      if (guide.kind !== "direction") continue;

      const from = Vec2.add(nodePosition, guide.from);
      const to = Vec2.add(nodePosition, guide.to);
      canvas.line(from, to, color, widthPx);

      for (const endpoint of [from, to]) {
        markers.set(`${endpoint.x}:${endpoint.y}`, endpoint);
      }
    }

    const diagonal: Point2D = { x: crossHalf, y: crossHalf };
    const antiDiagonal: Point2D = { x: crossHalf, y: -crossHalf };

    for (const marker of markers.values()) {
      canvas.line(Vec2.sub(marker, diagonal), Vec2.add(marker, diagonal), color, widthPx);
      canvas.line(Vec2.sub(marker, antiDiagonal), Vec2.add(marker, antiDiagonal), color, widthPx);
    }
  }
}
