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
    const projected = items.map((item) => ({
      item,
      point: canvas.toScreen(item.point),
      prev: item.prev ? canvas.toScreen(item.prev) : null,
      rotation: canvas.toScreenAngle(item.rotation),
    }));

    canvas.withScreenSpace(() => {
      for (const { item, point, prev, rotation } of projected) {
        switch (item.shape) {
          case "direction":
            drawHandleDirection(canvas, point, rotation, item.state);
            break;
          case "first":
            drawHandleFirst(canvas, point, rotation, item.state);
            break;
          case "last":
            if (prev) drawHandleLast(canvas, point, prev, item.state);
            break;
          default:
            drawHandle(canvas, point, item.shape, item.state);
            break;
        }
      }
    });
  }
}
