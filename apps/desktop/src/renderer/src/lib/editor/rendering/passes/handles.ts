import type { Glyph, PointId } from "@shift/types";
import type { HandleState } from "@/types/graphics";
import { Vec2 } from "@shift/geo";
import { Contours } from "@shift/font";
import { DEFAULT_STYLES } from "@/lib/styles/style";
import type { DrawAPI } from "@/lib/tools/core/DrawAPI";

export function renderHandles(
  draw: DrawAPI,
  glyph: Glyph,
  getHandleState: (pointId: PointId) => HandleState,
): void {
  draw.setStyle(DEFAULT_STYLES);

  for (const contour of glyph.contours) {
    for (const { current, prev, next } of Contours.withNeighbors(contour)) {
      if (current.pointType !== "offCurve") continue;

      const anchor = next?.pointType === "offCurve" ? prev : next;
      if (!anchor || anchor.pointType === "offCurve") continue;

      draw.line(
        { x: anchor.x, y: anchor.y },
        { x: current.x, y: current.y },
        {
          strokeStyle: DEFAULT_STYLES.strokeStyle,
          strokeWidth: DEFAULT_STYLES.lineWidth,
        },
      );
    }
  }

  for (const contour of glyph.contours) {
    const numPoints = contour.points.length;
    if (numPoints === 0) continue;

    for (const { current, prev, next, isFirst, isLast } of Contours.withNeighbors(contour)) {
      const pos = { x: current.x, y: current.y };
      const handleState = getHandleState(current.id);

      if (numPoints === 1) {
        draw.handle(pos, "corner", handleState);
        continue;
      }

      if (isFirst) {
        const segmentAngle = Vec2.angleTo(current, next!);

        if (contour.closed) {
          draw.handleDirection(pos, segmentAngle, handleState);
        } else {
          draw.handleFirst(pos, segmentAngle, handleState);
        }
        continue;
      }

      if (isLast && !contour.closed) {
        draw.handleLast({ anchor: pos, prev: { x: prev!.x, y: prev!.y } }, handleState);
        continue;
      }

      if (current.pointType === "onCurve") {
        if (current.smooth) {
          draw.handle(pos, "smooth", handleState);
        } else {
          draw.handle(pos, "corner", handleState);
        }
      } else {
        draw.handle(pos, "control", handleState);
      }
    }
  }
}
