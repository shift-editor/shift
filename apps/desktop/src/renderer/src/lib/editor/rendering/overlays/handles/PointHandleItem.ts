import { Vec2, type Point2D } from "@shift/geo";
import { Point as PointModel, type Point } from "@shift/glyph-state";
import type { HandleState } from "@/types/graphics";
import type { MarkerShape } from "../../markers/types";

export class PointHandleItem {
  point: Point;
  prev: Point | null;
  next: Point | null;
  index: number;
  count: number;
  contourClosed: boolean;
  state: HandleState;

  constructor(
    point: Point,
    prev: Point | null,
    next: Point | null,
    index: number,
    count: number,
    contourClosed: boolean,
    state: HandleState,
  ) {
    this.point = point;
    this.prev = prev;
    this.next = next;
    this.index = index;
    this.count = count;
    this.contourClosed = contourClosed;
    this.state = state;
  }

  reset(
    point: Point,
    prev: Point | null,
    next: Point | null,
    index: number,
    count: number,
    contourClosed: boolean,
    state: HandleState,
  ): void {
    this.point = point;
    this.prev = prev;
    this.next = next;
    this.index = index;
    this.count = count;
    this.contourClosed = contourClosed;
    this.state = state;
  }

  get shape(): MarkerShape {
    if (this.count === 1) return "corner";
    if (this.index === 0) return this.contourClosed ? "direction" : "first";
    if (this.index === this.count - 1 && !this.contourClosed) return "last";
    if (PointModel.isOnCurve(this.point)) return this.point.smooth ? "smooth" : "corner";
    return "control";
  }

  get rotation(): number {
    switch (this.shape) {
      case "direction":
      case "first":
        return this.next ? Vec2.angleTo(this.point, this.next) : 0;
      case "last":
        return this.prev ? Vec2.angleTo(this.point, this.prev) + Math.PI / 2 : 0;
      default:
        return 0;
    }
  }

  isVisibleInScene(
    drawOffset: Point2D,
    bounds: { minX: number; maxX: number; minY: number; maxY: number },
  ): boolean {
    const x = this.point.x + drawOffset.x;
    const y = this.point.y + drawOffset.y;
    return x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
  }
}
