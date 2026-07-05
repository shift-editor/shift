import { Bounds, type Bounds as BoundsType, Vec2, type Point2D } from "@shift/geo";
import type {
  AnchorId,
  ComponentId,
  ContourId,
  GlyphState,
  GlyphStructure,
  PointId,
} from "@shift/types";
import { Anchor } from "./Anchor";
import type { AnchorHit } from "./Anchor";
import { Component } from "./Component";
import { Contour } from "./Contour";
import { IdIndex } from "./IdIndex";
import { Segment, type SegmentId } from "./Segment";
import type { SegmentHit } from "./Segment";
import { Point } from "./Point";
import type { PointHit } from "./Point";

export interface GlyphSidebearings {
  readonly lsb: number | null;
  readonly rsb: number | null;
}

export type GlyphPositionTarget =
  | { readonly kind: "point"; readonly id: PointId }
  | { readonly kind: "anchor"; readonly id: AnchorId };

export type GlyphPosition =
  | {
      readonly kind: "point";
      readonly id: PointId;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly kind: "anchor";
      readonly id: AnchorId;
      readonly x: number;
      readonly y: number;
    };

export type GlyphPositions = readonly GlyphPosition[];

type GlyphHitIdByKind = {
  readonly point: PointId;
  readonly anchor: AnchorId;
  readonly segment: SegmentId;
};

export type GlyphHitKind = keyof GlyphHitIdByKind;

interface GlyphHitBase<K extends GlyphHitKind> {
  readonly kind: K;
  readonly id: GlyphHitIdByKind[K];
  readonly distance: number;
}

export type GeometryPointHit = GlyphHitBase<"point"> & PointHit;

export type GeometryAnchorHit = GlyphHitBase<"anchor"> & AnchorHit;

export type GeometrySegmentHit = GlyphHitBase<"segment"> & SegmentHit;

export type GeometryHit = GeometryPointHit | GeometryAnchorHit | GeometrySegmentHit;

export type GlyphPointHit = GeometryPointHit;

export type GlyphAnchorHit = GeometryAnchorHit;

export type GlyphSegmentHit = GeometrySegmentHit;

export type GlyphHit = GeometryHit;

/**
 * Immutable geometry view over a glyph structure and value buffer.
 *
 * `GlyphStateGeometry` is the pure data shape used by rendering, hit testing,
 * transforms, clipboard, and edit previews. It does not talk to the bridge and
 * does not mutate its input values. Methods that apply changes return a new
 * geometry object or packed data for another layer to commit.
 */
export class GlyphGeometry {
  readonly structure: GlyphStructure;
  readonly values: Float64Array;

  readonly #cache: GeometryCache;

  constructor(structure: GlyphStructure, values: Float64Array) {
    this.structure = structure;
    this.values = values;
    this.#cache = new GeometryCache(structure, values);
  }

  static fromState(state: GlyphState): GlyphGeometry {
    return new GlyphGeometry(state.structure, state.values);
  }

  get xAdvance(): number {
    return this.values[0] ?? 0;
  }

  get contours(): readonly Contour[] {
    return this.#cache.contours;
  }

  get segments(): readonly Segment[] {
    return this.#cache.segments;
  }

  get anchors(): readonly Anchor[] {
    return this.#cache.anchors;
  }

  get components(): readonly Component[] {
    return this.#cache.components;
  }

  get allPoints(): Point[] {
    return [...this.#cache.points];
  }

  get bounds(): BoundsType | null {
    return this.#cache.bounds;
  }

  get sidebearings(): GlyphSidebearings {
    return this.#cache.sidebearings;
  }

  point(pointId: PointId): Point | null {
    return this.#cache.point(pointId);
  }

  points(pointIds: readonly PointId[]): Point[] {
    const points: Point[] = [];
    for (const pointId of pointIds) {
      const point = this.point(pointId);
      if (point) points.push(point);
    }
    return points;
  }

  contour(contourId: ContourId): Contour | null {
    return this.#cache.contour(contourId);
  }

  contourIdOfPoint(pointId: PointId): ContourId | null {
    return this.#cache.contourIdOfPoint(pointId);
  }

  segment(segmentId: SegmentId): Segment | null {
    return this.#cache.segment(segmentId);
  }

  anchor(anchorId: AnchorId): Anchor | null {
    return this.#cache.anchor(anchorId);
  }

  component(componentId: ComponentId): Component | null {
    return this.#cache.component(componentId);
  }

  hitPoint(pos: Point2D, radius: number): GeometryPointHit | null {
    let best: GeometryPointHit | null = null;

    for (const point of this.#cache.points) {
      const hit = Point.hit(point, pos, radius);
      if (hit && (!best || hit.distance < best.distance)) {
        best = {
          kind: "point",
          id: point.id,
          distance: hit.distance,
        };
      }
    }

    return best;
  }

  hitAnchor(pos: Point2D, radius: number): GeometryAnchorHit | null {
    let best: GeometryAnchorHit | null = null;

    for (const anchor of this.#cache.anchors) {
      const hit = anchor.hit(pos, radius);
      if (hit && (!best || hit.distance < best.distance)) {
        best = {
          kind: "anchor",
          id: anchor.id,
          distance: hit.distance,
        };
      }
    }

    return best;
  }

  hitAt(pos: Point2D, radius: number): GeometryHit | null {
    return (
      this.hitAnchor(pos, radius) ?? this.hitPoint(pos, radius) ?? this.hitSegment(pos, radius)
    );
  }

  hitSegment(pos: Point2D, radius: number): GeometrySegmentHit | null {
    let best: GeometrySegmentHit | null = null;

    for (const segment of this.#cache.segments) {
      const hit = segment.hit(pos, radius);
      if (hit && (!best || hit.distance < best.distance)) {
        best = {
          kind: "segment",
          id: segment.id,
          t: hit.t,
          closestPoint: hit.closestPoint,
          distance: hit.distance,
        };
      }
    }

    return best;
  }

  /**
   * Read current positions for point and anchor targets.
   *
   * Missing targets are skipped. This is the pure geometry equivalent of the
   * editable source API and is useful for transforms that should not know where
   * the geometry came from.
   */
  positionsFor(targets: readonly GlyphPositionTarget[]): GlyphPosition[] {
    const positions: GlyphPosition[] = [];

    for (const target of targets) {
      switch (target.kind) {
        case "point": {
          const point = this.point(target.id);
          if (point)
            positions.push({
              kind: "point",
              id: point.id,
              x: point.x,
              y: point.y,
            });
          break;
        }
        case "anchor": {
          const anchor = this.anchor(target.id);
          if (anchor)
            positions.push({
              kind: "anchor",
              id: anchor.id,
              x: anchor.x,
              y: anchor.y,
            });
          break;
        }
      }
    }

    return positions;
  }

  /**
   * Return a new geometry object with point/anchor positions applied.
   *
   * The structure is reused and the value buffer is copied before changes are
   * written. Use this for previews and tests; committing to Rust happens at the
   * editor/model layer.
   */
  withPositionUpdates(updates: GlyphPositions): GlyphGeometry {
    if (updates.length === 0) return this;

    const values = new Float64Array(this.values);
    const pointOffsets = Contour.pointValueOffsets(this.structure);
    const anchorOffsets = Anchor.valueOffsets(this.structure);

    for (const update of updates) {
      switch (update.kind) {
        case "point": {
          const offset = pointOffsets.get(update.id);
          if (offset === undefined) break;
          values[offset] = update.x;
          values[offset + 1] = update.y;
          break;
        }
        case "anchor": {
          const offset = anchorOffsets.get(update.id);
          if (offset === undefined) break;
          values[offset] = update.x;
          values[offset + 1] = update.y;
          break;
        }
      }
    }

    return new GlyphGeometry(this.structure, values);
  }

  /**
   * Move position records without needing access to the original geometry.
   *
   * This keeps transform code working with `GlyphPosition` records rather than
   * points, anchors, or source-specific models.
   */
  movePositions(positions: GlyphPositions, delta: Point2D): GlyphPosition[] {
    return positions.map((position) => {
      const next = Vec2.add(position, delta);
      return { ...position, x: next.x, y: next.y };
    });
  }
}

class GeometryCache {
  readonly #points: IdIndex<PointId, Point>;
  readonly #contours: IdIndex<ContourId, Contour>;
  readonly #segments: IdIndex<SegmentId, Segment>;
  readonly #anchors: IdIndex<AnchorId, Anchor>;
  readonly #components: IdIndex<ComponentId, Component>;

  readonly #xAdvance: number;

  #contourIdByPointId: ReadonlyMap<PointId, ContourId> | null = null;
  #bounds: BoundsType | null | undefined;
  #sidebearings: GlyphSidebearings | null = null;

  constructor(structure: GlyphStructure, values: Float64Array) {
    this.#xAdvance = values[0] ?? 0;

    let contours: readonly Contour[] | null = null;
    this.#contours = new IdIndex(
      () => (contours ??= Contour.fromStructure(structure, values)),
      (contour) => contour.id,
    );

    let points: readonly Point[] | null = null;
    this.#points = new IdIndex(
      () => (points ??= this.contours.flatMap((contour) => [...contour.points])),
      (point) => point.id,
    );

    let segments: readonly Segment[] | null = null;
    this.#segments = new IdIndex(
      () => (segments ??= this.contours.flatMap((contour) => contour.segments())),
      (segment) => segment.id,
    );

    let anchors: readonly Anchor[] | null = null;
    this.#anchors = new IdIndex(
      () => (anchors ??= Anchor.fromStructure(structure, values)),
      (anchor) => anchor.id,
    );

    let components: readonly Component[] | null = null;
    this.#components = new IdIndex(
      () => (components ??= Component.fromStructure(structure, values)),
      (component) => component.id,
    );
  }

  get points(): readonly Point[] {
    return this.#points.all;
  }

  point(id: PointId): Point | null {
    return this.#points.get(id);
  }

  contourIdOfPoint(id: PointId): ContourId | null {
    return this.contourIdByPointId.get(id) ?? null;
  }

  get contourIdByPointId(): ReadonlyMap<PointId, ContourId> {
    if (this.#contourIdByPointId === null) {
      const contourIds = new Map<PointId, ContourId>();

      for (const contour of this.contours) {
        contour.points.forEach((point) => {
          contourIds.set(point.id, contour.id);
        });
      }

      this.#contourIdByPointId = contourIds;
    }

    return this.#contourIdByPointId;
  }

  get contours(): readonly Contour[] {
    return this.#contours.all;
  }

  contour(id: ContourId): Contour | null {
    return this.#contours.get(id);
  }

  get segments(): readonly Segment[] {
    return this.#segments.all;
  }

  segment(id: SegmentId): Segment | null {
    return this.#segments.get(id);
  }

  get anchors(): readonly Anchor[] {
    return this.#anchors.all;
  }

  anchor(id: AnchorId): Anchor | null {
    return this.#anchors.get(id);
  }

  get components(): readonly Component[] {
    return this.#components.all;
  }

  component(id: ComponentId): Component | null {
    return this.#components.get(id);
  }

  get bounds(): BoundsType | null {
    if (this.#bounds === undefined) {
      this.#bounds = Bounds.unionAll(this.contours.map((contour) => contour.bounds));
    }

    return this.#bounds;
  }

  get sidebearings(): GlyphSidebearings {
    if (this.#sidebearings === null) {
      const bounds = Bounds.fromPoints(this.points);
      if (bounds === null) return { lsb: null, rsb: null };

      this.#sidebearings = {
        lsb: bounds.min.x,
        rsb: this.#xAdvance - bounds.max.x,
      };
      return this.#sidebearings;
    }

    return this.#sidebearings;
  }
}
