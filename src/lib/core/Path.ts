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
  #closed: boolean = false;

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
