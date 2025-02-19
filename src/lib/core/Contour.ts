import { EntityId, Ident } from "@/lib/core/EntityId";
import { Point } from "@/lib/geometry/point";
import { Point2D } from "@/types/math";
import { CubicSegment, LineSegment, Segment } from "@/types/segments";

export type PointType = "onCurve" | "offCurve";
export class ContourPoint extends Point {
  #id: EntityId;
  #type: PointType;
  #smooth: boolean = false;

  constructor(x: number, y: number, pointType: PointType, parentId: Ident) {
    super(x, y);

    this.#type = pointType;
    this.#id = new EntityId(parentId);
  }

  static fromPoint2D(point: Point2D, pointType: PointType, parentId: Ident) {
    return new ContourPoint(point.x, point.y, pointType, parentId);
  }

  get id(): Ident {
    return this.#id.id;
  }

  get type(): PointType {
    return this.#type;
  }

  get smooth(): boolean {
    return this.#smooth;
  }
}

class SegmentIterator implements Iterator<Segment> {
  #points: ContourPoint[];
  #index: number = 0;

  public constructor(points: ContourPoint[]) {
    this.#points = points;
  }

  public next(): IteratorResult<Segment> {
    if (this.#points.length < 2) {
      return {
        done: true,
        value: {},
      };
    }

    if (this.#index >= this.#points.length) {
      return {
        done: true,
        value: {},
      };
    }

    const p1 = this.#points[this.#index];
    const p2 = this.#points[this.#index + 1];

    if (p1.type === "onCurve" && p2.type === "onCurve") {
      const segment: LineSegment = {
        type: "line",
        anchor0: p1,
        anchor1: p2,
      };

      this.#index += 2;

      return {
        done: false,
        value: segment,
      };
    }

    if (p1.type === "onCurve" && p2.type === "offCurve") {
      const p3 = this.#points[this.#index + 2];
      const p4 = this.#points[this.#index + 3];

      const segment: CubicSegment = {
        type: "cubic",
        anchor0: p1,
        control0: p2,
        control1: p3,
        anchor1: p4,
      };

      this.#index += 3;

      return {
        done: false,
        value: segment,
      };
    }

    return {
      done: true,
      value: {},
    };
  }
}

export class Contour {
  #id: EntityId;
  #points: ContourPoint[] = [];
  #closed: boolean = false;

  constructor() {
    this.#id = new EntityId();
  }

  get points(): ContourPoint[] {
    return this.#points;
  }

  addPoint(point: Point2D) {
    this.#points.push(ContourPoint.fromPoint2D(point, "onCurve", this.#id.id));
  }

  upgradeLineSegment(id: Ident) {
    const index = this.#points.findIndex((p) => p.id === id);
  }

  [Symbol.iterator](): Iterator<Segment> {
    return new SegmentIterator(this.#points);
  }

  segments(): Segment[] {
    return [...this];
  }

  get lastPoint(): ContourPoint {
    return this.#points[this.#points.length - 1];
  }

  get id(): Ident {
    return this.#id.id;
  }

  get closed(): boolean {
    return this.#closed;
  }

  close() {
    this.#points.pop();
    this.#closed = true;
  }
}
