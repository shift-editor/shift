import {
  GLYPH_POINT_VALUE_COUNT,
  GLYPH_POSITION_VALUE_OFFSETS,
  type ContourData,
  type ContourId,
  type GlyphStructure,
  type PointId,
} from "@shift/types";
import { Bounds, wrapIndex, type Bounds as BoundsType, type Point2D } from "@shift/geo";
import { Segment } from "./Segment";
import { segmentContour, type SegmentedContourGeometry } from "./segmentContour";
import { Point, type PointWithNeighbors } from "./Point";
import { CONTOURS_VALUE_OFFSET } from "./valueLayout";

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
  #geometry: SegmentedContourGeometry<Point> | null = null;

  constructor(data: ContourData, values: Float64Array, cursor: number) {
    this.#data = data;
    this.#values = values;
    this.#cursor = cursor;
  }

  static fromStructure(structure: GlyphStructure, values: Float64Array): readonly Contour[] {
    let cursor = CONTOURS_VALUE_OFFSET;
    return structure.contours.map((contour) => {
      const result = new Contour(contour, values, cursor);
      cursor += contour.points.length * GLYPH_POINT_VALUE_COUNT;
      return result;
    });
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

  /** The tight box around the contour's segments, as shift-font bounds it; `null` with none. */
  get bounds(): BoundsType | null {
    return this.#segmented().bounds;
  }

  get firstPoint(): Point | null {
    return this.pointAt(0, false);
  }

  get lastPoint(): Point | null {
    return this.pointAt(this.#data.points.length - 1, false);
  }

  get firstOnCurvePoint(): Point | null {
    return this.pointAt(this.#data.points.findIndex(Point.isOnCurve), false);
  }

  get lastOnCurvePoint(): Point | null {
    for (let index = this.#data.points.length - 1; index >= 0; index--) {
      if (Point.isOnCurve(this.#data.points[index]!)) return this.pointAt(index, false);
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
    if (!Number.isInteger(index)) return null;

    const count = this.#data.points.length;
    if (index < 0 || index >= count) {
      if (!wrap || count === 0) return null;

      index = wrapIndex(index, count);
    }

    return this.#points?.[index] ?? this.#pointAt(index);
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
      this.#segments = Segment.fromGeometry(this.#segmented());
    }

    return this.#segments;
  }

  /** The contour segmented once, by shift-font, for its segments and bounds both. */
  #segmented(): SegmentedContourGeometry<Point> {
    this.#geometry ??= segmentContour(this);
    return this.#geometry;
  }

  /**
   * Returns the on-curve endpoint that owns a cubic control point.
   *
   * @param controlPointId - Off-curve point to resolve within this contour.
   * @returns The associated cubic endpoint, or null when the point is not a cubic control.
   */
  cubicHandleAnchor(controlPointId: PointId): Point | null {
    for (const segment of this.segments()) {
      const cubic = segment.asCubic();
      if (!cubic) continue;

      if (cubic.controlStart.id === controlPointId) return cubic.start;
      if (cubic.controlEnd.id === controlPointId) return cubic.end;
    }

    return null;
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
    const offset = this.#cursor + index * GLYPH_POINT_VALUE_COUNT;
    return new Point({
      id: point.id,
      pointType: point.pointType,
      smooth: point.smooth,
      x: this.#values[offset + GLYPH_POSITION_VALUE_OFFSETS.x],
      y: this.#values[offset + GLYPH_POSITION_VALUE_OFFSETS.y],
    });
  }
}
