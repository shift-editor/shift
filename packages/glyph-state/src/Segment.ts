import { Curve, Vec2, type Bounds, type CurveType, type Point2D } from "@shift/geo";
import type { PointId } from "@shift/types";
import { Point } from "./Point";
import { Contour } from "./Contour";

declare const SegmentIdBrand: unique symbol;

export type SegmentId = string & {
  readonly [SegmentIdBrand]: typeof SegmentIdBrand;
};

const SEGMENT_ID_PREFIX = "segment:";

export function asSegmentId(id: string): SegmentId {
  return id as SegmentId;
}

/** Returns the derived segment id for a segment's endpoint point ids. */
export function segmentIdFor(startPointId: PointId, endPointId: PointId): SegmentId {
  return asSegmentId(`${SEGMENT_ID_PREFIX}${startPointId}:${endPointId}`);
}

/**
 * Parses a runtime-discriminable segment id into endpoint point ids.
 *
 * @param segmentId - Candidate segment id using the `segment:start:end` format.
 * @returns null when the value is not a prefixed segment id.
 */
export function parseSegmentId(
  segmentId: string,
): { startPointId: PointId; endPointId: PointId } | null {
  if (!segmentId.startsWith(SEGMENT_ID_PREFIX)) return null;

  const body = segmentId.slice(SEGMENT_ID_PREFIX.length);
  const separatorIndex = body.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === body.length - 1) return null;

  const startPointId = body.slice(0, separatorIndex) as PointId;
  const endPointId = body.slice(separatorIndex + 1) as PointId;
  return { startPointId, endPointId };
}

/** Returns whether a value is a runtime-discriminable segment id. */
export function isSegmentId(id: unknown): id is SegmentId {
  return typeof id === "string" && parseSegmentId(id) !== null;
}

export type LineSegment = {
  type: "line";
  points: {
    anchor1: Point;
    anchor2: Point;
  };
};

export type QuadSegment = {
  type: "quad";
  points: {
    anchor1: Point;
    control: Point;
    anchor2: Point;
  };
};

export type CubicSegment = {
  type: "cubic";
  points: {
    anchor1: Point;
    control1: Point;
    control2: Point;
    anchor2: Point;
  };
};

export type SegmentType = LineSegment | QuadSegment | CubicSegment;

export type LineSegmentPoints = {
  readonly type: "line";
  readonly start: Point;
  readonly end: Point;
};

export type QuadSegmentPoints = {
  readonly type: "quad";
  readonly start: Point;
  readonly control: Point;
  readonly end: Point;
};

export type CubicSegmentPoints = {
  readonly type: "cubic";
  readonly start: Point;
  readonly controlStart: Point;
  readonly controlEnd: Point;
  readonly end: Point;
};

export type SegmentPoints = LineSegmentPoints | QuadSegmentPoints | CubicSegmentPoints;

export interface SegmentHit {
  readonly t: number;
  readonly closestPoint: Point2D;
  readonly distance: number;
}

/**
 * Segment — font-editing segment with point IDs.
 *
 * Bridges pure curves (`@shift/geo` — no IDs) and font segments (have IDs).
 * Wraps a discriminated {@link SegmentType} and exposes id-aware operations
 * as instance methods.
 */
export class Segment {
  #structure: SegmentType;
  #id: SegmentId | null = null;
  #pointIds: readonly PointId[] | null = null;
  #points: SegmentPoints | null = null;
  #flatPoints: readonly Point[] | null = null;
  #curve: CurveType | null = null;
  #bounds: Bounds | null = null;
  #length: number | null = null;

  constructor(data: SegmentType) {
    this.#structure = data;
  }

  /** Parse a contour's points into segment instances. */
  static parse(contour: Contour): Segment[] {
    const { points, closed } = contour;
    if (points.length < 2) {
      return [];
    }

    const segments: Segment[] = [];
    let index = 0;

    const getPoint = (i: number): Point | null => {
      if (i < points.length) {
        return points[i];
      }
      if (closed) {
        return points[i - points.length];
      }

      return null;
    };

    const limit = closed ? points.length : points.length - 1;

    while (index < limit) {
      const p1 = getPoint(index);
      const p2 = getPoint(index + 1);

      if (!p1 || !p2) {
        break;
      }

      if (Point.isOnCurve(p1) && Point.isOnCurve(p2)) {
        segments.push(
          new Segment({
            type: "line",
            points: { anchor1: p1, anchor2: p2 },
          }),
        );
        index += 1;
        continue;
      }

      if (Point.isOnCurve(p1) && Point.isOffCurve(p2)) {
        const p3 = getPoint(index + 2);

        if (!p3) {
          break;
        }

        if (Point.isOnCurve(p3)) {
          segments.push(
            new Segment({
              type: "quad",
              points: { anchor1: p1, control: p2, anchor2: p3 },
            }),
          );
          index += 2;
          continue;
        }

        if (Point.isOffCurve(p3)) {
          const p4 = getPoint(index + 3);
          if (!p4) {
            break;
          }

          segments.push(
            new Segment({
              type: "cubic",
              points: { anchor1: p1, control1: p2, control2: p3, anchor2: p4 },
            }),
          );
          index += 3;
          continue;
        }
      }

      index += 1;
    }

    return segments;
  }

  get type(): SegmentType["type"] {
    return this.#structure.type;
  }

  get structure(): SegmentType {
    return this.#structure;
  }

  get id(): SegmentId {
    if (this.#id === null) {
      this.#id = segmentIdFor(this.startId, this.endId);
    }
    return this.#id;
  }

  get pointIds(): readonly PointId[] {
    if (this.#pointIds === null) {
      const points = this.points;
      switch (points.type) {
        case "line":
          this.#pointIds = [points.start.id, points.end.id];
          break;
        case "quad":
          this.#pointIds = [points.start.id, points.control.id, points.end.id];
          break;
        case "cubic":
          this.#pointIds = [
            points.start.id,
            points.controlStart.id,
            points.controlEnd.id,
            points.end.id,
          ];
          break;
      }
    }
    return this.#pointIds;
  }

  get points(): SegmentPoints {
    if (this.#points === null) {
      switch (this.#structure.type) {
        case "line":
          this.#points = {
            type: "line",
            start: this.#structure.points.anchor1,
            end: this.#structure.points.anchor2,
          };
          break;
        case "quad":
          this.#points = {
            type: "quad",
            start: this.#structure.points.anchor1,
            control: this.#structure.points.control,
            end: this.#structure.points.anchor2,
          };
          break;
        case "cubic":
          this.#points = {
            type: "cubic",
            start: this.#structure.points.anchor1,
            controlStart: this.#structure.points.control1,
            controlEnd: this.#structure.points.control2,
            end: this.#structure.points.anchor2,
          };
          break;
      }
    }
    return this.#points;
  }

  get start(): Point {
    return this.points.start;
  }

  get end(): Point {
    return this.points.end;
  }

  get startId(): PointId {
    return this.start.id;
  }

  get endId(): PointId {
    return this.end.id;
  }

  get flatPoints(): readonly Point[] {
    if (this.#flatPoints === null) {
      const points = this.points;
      switch (points.type) {
        case "line":
          this.#flatPoints = [points.start, points.end];
          break;
        case "quad":
          this.#flatPoints = [points.start, points.control, points.end];
          break;
        case "cubic":
          this.#flatPoints = [points.start, points.controlStart, points.controlEnd, points.end];
          break;
      }
    }
    return this.#flatPoints;
  }

  get bounds(): Bounds {
    if (this.#bounds === null) {
      this.#bounds = Curve.bounds(this.toCurve());
    }

    return this.#bounds;
  }

  /** @knipclassignore */
  get length(): number {
    if (this.#length === null) {
      this.#length = Curve.length(this.toCurve());
    }
    return this.#length;
  }

  /** @internal Raw discriminated data for rendering / clipboard interop. */
  get raw(): SegmentType {
    return this.#structure;
  }

  toCurve(): CurveType {
    if (this.#curve === null) {
      const points = this.points;
      switch (points.type) {
        case "line":
          this.#curve = Curve.line(points.start, points.end);
          break;
        case "quad":
          this.#curve = Curve.quadratic(points.start, points.control, points.end);
          break;
        case "cubic":
          this.#curve = Curve.cubic(
            points.start,
            points.controlStart,
            points.controlEnd,
            points.end,
          );
          break;
      }
    }

    return this.#curve;
  }

  /** @knipclassignore */
  pointAt(t: number): Point2D {
    return Curve.pointAt(this.toCurve(), t);
  }

  /** @knipclassignore */
  closestPoint(pos: Point2D) {
    return Curve.closestPoint(this.toCurve(), pos);
  }

  /** @knipclassignore */
  splitAt(t: number): [CurveType, CurveType] {
    return Curve.splitAt(this.toCurve(), t);
  }

  /** @knipclassignore */
  sample(count: number): Point2D[] {
    return Curve.sample(this.toCurve(), count);
  }

  hit(pos: Point2D, radius: number): SegmentHit | null {
    const radiusVector = { x: radius, y: radius };
    const min = Vec2.sub(this.bounds.min, radiusVector);
    const max = Vec2.add(this.bounds.max, radiusVector);

    if (pos.x < min.x || pos.x > max.x || pos.y < min.y || pos.y > max.y) {
      return null;
    }

    const closest = this.closestPoint(pos);
    if (closest.distance > radius) return null;

    return {
      t: closest.t,
      closestPoint: closest.point,
      distance: closest.distance,
    };
  }

  /** @knipclassignore Narrow to line points, or null if this isn't a line. */
  asLine(): LineSegmentPoints | null {
    const points = this.points;
    return points.type === "line" ? points : null;
  }

  /** Narrow to quad points, or null if this isn't a quad. */
  asQuad(): QuadSegmentPoints | null {
    const points = this.points;
    return points.type === "quad" ? points : null;
  }

  /** Narrow to cubic points, or null if this isn't a cubic. */
  asCubic(): CubicSegmentPoints | null {
    const points = this.points;
    return points.type === "cubic" ? points : null;
  }
}
