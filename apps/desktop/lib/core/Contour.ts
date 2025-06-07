import { IContour, IContourPoint, PointType } from '@shift/shared';

import { EntityId, Ident } from '@/lib/core/EntityId';
import { Point } from '@/lib/math/point';
import { Shape } from '@/lib/math/shape';
import { CubicSegment, LineSegment, QuadSegment, Segment } from '@/types/segments';

import { CyclingCollection } from './common';
import { Pattern } from './RuleTable';

export class ContourPoint extends Point implements IContourPoint {
  #id: EntityId;
  #pointType: PointType;
  #smooth: boolean;

  prevPoint: ContourPoint | null = null;
  nextPoint: ContourPoint | null = null;

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

  movePointBy(dx: number, dy: number) {
    this.set_x(this.x + dx);
    this.set_y(this.y + dy);
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
    if (!this.prevPoint || !this.nextPoint) return;

    this.#smooth = !this.#smooth;
  }

  /**
   * Get the previous point in the contour
   */
  getPrevPoint(): ContourPoint | null {
    return this.prevPoint;
  }

  /**
   * Get the next point in the contour
   */
  getNextPoint(): ContourPoint | null {
    return this.nextPoint;
  }

  /**
   * Check if this point has a previous point
   */
  hasPrevPoint(): boolean {
    return this.prevPoint !== null;
  }

  /**
   * Check if this point has a next point
   */
  hasNextPoint(): boolean {
    return this.nextPoint !== null;
  }

  /**
   * Get both neighbor points as an array
   */
  getNeighbors(): ContourPoint[] {
    const neighbors: ContourPoint[] = [];
    if (this.prevPoint) neighbors.push(this.prevPoint);
    if (this.nextPoint) neighbors.push(this.nextPoint);
    return neighbors;
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

  clone(): Contour {
    const contour = new Contour();
    contour.#points = [...this.#points];
    contour.#closed = this.#closed;
    contour.#updatePointRelationships();
    return contour;
  }

  pointCursor(): CyclingCollection<ContourPoint> {
    return CyclingCollection.create(this.#points);
  }

  addPoint(x: number, y: number, pointType: PointType, smooth?: boolean): EntityId {
    const p = new ContourPoint(x, y, pointType, this.#id.id, smooth);
    this.#addPointInternal(p);
    return p.entityId;
  }

  /**
   * Insert a point at a specific index in the contour
   */
  insertPointAt(
    index: number,
    x: number,
    y: number,
    pointType: PointType,
    smooth?: boolean
  ): EntityId {
    const p = new ContourPoint(x, y, pointType, this.#id.id, smooth);
    this.#insertPointInternal(index, p);
    return p.entityId;
  }

  removePoint(id: EntityId): ContourPoint | undefined {
    const index = this.#points.findIndex((p) => p.entityId.id === id.id);
    if (index === -1) {
      console.error('No index found for point');
      return;
    }

    return this.#removePointInternal(index);
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

    this.#insertMultiplePointsInternal(index, [control1, control2]);

    return p1.entityId;
  }

  /**
   * Internal method to add a point and automatically update relationships
   */
  #addPointInternal(point: ContourPoint): void {
    this.#points.push(point);
    this.#updatePointRelationships();
  }

  /**
   * Internal method to insert a point at a specific index and automatically update relationships
   */
  #insertPointInternal(index: number, point: ContourPoint): void {
    this.#points.splice(index, 0, point);
    this.#updatePointRelationships();
  }

  /**
   * Internal method to insert multiple points at a specific index and automatically update relationships
   */
  #insertMultiplePointsInternal(index: number, points: ContourPoint[]): void {
    this.#points.splice(index, 0, ...points);
    this.#updatePointRelationships();
  }

  /**
   * Internal method to remove a point at a specific index and automatically update relationships
   */
  #removePointInternal(index: number): ContourPoint {
    const point = this.#points[index];
    this.#points.splice(index, 1);
    this.#updatePointRelationships();
    return point;
  }

  /**
   * Updates the prevPoint and nextPoint relationships for all points in the contour
   */
  #updatePointRelationships(): void {
    if (this.#points.length === 0) {
      return;
    }

    if (this.#points.length === 1) {
      // Single point has no neighbors
      this.#points[0].prevPoint = null;
      this.#points[0].nextPoint = null;
      return;
    }

    for (let i = 0; i < this.#points.length; i++) {
      const currentPoint = this.#points[i];

      if (this.#closed) {
        // For closed contours, wrap around
        const prevIndex = (i - 1 + this.#points.length) % this.#points.length;
        const nextIndex = (i + 1) % this.#points.length;

        currentPoint.prevPoint = this.#points[prevIndex];
        currentPoint.nextPoint = this.#points[nextIndex];
      } else {
        // For open contours, first and last points have null neighbors
        if (i === 0) {
          currentPoint.prevPoint = null;
          currentPoint.nextPoint = this.#points.length > 1 ? this.#points[1] : null;
        } else if (i === this.#points.length - 1) {
          currentPoint.prevPoint = this.#points[i - 1];
          currentPoint.nextPoint = null;
        } else {
          currentPoint.prevPoint = this.#points[i - 1];
          currentPoint.nextPoint = this.#points[i + 1];
        }
      }
    }
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
    this.#updatePointRelationships();
  }

  isEmpty(): boolean {
    return this.#points.length === 0;
  }

  isClockwise(): boolean {
    return Shape.shoelace(this.#points) > 0;
  }
}
