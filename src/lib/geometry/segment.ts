import { Cubic } from "./cubic";
import { Line } from "./line";
import { Point } from "./point";

type SegmentType = Line | Cubic;
export class Segment {
  #points: Point[] = [];
  type: SegmentType;

  constructor(type: SegmentType, startPoint: Point) {
    this.#points[0] = startPoint;
    this.type = type;
  }

  incompleteSegment(): boolean {
    return this.#points.length < 2;
  }

  get startPoint(): Point {
    return this.#points[0];
  }

  close(endPoint: Point): void {
    this.#points[1] = endPoint;
  }

  get endPoint(): Point {
    return this.#points[1];
  }
}
