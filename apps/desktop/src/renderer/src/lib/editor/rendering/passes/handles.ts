/**
 * Handle render pass -- draws on-curve and off-curve point handles for the active glyph.
 *
 * Operates in UPM space via the {@link DrawAPI}, which internally converts
 * screen-pixel sizes to UPM units. Two sub-passes run in order:
 * 1. Control-point tether lines connecting off-curve handles to their anchors.
 * 2. Handle shapes (corner, smooth, control, direction, first, last) with
 *    per-point interaction state (idle / hovered / selected).
 */

import type { Glyph, PointId } from "@shift/types";
import type { HandleState } from "@/types/graphics";
import { Vec2 } from "@shift/geo";
import { Contours } from "@shift/font";
import { Validate } from "@shift/validation";
import { DEFAULT_STYLES } from "@/lib/styles/style";
import type { DrawAPI } from "@/lib/tools/core/DrawAPI";

/**
 * Draws all point handles for the glyph, including off-curve tether lines.
 * `getHandleState` is called per point to determine visual styling.
 */
export function renderHandles(
  draw: DrawAPI,
  glyph: Glyph,
  getHandleState: (pointId: PointId) => HandleState,
): void {
  draw.setStyle(DEFAULT_STYLES);

  for (const contour of glyph.contours) {
    for (const { current, prev, next } of Contours.withNeighbors(contour)) {
      if (!Validate.isOffCurve(current)) continue;

      const anchor = next && Validate.isOffCurve(next) ? prev : next;
      if (!anchor || Validate.isOffCurve(anchor)) continue;

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

      if (Validate.isOnCurve(current)) {
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
