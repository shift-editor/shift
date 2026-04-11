/**
 * Reactive glyph model.
 *
 * A {@link Glyph} is a reactive mirror of Rust glyph data with per-contour
 * signal granularity. Property getters auto-unwrap signals, so consumers
 * read `glyph.contours`, `glyph.xAdvance`, `contour.points` etc. as plain
 * values — identical to the domain Glyph type from @shift/types. Inside a
 * reactive context (computed/effect) the read auto-tracks the signal.
 *
 * All mutations go through {@link Glyph.apply}, which accepts either a full
 * {@link GlyphSnapshot} (structural edits, undo/redo) or a
 * {@link NodePositionUpdateList} (drag hot path). The glyph optimizes
 * internally — position updates only touch affected contour signals.
 */

import type {
  GlyphSnapshot,
  ContourSnapshot,
  ContourId,
  PointId,
  AnchorId,
  Point,
  Anchor,
  RenderContour,
  Point2D,
} from "@shift/types";
import {
  signal,
  computed,
  batch,
  type WritableSignal,
  type ComputedSignal,
} from "@/lib/reactive/signal";
import { parseContourSegments, segmentToCurve, type SegmentContourLike } from "@shift/font";
import { Bounds, Curve, type Bounds as BoundsType } from "@shift/geo";
import type { NodePositionUpdateList } from "@/types/positionUpdate";

export type GlyphChange = GlyphSnapshot | NodePositionUpdateList;

export class GlyphContour {
  readonly id: ContourId;
  readonly #closed: WritableSignal<boolean>;
  readonly #points: WritableSignal<readonly Point[]>;
  readonly #path: ComputedSignal<Path2D>;
  readonly #bounds: ComputedSignal<BoundsType | null>;

  constructor(snapshot: ContourSnapshot) {
    this.id = snapshot.id;
    this.#closed = signal(snapshot.closed);
    this.#points = signal<readonly Point[]>(snapshot.points);
    this.#path = computed<Path2D>(() => buildPath2D(this.#points.value, this.#closed.value));
    this.#bounds = computed<BoundsType | null>(() => {
      const pts = this.#points.value;
      const isClosed = this.#closed.value;
      if (pts.length < 2) return null;
      const segments = parseContourSegments({ points: pts, closed: isClosed });
      if (segments.length === 0) return null;
      return Bounds.unionAll(segments.map((s) => Curve.bounds(segmentToCurve(s))));
    });
  }

  get closed(): boolean {
    return this.#closed.value;
  }

  get points(): readonly Point[] {
    return this.#points.value;
  }

  get path(): Path2D {
    return this.#path.value;
  }

  get bounds(): BoundsType | null {
    return this.#bounds.value;
  }

  /** @internal Called by Glyph.apply for structural updates. */
  _update(snapshot: ContourSnapshot): void {
    this.#closed.set(snapshot.closed);
    this.#points.set(snapshot.points);
  }

  /** @internal Called by Glyph.apply for position patching. */
  _setPoints(points: readonly Point[]): void {
    this.#points.set(points);
  }
}

export class Glyph {
  readonly name: string;
  readonly unicode: number;

  readonly #contours: WritableSignal<readonly GlyphContour[]>;
  readonly #xAdvance: WritableSignal<number>;
  readonly #anchors: WritableSignal<readonly Anchor[]>;
  readonly #compositeContours: WritableSignal<readonly RenderContour[]>;
  readonly #activeContourId: WritableSignal<ContourId | null>;
  readonly #path: ComputedSignal<Path2D>;
  readonly #bbox: ComputedSignal<BoundsType | null>;
  constructor(snapshot: GlyphSnapshot) {
    this.name = snapshot.name;
    this.unicode = snapshot.unicode;
    this.#contours = signal<readonly GlyphContour[]>(
      snapshot.contours.map((c) => new GlyphContour(c)),
    );
    this.#xAdvance = signal(snapshot.xAdvance);
    this.#anchors = signal<readonly Anchor[]>(snapshot.anchors);
    this.#compositeContours = signal<readonly RenderContour[]>(snapshot.compositeContours);
    this.#activeContourId = signal<ContourId | null>(snapshot.activeContourId);

    this.#path = computed<Path2D>(() => {
      const p = new Path2D();
      for (const c of this.#contours.value) {
        p.addPath(c.path);
      }
      for (const c of this.#compositeContours.value) {
        p.addPath(buildPath2D(c.points, c.closed));
      }
      return p;
    });

    this.#bbox = computed<BoundsType | null>(() => {
      const contourBounds = this.#contours.value
        .map((c) => c.bounds)
        .filter((b): b is BoundsType => b !== null);

      const compositeBounds = this.#compositeContours.value
        .map((c) => {
          if (c.points.length < 2) return null;
          const segs = parseContourSegments({ points: c.points, closed: c.closed });
          if (segs.length === 0) return null;
          return Bounds.unionAll(segs.map((s) => Curve.bounds(segmentToCurve(s))));
        })
        .filter((b): b is BoundsType => b !== null);

      const all = [...contourBounds, ...compositeBounds];
      if (all.length === 0) return null;
      return Bounds.unionAll(all);
    });
  }

  get contours(): readonly GlyphContour[] {
    return this.#contours.value;
  }

  get xAdvance(): number {
    return this.#xAdvance.value;
  }

  get anchors(): readonly Anchor[] {
    return this.#anchors.value;
  }

  get compositeContours(): readonly RenderContour[] {
    return this.#compositeContours.value;
  }

  get activeContourId(): ContourId | null {
    return this.#activeContourId.value;
  }

  get path(): Path2D {
    return this.#path.value;
  }

  get bbox(): BoundsType | null {
    return this.#bbox.value;
  }

  /**
   * Apply a change to the glyph. Accepts either a full snapshot (structural
   * edits, undo/redo) or position updates (drag hot path). The glyph picks
   * the efficient internal path automatically.
   */
  apply(change: GlyphChange): void {
    if (isSnapshot(change)) {
      this.#syncFromSnapshot(change);
    } else {
      this.#patchPositions(change);
    }
  }

  /** Extract current reactive state as a plain snapshot (for undo, Rust sync). */
  toSnapshot(): GlyphSnapshot {
    return {
      name: this.name,
      unicode: this.unicode,
      xAdvance: this.#xAdvance.peek(),
      contours: this.#contours.peek().map((c) => ({
        id: c.id,
        points: [...c.points],
        closed: c.closed,
      })),
      anchors: [...this.#anchors.peek()],
      compositeContours: this.#compositeContours.peek().map((c) => ({
        points: [...c.points],
        closed: c.closed,
      })),
      activeContourId: this.#activeContourId.peek(),
    };
  }

  #syncFromSnapshot(snapshot: GlyphSnapshot): void {
    batch(() => {
      this.#xAdvance.set(snapshot.xAdvance);
      this.#anchors.set(snapshot.anchors);
      this.#compositeContours.set(snapshot.compositeContours);
      this.#activeContourId.set(snapshot.activeContourId);

      const currentById = new Map<ContourId, GlyphContour>();
      for (const c of this.#contours.peek()) {
        currentById.set(c.id, c);
      }

      const updated: GlyphContour[] = snapshot.contours.map((cs) => {
        const existing = currentById.get(cs.id);
        if (existing) {
          existing._update(cs);
          return existing;
        }
        return new GlyphContour(cs);
      });

      this.#contours.set(updated);
    });
  }

  #patchPositions(updates: NodePositionUpdateList): void {
    if (updates.length === 0) return;

    const pointMoves = new Map<PointId, Point2D>();
    const anchorMoves = new Map<AnchorId, Point2D>();

    for (const u of updates) {
      switch (u.node.kind) {
        case "point":
          pointMoves.set(u.node.id, u);
          break;
        case "anchor":
          anchorMoves.set(u.node.id, u);
          break;
      }
    }

    batch(() => {
      if (pointMoves.size > 0) {
        for (const contour of this.#contours.peek()) {
          const pts = contour.points;
          if (!pts.some((p) => pointMoves.has(p.id))) continue;

          contour._setPoints(
            pts.map((pt) => {
              const move = pointMoves.get(pt.id);
              return move ? { ...pt, x: move.x, y: move.y } : pt;
            }),
          );
        }
      }

      if (anchorMoves.size > 0) {
        const current = this.#anchors.peek();
        if (current.some((a) => anchorMoves.has(a.id))) {
          this.#anchors.set(
            current.map((anchor) => {
              const move = anchorMoves.get(anchor.id);
              return move ? { ...anchor, x: move.x, y: move.y } : anchor;
            }),
          );
        }
      }
    });
  }
}

function isSnapshot(change: GlyphChange): change is GlyphSnapshot {
  return !Array.isArray(change);
}

function buildPath2D(points: SegmentContourLike["points"], closed: boolean): Path2D {
  const path = new Path2D();
  if (points.length < 2) return path;

  const segments = parseContourSegments({ points, closed });
  const first = segments[0];
  if (!first) return path;

  path.moveTo(first.points.anchor1.x, first.points.anchor1.y);

  for (const segment of segments) {
    switch (segment.type) {
      case "line":
        path.lineTo(segment.points.anchor2.x, segment.points.anchor2.y);
        break;
      case "quad":
        path.quadraticCurveTo(
          segment.points.control.x,
          segment.points.control.y,
          segment.points.anchor2.x,
          segment.points.anchor2.y,
        );
        break;
      case "cubic":
        path.bezierCurveTo(
          segment.points.control1.x,
          segment.points.control1.y,
          segment.points.control2.x,
          segment.points.control2.y,
          segment.points.anchor2.x,
          segment.points.anchor2.y,
        );
        break;
    }
  }

  if (closed) path.closePath();
  return path;
}
