import { Mat } from "@shift/geo";
import { angleThrough, type Canvas } from "../../Canvas";
import { drawHandle, drawHandleDirection, drawHandleFirst, drawHandleLast } from "../handleDrawing";
import type { PointHandleItem } from "./PointHandleItem";

/** Draws point handles on the 2D canvas when the marker layer is unavailable. */
export class CanvasHandleRenderer {
  /**
   * Draws handles at their projected positions, sized and rotated in screen pixels.
   *
   * @param canvas - Canvas in the units the handle points are measured in.
   */
  draw(canvas: Canvas, items: readonly PointHandleItem[]): void {
    // Captured before entering screen space, where the canvas transform becomes identity.
    const toScreen = Mat.Copy(canvas.transform);
    const screenAngle = (angle: number) => angleThrough(toScreen, angle);

    canvas.withScreenSpace(() => {
      for (const item of items) {
        const point = Mat.applyToPoint(toScreen, item.point);
        switch (item.shape) {
          case "direction":
            drawHandleDirection(canvas, point, screenAngle(item.rotation), item.state);
            break;
          case "first":
            drawHandleFirst(canvas, point, screenAngle(item.rotation), item.state);
            break;
          case "last":
            if (item.prev) {
              drawHandleLast(canvas, point, Mat.applyToPoint(toScreen, item.prev), item.state);
            }
            break;
          default:
            drawHandle(canvas, point, item.shape, item.state);
            break;
        }
      }
    });
  }
}
