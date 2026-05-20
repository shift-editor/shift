import type { Canvas } from "../../Canvas";
import {
  drawHandle,
  drawHandleDirection,
  drawHandleFirst,
  drawHandleLast,
} from "../handleDrawing";
import type { PointHandleItem } from "./PointHandleItem";

export class CanvasHandleRenderer {
  draw(canvas: Canvas, items: readonly PointHandleItem[]): void {
    for (const item of items) {
      switch (item.shape) {
        case "direction":
          drawHandleDirection(canvas, item.point, item.rotation, item.state);
          break;
        case "first":
          drawHandleFirst(canvas, item.point, item.rotation, item.state);
          break;
        case "last":
          if (item.prev)
            drawHandleLast(canvas, item.point, item.prev, item.state);
          break;
        default:
          drawHandle(canvas, item.point, item.shape, item.state);
          break;
      }
    }
  }
}
