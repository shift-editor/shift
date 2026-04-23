import { Curve, Vec2, type Bounds, type CurveType, type Point2D } from "@shift/geo";
import { parseContourSegments, segmentToCurve } from "@shift/font";
import type { PointId, Point } from "@shift/types";
import type {
  SegmentPoint,
  SegmentType,
  LineSegment,
  QuadSegment,
  CubicSegment,
} from "@/types/segments";
import type { SegmentId } from "@/types/indicator";
import { asSegmentId } from "@/types/indicator";

export interface SegmentHitResult {
  segment: Segment;
  segmentId: SegmentId;
  t: number;
  point: Point2D;
  distance: number;
}

/**
 * Segment — font-editing segment with point IDs.
 *
 * Bridges pure curves (`@shift/geo` — no IDs) and font segments (have IDs).
 * Wraps a discriminated {@link SegmentType} and exposes id-aware operations
 * as instance methods.
 */
export class Segment {
  readonly #data: SegmentType;

  constructor(data: SegmentType) {
    this.#data = data;
  }

  /** Parse a contour's points into segment instances. */
  static parse(points: readonly Point[], closed: boolean): Segment[] {
    return parseContourSegments({ points, closed }).map((geom) => new Segment(geom as SegmentType));
  }

  /** Find the closest-hit segment in a collection. */
  static hitTestMultiple(
    segments: readonly Segment[],
    pos: Point2D,
    radius: number,
  ): SegmentHitResult | null {
    let best: SegmentHitResult | null = null;

    for (const segment of segments) {
      const hit = segment.hitTest(pos, radius);
      if (hit && (best === null || hit.distance < best.distance)) {
        best = hit;
      }
    }

    return best;
  }

  get type(): SegmentType["type"] {
    return this.#data.type;
  }

  get anchor1(): SegmentPoint {
    return this.#data.points.anchor1;
  }

  get anchor2(): SegmentPoint {
    return this.#data.points.anchor2;
  }

  get id(): SegmentId {
    return asSegmentId(`${this.#data.points.anchor1.id}:${this.#data.points.anchor2.id}`);
  }

  get pointIds(): PointId[] {
    switch (this.#data.type) {
      case "line":
        return [this.#data.points.anchor1.id, this.#data.points.anchor2.id];
      case "quad":
        return [
          this.#data.points.anchor1.id,
          this.#data.points.control.id,
          this.#data.points.anchor2.id,
        ];
      case "cubic":
        return [
          this.#data.points.anchor1.id,
          this.#data.points.control1.id,
          this.#data.points.control2.id,
          this.#data.points.anchor2.id,
        ];
    }
  }

  get bounds(): Bounds {
    return Curve.bounds(this.toCurve());
  }

  /** @knipclassignore */
  get length(): number {
    return Curve.length(this.toCurve());
  }

  /** @internal Raw discriminated data for rendering / clipboard interop. */
  get raw(): SegmentType {
    return this.#data;
  }

  toCurve(): CurveType {
    return segmentToCurve(this.#data);
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

  /** @knipclassignore Narrow to a line segment, or null if this isn't one. */
  asLine(): LineSegment | null {
    return this.#data.type === "line" ? this.#data : null;
  }

  /** Narrow to a quad segment, or null if this isn't one. */
  asQuad(): QuadSegment | null {
    return this.#data.type === "quad" ? this.#data : null;
  }

  /** Narrow to a cubic segment, or null if this isn't one. */
  asCubic(): CubicSegment | null {
    return this.#data.type === "cubic" ? this.#data : null;
  }

  hitTest(pos: Point2D, radius: number): SegmentHitResult | null {
    const b = this.bounds;
    const r = { x: radius, y: radius };
    const lo = Vec2.sub(b.min, r);
    const hi = Vec2.add(b.max, r);

    if (pos.x < lo.x || pos.x > hi.x || pos.y < lo.y || pos.y > hi.y) return null;

    const closest = Curve.closestPoint(this.toCurve(), pos);

    if (closest.distance < radius) {
      return {
        segment: this,
        segmentId: this.id,
        t: closest.t,
        point: closest.point,
        distance: closest.distance,
      };
    }

    return null;
  }
}
