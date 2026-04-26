/**
 * Reactive glyph model.
 *
 * {@link Glyph} and {@link Contour} are reactive mirrors of Rust glyph data
 * with per-contour signal granularity. Property getters auto-unwrap signals,
 * so consumers read `glyph.contours`, `glyph.xAdvance`, `contour.points`
 * as plain values. Inside a reactive context (computed/effect) the read
 * auto-tracks the signal.
 *
 * All mutations go through {@link Glyph.apply}, which accepts either a full
 * {@link GlyphSnapshot} (structural edits, undo/redo) or a
 * {@link NodePositionUpdateList} (drag hot path).
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
  type Signal,
} from "@/lib/reactive/signal";
import {
  Contours,
  Glyphs,
  parseContourSegments,
  segmentToCurve,
  type SegmentContourLike,
  type PointWithNeighbors,
} from "@shift/font";
import { Bounds, Curve, Vec2, type Bounds as BoundsType } from "@shift/geo";
import type { NodePositionUpdate, NodePositionUpdateList } from "@/types/positionUpdate";
import { Segment } from "@/lib/model/Segment";

export interface GlyphSidebearings {
  readonly lsb: number | null;
  readonly rsb: number | null;
}

export type GlyphChange = GlyphSnapshot | NodePositionUpdateList;

import type { Canvas } from "@/lib/editor/rendering/Canvas";
import type { NativeBridge } from "@/bridge";
import type { PointEdit, PasteResult } from "@/types/engine";
import type { ContourContent } from "@/lib/clipboard";
import { Transform } from "@/lib/transform/Transform";
import { Alignment } from "@/lib/transform/Alignment";
import type { AlignmentType, DistributeType, ReflectAxis } from "@/types/transform";
import type { PointPosition } from "@/lib/transform/PointPosition";

export class Contour {
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

  get firstPoint(): Point | null {
    return this.#points.value[0] ?? null;
  }

  get lastPoint(): Point | null {
    const pts = this.#points.value;
    return pts[pts.length - 1] ?? null;
  }

  get isEmpty(): boolean {
    return this.#points.value.length === 0;
  }

  /** @knipclassignore */
  *withNeighbors(): Generator<PointWithNeighbors> {
    yield* Contours.withNeighbors(this);
  }

  *segments(): Generator<Segment> {
    yield* Segment.parse(this.#points.value, this.#closed.value);
  }

  /**
   * Tight bounds for the subset of this contour's points in `ids`.
   * Fully-selected segments contribute their bezier envelope; partially-selected
   * segments contribute the raw points of their selected endpoints.
   */
  selectionBounds(ids: ReadonlySet<PointId>): BoundsType | null {
    const parts: (BoundsType | null)[] = [];

    for (const segment of this.segments()) {
      if (segment.pointIds.every((id) => ids.has(id))) {
        parts.push(segment.bounds);
      }
    }

    parts.push(Bounds.fromPoints(this.#points.value.filter((p) => ids.has(p.id))));

    return Bounds.unionAll(parts);
  }

  canClose(position: Point2D, hitRadius: number): boolean {
    return Contours.canClose(this, position, hitRadius);
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
  readonly #bridge: NativeBridge;

  readonly #contours: WritableSignal<readonly Contour[]>;
  readonly #xAdvance: WritableSignal<number>;
  readonly #anchors: WritableSignal<readonly Anchor[]>;
  readonly #compositeContours: WritableSignal<readonly RenderContour[]>;
  readonly #activeContourId: WritableSignal<ContourId | null>;
  readonly #path: ComputedSignal<Path2D>;
  readonly #bbox: ComputedSignal<BoundsType | null>;
  readonly #sidebearings: ComputedSignal<GlyphSidebearings>;

  constructor(bridge: NativeBridge) {
    this.#bridge = bridge;
    const snapshot = bridge.getSnapshot();
    this.name = snapshot.name;
    this.unicode = snapshot.unicode;
    this.#contours = signal<readonly Contour[]>(snapshot.contours.map((c) => new Contour(c)));
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

    // Point-based x-range — cheap, matches integer-rounded sidebar display.
    // Avoids warming the bezier #bbox chain which transitively computes
    // every contour's bezier bounds. Consumers use `useGlyphSidebearings`
    // React hook to subscribe; not exposed as a `$sidebearings` signal to
    // prevent accidental subscription-driven recomputation.
    this.#sidebearings = computed<GlyphSidebearings>(() => {
      let minX = Infinity;
      let maxX = -Infinity;
      for (const contour of this.#contours.value) {
        for (const p of contour.points) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
        }
      }
      if (minX === Infinity) return { lsb: null, rsb: null };
      return { lsb: minX, rsb: this.#xAdvance.value - maxX };
    });
  }

  get contours(): readonly Contour[] {
    return this.#contours.value;
  }

  /**
   * @knipclassignore — used by purpose-specific React hooks in `@/hooks/`
   * Signal that fires once per structural/position change — use this to
   * subscribe to "something about the glyph changed" without forcing the
   * bounds / path / bbox computeds to eagerly recompute. Consumers pull
   * derived values on demand after the signal fires.
   */
  get $contours(): Signal<readonly Contour[]> {
    return this.#contours;
  }

  get xAdvance(): number {
    return this.#xAdvance.value;
  }

  get anchors(): readonly Anchor[] {
    return this.#anchors.value;
  }

  /** @knipclassignore — part of domain Glyph structural contract */
  get compositeContours(): readonly RenderContour[] {
    return this.#compositeContours.value;
  }

  /** @knipclassignore */
  get activeContourId(): ContourId | null {
    return this.#activeContourId.value;
  }

  get path(): Path2D {
    return this.#path.value;
  }

  /** @knipclassignore */
  get bbox(): BoundsType | null {
    return this.#bbox.value;
  }

  /**
   * @knipclassignore — used by Editor command path and `useGlyphSidebearings`
   * Sidebearings (point-based x-range) — pull at read time; for React live
   * display use `useGlyphSidebearings()`.
   */
  get sidebearings(): GlyphSidebearings {
    return this.#sidebearings.value;
  }

  /** @knipclassignore — subscribed by `useGlyphXAdvance` hook */
  get $xAdvance(): Signal<number> {
    return this.#xAdvance;
  }

  /** @knipclassignore Fill the glyph's complete path using the theme's glyph fill color. */
  draw(canvas: Canvas): void {
    canvas.fillPath(this.path, canvas.theme.glyph.fill);
  }

  /** @knipclassignore Stroke the glyph's complete path using the theme's glyph stroke style. */
  drawOutline(canvas: Canvas): void {
    canvas.strokePath(this.path, canvas.theme.glyph.stroke, canvas.theme.glyph.widthPx);
  }

  /** @knipclassignore */
  point(pointId: PointId) {
    return Glyphs.findPoint(this, pointId);
  }

  /** @knipclassignore */
  points(pointIds: readonly PointId[]): Point[] {
    return Glyphs.findPoints(this, [...pointIds]);
  }

  /** @knipclassignore */
  contour(contourId: ContourId) {
    return Glyphs.findContour(this, contourId);
  }

  /** @knipclassignore */
  get allPoints(): Point[] {
    return Glyphs.getAllPoints(this);
  }

  /** @knipclassignore */
  *segments(): Generator<{ segment: Segment; contourId: ContourId }> {
    for (const contour of this.#contours.value) {
      for (const segment of contour.segments()) {
        yield { segment, contourId: contour.id };
      }
    }
  }

  /** @knipclassignore */
  getPointAt(pos: Point2D, radius: number): Point | null {
    return Glyphs.getPointAt(this, pos, radius);
  }

  /** @knipclassignore — callers migrating from bridge → glyph */
  addPoint(edit: PointEdit): PointId {
    return this.#bridge.addPoint(edit);
  }

  /** @knipclassignore */
  addPointToContour(contourId: ContourId, edit: PointEdit): PointId {
    return this.#bridge.addPointToContour(contourId, edit);
  }

  /** @knipclassignore */
  insertPointBefore(beforePointId: PointId, edit: PointEdit): PointId {
    return this.#bridge.insertPointBefore(beforePointId, edit);
  }

  /** @knipclassignore */
  movePoints(pointIds: PointId[], delta: Point2D): PointId[] {
    return this.#bridge.movePoints(pointIds, delta);
  }

  /** @knipclassignore */
  movePointTo(pointId: PointId, position: Point2D): void {
    this.#bridge.movePointTo(pointId, position.x, position.y);
  }

  /** @knipclassignore */
  moveAnchors(anchorIds: AnchorId[], delta: Point2D): void {
    this.#bridge.moveAnchors(anchorIds, delta);
  }

  /** @knipclassignore */
  removePoints(pointIds: PointId[]): void {
    this.#bridge.removePoints(pointIds);
  }

  /** @knipclassignore */
  toggleSmooth(pointId: PointId): void {
    this.#bridge.toggleSmooth(pointId);
  }

  /** @knipclassignore */
  addContour(): ContourId {
    return this.#bridge.addContour();
  }

  /** @knipclassignore */
  closeContour(): void {
    this.#bridge.closeContour();
  }

  /** @knipclassignore */
  openContour(contourId: ContourId): void {
    this.#bridge.openContour(contourId);
  }

  /** @knipclassignore */
  reverseContour(contourId: ContourId): void {
    this.#bridge.reverseContour(contourId);
  }

  /** @knipclassignore */
  setXAdvance(width: number): void {
    this.#bridge.setXAdvance(width);
  }

  /** @internal High-throughput position write primitive used by domain verbs. */
  setNodePositions(updates: NodePositionUpdateList): void {
    this.#bridge.setNodePositions(updates);
  }

  /** @knipclassignore */
  translate(pointIds: readonly PointId[], delta: Point2D): void {
    if (pointIds.length === 0 || (delta.x === 0 && delta.y === 0)) return;

    const points = this.#resolvePointPositions(pointIds);
    if (points.length === 0) return;

    this.#applyPointUpdates(
      points.map((point) => {
        const next = Vec2.add(point, delta);
        return { node: { kind: "point", id: point.id }, x: next.x, y: next.y };
      }),
    );
  }

  /** @knipclassignore */
  moveSelectionTo(pointIds: readonly PointId[], target: Point2D, anchor: Point2D): void {
    if (pointIds.length === 0) return;

    const points = this.#resolvePointPositions(pointIds);
    if (points.length === 0) return;

    const delta = Vec2.sub(target, anchor);

    this.#applyPointUpdates(
      points.map((point) => {
        const next = Vec2.add(point, delta);
        return { node: { kind: "point", id: point.id }, x: next.x, y: next.y };
      }),
    );
  }

  /** @knipclassignore */
  rotate(pointIds: readonly PointId[], angle: number, origin: Point2D): void {
    if (pointIds.length === 0 || angle === 0) return;

    const points = this.#resolvePointPositions(pointIds);
    if (points.length === 0) return;

    this.#applyPointPositions(Transform.rotatePoints(points, angle, origin));
  }

  /** @knipclassignore */
  scale(pointIds: readonly PointId[], sx: number, sy: number, origin: Point2D): void {
    if (pointIds.length === 0 || (sx === 1 && sy === 1)) return;

    const points = this.#resolvePointPositions(pointIds);
    if (points.length === 0) return;

    this.#applyPointPositions(Transform.scalePoints(points, sx, sy, origin));
  }

  /** @knipclassignore */
  reflect(pointIds: readonly PointId[], axis: ReflectAxis, origin: Point2D): void {
    if (pointIds.length === 0) return;

    const points = this.#resolvePointPositions(pointIds);
    if (points.length === 0) return;

    this.#applyPointPositions(Transform.reflectPoints(points, axis, origin));
  }

  /** @knipclassignore */
  align(pointIds: readonly PointId[], alignment: AlignmentType): void {
    if (pointIds.length === 0) return;

    const points = this.#resolvePointPositions(pointIds);
    if (points.length === 0) return;

    const bounds = Bounds.fromPoints(points);
    if (!bounds) return;

    this.#applyPointPositions(Alignment.alignPoints(points, alignment, bounds));
  }

  /** @knipclassignore */
  distribute(pointIds: readonly PointId[], type: DistributeType): void {
    if (pointIds.length < 3) return;

    const points = this.#resolvePointPositions(pointIds);
    if (points.length < 3) return;

    this.#applyPointPositions(Alignment.distributePoints(points, type));
  }

  /** @knipclassignore */
  setActiveContour(contourId: ContourId): void {
    this.#bridge.setActiveContour(contourId);
  }

  /** @knipclassignore */
  clearActiveContour(): void {
    this.#bridge.clearActiveContour();
  }

  /** @knipclassignore */
  restoreSnapshot(snapshot: GlyphSnapshot): void {
    this.#bridge.restoreSnapshot(snapshot);
  }

  /** @knipclassignore */
  translateLayer(dx: number, dy: number): void {
    this.#bridge.translateLayer(dx, dy);
  }

  /** @knipclassignore */
  pasteContours(contours: ContourContent[], offsetX: number, offsetY: number): PasteResult {
    return this.#bridge.pasteContours(contours, offsetX, offsetY);
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

  /**
   * @knipclassignore — used by VariationPanel for live interpolation
   *
   * Apply interpolated values from variation math.
   *
   * `values` order MUST match `flatten()` in crates/shift-core/src/interpolation.rs:
   *   [xAdvance, p0.x, p0.y, p1.x, p1.y, ..., a0.x, a0.y, ...]
   *
   * In-place patch — reuses Point/Contour/Anchor identities, fires per-contour
   * signals via a single batch. No struct allocation tree, no JSON parse, no
   * NAPI hop on the hot path.
   *
   * Length-checked at runtime to catch drift between Rust's flatten() walk and
   * this one. Round-trip-tested in interpolate.test.ts (parity test ensures
   * the values themselves are correct).
   */
  applyValues(values: Float64Array): void {
    const contours = this.#contours.peek();
    const anchors = this.#anchors.peek();

    let expected = 1; // xAdvance
    for (const c of contours) expected += c.points.length * 2;
    expected += anchors.length * 2;

    if (values.length !== expected) {
      throw new Error(
        `Glyph.applyValues: length mismatch — got ${values.length}, expected ${expected}. ` +
          `flatten() in shift-core::interpolation may have drifted from this walk.`,
      );
    }

    batch(() => {
      let i = 0;
      this.#xAdvance.set(values[i++]);

      for (const contour of contours) {
        contour._setPoints(
          contour.points.map((pt) => {
            const x = values[i++];
            const y = values[i++];
            return { ...pt, x, y };
          }),
        );
      }
      this.#contours.set([...contours]);

      this.#anchors.set(
        anchors.map((a) => {
          const x = values[i++];
          const y = values[i++];
          return { ...a, x, y };
        }),
      );
    });
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

  #resolvePointPositions(pointIds: readonly PointId[]): PointPosition[] {
    return this.points(pointIds).map((point) => ({
      id: point.id,
      x: point.x,
      y: point.y,
    }));
  }

  #applyPointPositions(points: readonly PointPosition[]): void {
    this.#applyPointUpdates(
      points.map((point) => ({ node: { kind: "point", id: point.id }, x: point.x, y: point.y })),
    );
  }

  #applyPointUpdates(updates: readonly NodePositionUpdate[]): void {
    if (updates.length === 0) return;
    this.setNodePositions(updates);
  }

  #syncFromSnapshot(snapshot: GlyphSnapshot): void {
    batch(() => {
      this.#xAdvance.set(snapshot.xAdvance);
      this.#anchors.set(snapshot.anchors);
      this.#compositeContours.set(snapshot.compositeContours);
      this.#activeContourId.set(snapshot.activeContourId);

      const currentById = new Map<ContourId, Contour>();
      for (const c of this.#contours.peek()) {
        currentById.set(c.id, c);
      }

      const updated: Contour[] = snapshot.contours.map((cs) => {
        const existing = currentById.get(cs.id);
        if (existing) {
          existing._update(cs);
          return existing;
        }
        return new Contour(cs);
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
        const contours = this.#contours.peek();
        for (const contour of contours) {
          const pts = contour.points;
          if (!pts.some((p) => pointMoves.has(p.id))) continue;

          contour._setPoints(
            pts.map((pt) => {
              const move = pointMoves.get(pt.id);
              return move ? { ...pt, x: move.x, y: move.y } : pt;
            }),
          );
        }
        this.#contours.set([...contours]);
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
