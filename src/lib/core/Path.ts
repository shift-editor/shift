import { Segment } from "../../types/segments";
import { Point } from "../geometry/point";
import { EntityId, Ident } from "./EntityId";

export enum PointType {
  OnCurve,
  OffCurve,
}

export class PathPoint extends Point {
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

export class Path {
  #id: EntityId;
  #points: PathPoint[] = [];

  constructor() {
    this.#id = new EntityId();
  }

  get points(): PathPoint[] {
    return this.#points;
  }

  get id(): Ident {
    return this.#id.id;
  }

  segments(): Segment[] {
    const segments: Segment[] = [];

    let i = 0;
    while (i < this.#points.length) {
      const point = this.#points[i];
      if (point.type === PointType.OnCurve) {
        segments.push({
          type: "line",
          start: point,
          end: this.#points[i + 1],
        });
      }

      i += 2;
    }

    return segments;
  }
}
