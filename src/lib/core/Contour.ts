import { EntityId, Ident } from "./EntityId";
import { Segment } from "../../types/segments";
import { Point } from "../geometry/point";

export type PointType = "onCurve" | "offCurve";
export class ContourPoint extends Point {
  #id: EntityId;
  #type: PointType;

  constructor(x: number, y: number, pointType: PointType, parentId: Ident) {
    super(x, y);

    this.#type = pointType;
    this.#id = new EntityId(parentId);
  }

  get id(): Ident {
    return this.#id.id;
  }

  get type(): PointType {
    return this.#type;
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

  get lastPoint(): ContourPoint {
    return this.#points[this.#points.length - 1];
  }

  get id(): Ident {
    return this.#id.id;
  }

  segments(): Segment[] {
    const segments: Segment[] = [];

    let i = 0;
    while (i < this.#points.length) {
      const point = this.#points[i];
      if (point.type === "onCurve") {
        segments.push({
          type: "line",
          anchor: point,
        });
      }

      i += 1;
    }

    return segments;
  }

  get closed(): boolean {
    return this.#closed;
  }

  close() {
    this.#points.pop();
    this.#closed = true;
  }
}
