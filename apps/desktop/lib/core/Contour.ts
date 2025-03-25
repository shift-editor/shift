import { IContour, IContourPoint, PointType } from '@shift/shared';

import { EntityId, Ident } from '@/lib/core/EntityId';
import { Point } from '@/lib/math/point';
import { Shape } from '@/lib/math/shape';
import { CubicSegment, LineSegment, QuadSegment, Segment } from '@/types/segments';

import { CyclingCollection } from './common';

export class ContourPoint extends Point implements IContourPoint {
  #id: EntityId;
  #pointType: PointType;
  #smooth: boolean;

  constructor(x: number, y: number, pointType: PointType, parentId: Ident, smooth?: boolean) {
    super(x, y);

    this.#pointType = pointType;
    this.#id = new EntityId(parentId);
    this.#smooth = smooth ?? false;
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

  isOnCurve(): boolean {
    return this.#pointType === 'onCurve';
  }

  isOffCurve(): boolean {
    return this.#pointType === 'offCurve';
  }

  toggleSmooth() {
    this.#smooth = !this.#smooth;
  }
}

class SegmentIterator implements Iterator<Segment> {
  #points: CyclingCollection<ContourPoint> | null;
  #index: number = 0;
  #closed: boolean = false;

  public constructor(points: ContourPoint[], closed: boolean) {
    this.#closed = closed;
    this.#points = CyclingCollection.create(points);
  }

  public next(): IteratorResult<Segment> {
    if (this.#points === null) {
      return {
        done: true,
        value: undefined,
      };
    }

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
        const p1 = this.#points.moveTo(this.#index);
        const p2 = this.#points.next();

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

    const p1 = this.#points.current();
    const p2 = this.#points.next();

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
      const p3 = this.#points.next();

      if (p3.pointType === 'onCurve') {
        // This is a quadratic Bezier curve
        const segment: QuadSegment = {
          type: 'quad',
          points: {
            anchor1: p1,
            control: p2,
            anchor2: p3,
          },
        };

        this.#index += 2;

        return {
          done: false,
          value: segment,
        };
      }

      const p4 = this.#points.next();

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

export class Contour implements IContour {
  #id: EntityId;
  #points: ContourPoint[] = [];
  #closed: boolean = false;

  constructor() {
    this.#id = new EntityId();
  }

  //**
  // * Returns a copy of the points array
  // */
  get points(): ContourPoint[] {
    return [...this.#points];
  }

  pointCursor(): CyclingCollection<ContourPoint> {
    return CyclingCollection.create(this.#points);
  }

  addPoint(x: number, y: number, pointType: PointType, smooth?: boolean): EntityId {
    const p = new ContourPoint(x, y, pointType, this.#id.id, smooth);
    this.#points.push(p);
    return p.entityId;
  }

  removePoint(id: EntityId): ContourPoint | undefined {
    const index = this.#points.findIndex((p) => p.entityId.id === id.id);
    if (index === -1) {
      console.error('No index found for point');
      return;
    }

    const point = this.#points[index];
    this.#points.splice(index, 1);

    return point;
  }

  upgradeLineSegment(id: EntityId): EntityId {
    const index = this.#points.findIndex((p) => p.entityId.id === id.id);

    if (index === -1) {
      console.error('No index found for point');
      return id;
    }

    const pointCursor = this.pointCursor();
    const p1 = pointCursor.moveTo(index - 1);
    const p3 = pointCursor.next();

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

  get closed(): boolean {
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
