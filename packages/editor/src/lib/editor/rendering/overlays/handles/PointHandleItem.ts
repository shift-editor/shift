import { Vec2 } from "@shift/geo";
import { Point } from "@shift/glyph-state";
import type { HandleState } from "../../../../../types/graphics";
import type { MarkerShape } from "../../markers/types";
import { showsMetricMarker } from "../../markers/handleStyles";

export class PointHandleItem {
  point: Point;
  prev: Point | null;
  next: Point | null;
  index: number;
  count: number;
  contourClosed: boolean;
  state: HandleState;
  /** Whether this on-curve point rests exactly on a standard metric line. */
  onMetric: boolean;

  constructor(
    point: Point,
    prev: Point | null,
    next: Point | null,
    index: number,
    count: number,
    contourClosed: boolean,
    state: HandleState,
    onMetric: boolean,
  ) {
    this.point = point;
    this.prev = prev;
    this.next = next;
    this.index = index;
    this.count = count;
    this.contourClosed = contourClosed;
    this.state = state;
    this.onMetric = onMetric;
  }

  reset(
    point: Point,
    prev: Point | null,
    next: Point | null,
    index: number,
    count: number,
    contourClosed: boolean,
    state: HandleState,
    onMetric: boolean,
  ): void {
    this.point = point;
    this.prev = prev;
    this.next = next;
    this.index = index;
    this.count = count;
    this.contourClosed = contourClosed;
    this.state = state;
    this.onMetric = onMetric;
  }

  /** Whether this handle draws the on-metric halo and stroke in its current state. */
  get showsMetricMarker(): boolean {
    return this.onMetric && showsMetricMarker(this.state);
  }

  get shape(): MarkerShape {
    if (this.count === 1) return "corner";
    if (this.index === 0) return this.contourClosed ? "direction" : "first";
    if (this.index === this.count - 1 && !this.contourClosed) return "last";
    if (Point.isOnCurve(this.point)) return this.point.smooth ? "smooth" : "corner";
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
}
