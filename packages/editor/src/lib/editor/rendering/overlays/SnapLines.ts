import { Vec2, type Point2D } from "@shift/geo";
import type { PositionGuide } from "../../../../types/positionEdit";
import type { Canvas } from "../Canvas";

/** Draws direction feedback as solid lines with screen-sized endpoint crosses. */
export class SnapLines {
  /**
   * Draws direction guides without retaining feedback or changing geometry.
   *
   * @param canvas - Canvas already transformed into the units the guides are measured in.
   * @param guides - Preview feedback; metric guides are not drawn.
   */
  draw(canvas: Canvas, guides: readonly PositionGuide[]): void {
    const { color, widthPx, crossSizePx } = canvas.theme.snap;
    const crossHalf = canvas.pxToUnits(crossSizePx);
    const markers = new Map<string, Point2D>();

    for (const guide of guides) {
      if (guide.kind !== "direction") continue;

      canvas.line(guide.from, guide.to, color, widthPx);

      for (const endpoint of [guide.from, guide.to]) {
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
