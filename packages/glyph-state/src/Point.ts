import { Vec2, type Point2D } from "@shift/geo";
import type { PointData, PointId, PointType } from "@shift/types";

export interface PointInput extends PointData {
  readonly x: number;
  readonly y: number;
}

export interface NewPoint {
  readonly x: number;
  readonly y: number;
  readonly pointType: PointType;
  readonly smooth: boolean;
}

export interface PointWithNeighbors {
  readonly point: Point;
  readonly prev: Point | null;
  readonly next: Point | null;
}

export interface PointHit {
  readonly distance: number;
}

export class Point implements PointInput {
  readonly id: PointId;
  readonly pointType: PointType;
  readonly smooth: boolean;
  readonly x: number;
  readonly y: number;

  constructor(input: PointInput) {
    this.id = input.id;
    this.pointType = input.pointType;
    this.smooth = input.smooth;
    this.x = input.x;
    this.y = input.y;
  }

  static onCurve(position: Point2D, smooth = false): NewPoint {
    return {
      x: position.x,
      y: position.y,
      pointType: "onCurve",
      smooth,
    };
  }

  static create(position: Point2D, pointType: PointType, smooth = false): NewPoint {
    return pointType === "onCurve" ? Point.onCurve(position, smooth) : Point.offCurve(position);
  }

  static smooth(position: Point2D): NewPoint {
    return Point.onCurve(position, true);
  }

  static offCurve(position: Point2D): NewPoint {
    return {
      x: position.x,
      y: position.y,
      pointType: "offCurve",
      smooth: false,
    };
  }

  static isOnCurve(point: { readonly pointType: PointType }): boolean {
    return point.pointType === "onCurve";
  }

  static isOffCurve(point: { readonly pointType: PointType }): boolean {
    return point.pointType === "offCurve";
  }

  static isSmoothOnCurve(point: {
    readonly pointType: PointType;
    readonly smooth: boolean;
  }): boolean {
    return Point.isOnCurve(point) && point.smooth;
  }

  static hit(point: Point2D, pos: Point2D, radius: number): PointHit | null {
    const distance = Vec2.dist(point, pos);
    if (distance > radius) return null;
    return { distance };
  }

  get position(): Point2D {
    return { x: this.x, y: this.y };
  }

  get isOnCurve(): boolean {
    return Point.isOnCurve(this);
  }

  get isOffCurve(): boolean {
    return Point.isOffCurve(this);
  }

  get isSmoothOnCurve(): boolean {
    return Point.isSmoothOnCurve(this);
  }

  hit(pos: Point2D, radius: number): PointHit | null {
    return Point.hit(this, pos, radius);
  }
}
