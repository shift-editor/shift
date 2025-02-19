import { EntityId, Ident } from "@/lib/core/EntityId";
import { Point } from "@/lib/geometry/point";
import { Point2D } from "@/types/math";
import { Segment } from "@/types/segments";

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

// class SegmentIterator implements Iterator<Segment> {
//   #points: ContourPoint[];
//   #index: number = 0;

//   public constructor(points: ContourPoint[]) {
//     this.#points = points;
//   }

//   public next(): IteratorResult<Segment> {
//     if (this.#points.length < 2) {
//       return {
//         done: true,
//         value: {},
//       };
//     }
//   }
// }

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
