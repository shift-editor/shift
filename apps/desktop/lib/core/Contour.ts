import { PointType, IContourPoint } from '@shift/shared';

import { EntityId, Ident } from '@/lib/core/EntityId';
import { Point } from '@/lib/math/point';
import { Shape } from '@/lib/math/shape';
import { Point2D } from '@/types/math';
import { CubicSegment, LineSegment, Segment } from '@/types/segments';

export class ContourPoint extends Point implements IContourPoint {
  #id: EntityId;
  #pointType: PointType;
  #smooth: boolean = false;

  constructor(x: number, y: number, pointType: PointType, parentId: Ident) {
    super(x, y);

    this.#pointType = pointType;
    this.#id = new EntityId(parentId);
  }

  static fromPoint2D(point: Point2D, pointType: PointType, parentId: Ident) {
    return new ContourPoint(point.x, point.y, pointType, parentId);
  }

  movePointTo(x: number, y: number) {
    this.set_x(x);
    this.set_y(y);
  }

  get entityId(): EntityId {
    return this.#id;
  }

  get pointType(): PointType {
    return this.#pointType;
  }

  get smooth(): boolean {
    return this.#smooth;
  }

  toggleSmooth() {
    this.#smooth = true;
  }
}

class SegmentIterator implements Iterator<Segment> {
  #points: ContourPoint[];
  #index: number = 0;
  #closed: boolean = false;

  public constructor(points: ContourPoint[], closed: boolean) {
    this.#closed = closed;
    this.#points = points;
  }

  public next(): IteratorResult<Segment> {
    if (this.#index === -1) {
      return {
        done: true,
        value: undefined,
      };
    }

    if (this.#points.length < 2) {
      return {
        done: true,
        value: {},
      };
    }

    if (this.#index >= this.#points.length - 1) {
      if (this.#closed) {
        const p1 = this.#points[this.#index];
        const p2 = this.#points[(this.#index + 1) % this.#points.length];

        const segment: LineSegment = {
          type: 'line',
          points: {
            anchor1: p1,
            anchor2: p2,
          },
        };

        this.#index = -1;

        return {
          done: false,
          value: segment,
        };
      }

      return {
        done: true,
        value: undefined,
      };
    }

    const p1 = this.#points[this.#index];
    const p2 = this.#points[this.#index + 1];

    if (p1.pointType === 'onCurve' && p2.pointType === 'onCurve') {
      const segment: LineSegment = {
        type: 'line',
        points: {
          anchor1: p1,
          anchor2: p2,
        },
      };

      this.#index += 1;

      return {
        done: false,
        value: segment,
      };
    }

    if (p1.pointType === 'onCurve' && p2.pointType === 'offCurve') {
      const p3 = this.#points[this.#index + 2];
      const p4 = this.#points[this.#index + 3];

      const segment: CubicSegment = {
        type: 'cubic',
        points: {
          anchor1: p1,
          control1: p2,
          control2: p3,
          anchor2: p4,
        },
      };

      this.#index += 3;

      return {
        done: false,
        value: segment,
      };
    }

    return {
      done: true,
      value: undefined,
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

  addPoint(x: number, y: number): EntityId {
    const p = new ContourPoint(x, y, 'onCurve', this.#id.id);
    this.#points.push(p);
    return p.entityId;
  }

  upgradeLineSegment(id: EntityId): EntityId {
    const index = this.#points.findIndex((p) => p.entityId.id === id.id);

    if (index === -1) {
      console.error('No index found for point');
      return id;
    }

    const p1 = this.#points[index - 1];
    const p3 = this.#points[index];

    const c1 = p1.lerp(p3, 1.0 / 3.0);
    const c2 = p1.lerp(p3, 2.0 / 3.0);

    const control1 = new ContourPoint(c1.x, c1.y, 'offCurve', this.#id.id);
    const control2 = new ContourPoint(c2.x, c2.y, 'offCurve', this.#id.id);

    this.#points.splice(index, 0, control1, control2);

    return p1.entityId;
  }

  [Symbol.iterator](): Iterator<Segment> {
    return new SegmentIterator(this.#points, this.#closed);
  }

  segments(): Segment[] {
    return [...this];
  }

  lastPoint(): ContourPoint {
    return this.#points[this.#points.length - 1];
  }

  firstPoint(): ContourPoint {
    return this.#points[0];
  }

  get entityId(): EntityId {
    return this.#id;
  }

  closed(): boolean {
    return this.#closed;
  }

  close() {
    this.#closed = true;
  }

  isEmpty(): boolean {
    return this.#points.length === 0;
  }

  isClockwise(): boolean {
    return Shape.shoelace(this.#points) > 0;
  }
}
