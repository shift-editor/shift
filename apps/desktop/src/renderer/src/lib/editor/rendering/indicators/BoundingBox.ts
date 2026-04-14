import type { Rect2D } from "@shift/types";
import type { Canvas } from "../Canvas";
import { getHandlePositions } from "@/lib/editor/hit/boundingBox";

export class BoundingBox {
  /** Draws the dashed bounding rectangle in UPM space. */
  drawRect(canvas: Canvas, rect: Rect2D): void {
    const { stroke, widthPx, dash } = canvas.theme.boundingBox;
    canvas.strokeRect(rect.x, rect.y, rect.width, rect.height, stroke, widthPx, dash);
  }

  /** Draws corner and midpoint resize handles in screen space. */
  drawHandles(canvas: Canvas, screenRect: Rect2D): void {
    const styles = canvas.theme.boundingBox;
    const { radius, offset, stroke, widthPx } = styles.handle;
    const handles = getHandlePositions(screenRect, offset, styles.rotationZoneOffset, "down");

    const cornerKeys = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;
    for (const key of cornerKeys) {
      const pos = handles.corners[key];
      canvas.screenCircle(pos, radius, "transparent", stroke, widthPx);
    }

    const midpointKeys = ["top", "bottom", "left", "right"] as const;
    for (const key of midpointKeys) {
      const pos = handles.midpoints[key];
      canvas.screenCircle(pos, radius, "transparent", stroke, widthPx);
    }
  }
}
