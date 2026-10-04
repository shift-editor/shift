import type { Canvas } from "../../Canvas";
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
    canvas.withScreenSpace((screen, project) => {
      for (const item of items) {
        const point = project.point(item.point);
        switch (item.shape) {
          case "direction":
            drawHandleDirection(screen, point, project.angle(item.rotation), item.state);
            break;
          case "first":
            drawHandleFirst(screen, point, project.angle(item.rotation), item.state);
            break;
          case "last":
            if (item.prev) {
              drawHandleLast(screen, point, project.point(item.prev), item.state);
            }
            break;
          default:
            drawHandle(screen, point, item.shape, item.state);
            break;
        }
      }
    });
  }
}
