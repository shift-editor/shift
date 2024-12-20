import { Point } from "./point";

export enum SegmentType {
  Line,
  Bezier,
}

type ControlPoints = [Point, Point];

export class Segment {
  #points: Point[] = [];
  #controlPoints: ControlPoints = [new Point(20, 30), new Point(30, 100)];
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

  set controlPoints(controlPoints: ControlPoints) {
    // TODO: handle if points is != 2
    this.#controlPoints[0] = controlPoints[0];
    this.#controlPoints[1] = controlPoints[1];
  }

  get controlPoints(): ControlPoints {
    return this.#controlPoints;
  }
}
