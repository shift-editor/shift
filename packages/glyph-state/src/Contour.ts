import type { ContourData, ContourId, GlyphStructure, PointId } from "@shift/types";
import { Bounds, type Bounds as BoundsType, type Point2D } from "@shift/geo";
import { Segment } from "./Segment";
import { Point, type PointWithNeighbors } from "./Point";

/**
 * Geometry view for one contour in a glyph state.
 *
 * A contour reads point metadata from `GlyphStructure` and coordinates from the
 * shared value buffer. It is a snapshot-style helper for parsing segments,
 * neighbor relationships, bounds, and selection geometry; edits happen by
 * producing position/structure updates elsewhere.
 */
export class Contour {
  readonly #data: ContourData;
  readonly #values: Float64Array;
  readonly #cursor: number;

  #points: readonly Point[] | null = null;
  #segments: readonly Segment[] | null = null;
  #bounds: BoundsType | null | undefined;

  constructor(data: ContourData, values: Float64Array, cursor: number) {
    this.#data = data;
    this.#values = values;
    this.#cursor = cursor;
  }

  static fromStructure(structure: GlyphStructure, values: Float64Array): readonly Contour[] {
    let cursor = 1;
    return structure.contours.map((contour) => {
      const result = new Contour(contour, values, cursor);
      cursor += contour.points.length * 2;
      return result;
    });
  }

  /**
   * Return the value-buffer offset for every point in a glyph structure.
   *
   * Offsets point to each point's `x` coordinate; `y` is stored immediately
   * after it. This is used by bulk position updates.
   */
  static pointValueOffsets(structure: GlyphStructure): Map<PointId, number> {
    const offsets = new Map<PointId, number>();
    let cursor = 1;
    for (const contour of structure.contours) {
      for (const point of contour.points) {
        offsets.set(point.id, cursor);
        cursor += 2;
      }
    }
    return offsets;
  }

  get id(): ContourId {
    return this.#data.id;
  }

  get closed(): boolean {
    return this.#data.closed;
  }

  get points(): readonly Point[] {
    if (this.#points === null) {
      this.#points = this.#data.points.map((_, index) => this.#pointAt(index));
    }

    return this.#points;
  }

  get bounds(): BoundsType | null {
    if (this.#bounds === undefined) {
      const segments = this.segments();
      if (segments.length == 0) return null;

      this.#bounds = Bounds.unionAll(segments.map((segment) => segment.bounds));
    }

    return this.#bounds;
  }

  get firstPoint(): Point | null {
    return this.points[0] ?? null;
  }

  get lastPoint(): Point | null {
    const points = this.points;
    return points[points.length - 1] ?? null;
  }

  get firstOnCurvePoint(): Point | null {
    return this.points.find((point) => point.pointType === "onCurve") ?? null;
  }

  get lastOnCurvePoint(): Point | null {
    const points = this.points;
    for (let index = points.length - 1; index >= 0; index--) {
      const point = points[index];
      if (point?.pointType === "onCurve") return point;
    }
    return null;
  }

  get isEmpty(): boolean {
    return this.#data.points.length === 0;
  }

  get hasInteriorPoints(): boolean {
    return this.#data.points.length >= 3;
  }

  pointAt(index: number, wrap = this.closed): Point | null {
    const points = this.points;
    if (index >= 0 && index < points.length) return points[index] ?? null;
    if (!wrap || points.length === 0) return null;

    const wrapped = ((index % points.length) + points.length) % points.length;

    return points[wrapped] ?? null;
  }

  /**
   * Iterate each point with its previous and next contour neighbors.
   *
   * Closed contours wrap at the ends. Open contours return `null` for missing
   * edge neighbors.
   */
  *withNeighbors(): Generator<PointWithNeighbors> {
    const points = this.points;
    for (let index = 0; index < points.length; index++) {
      yield {
        point: points[index],
        prev: points[index - 1] ?? (this.closed ? points[points.length - 1] : null),
        next: points[index + 1] ?? (this.closed ? points[0] : null),
      };
    }
  }

  /**
   * Parse this contour into drawable/editable segments.
   *
   * Segment parsing preserves point IDs, so callers can connect hit-test or
   * selection results back to source positions.
   */
  segments(): readonly Segment[] {
    if (this.#segments === null) {
      this.#segments = Segment.parse(this);
    }

    return this.#segments;
  }

  /**
   * Compute bounds for a point selection within this contour.
   *
   * Complete selected segments contribute curve bounds. Individual selected
   * points are included as point bounds so handle-only selections still produce
   * usable geometry.
   */
  selectionBounds(ids: ReadonlySet<PointId>): BoundsType | null {
    const parts: (BoundsType | null)[] = [];

    for (const segment of this.segments()) {
      if (segment.pointIds.every((id) => ids.has(id))) {
        parts.push(segment.bounds);
      }
    }

    parts.push(Bounds.fromPoints(this.points.filter((point) => ids.has(point.id))));

    return Bounds.unionAll(parts);
  }

  canClose(position: Point2D, hitRadius: number): boolean {
    const first = this.firstPoint;
    if (!first || this.closed) return false;

    return Math.hypot(position.x - first.x, position.y - first.y) <= hitRadius;
  }

  #pointAt(index: number): Point {
    const point = this.#data.points[index];
    return new Point({
      id: point.id,
      pointType: point.pointType,
      smooth: point.smooth,
      x: this.#values[this.#cursor + index * 2],
      y: this.#values[this.#cursor + index * 2 + 1],
    });
  }
}
