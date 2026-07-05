import type {
  AnchorId,
  ContourData,
  ContourId,
  GlyphId,
  GlyphName,
  GlyphState,
  GlyphStructure,
  LayerId,
  PointId,
  PointSeed,
  Source,
  SourceId,
  Unicode,
} from "@shift/types";
import { mintAnchorId, mintContourId, mintPointId } from "@shift/types";
import type { GlyphHandle } from "@shift/bridge";
import { computed, keyedCache, type ComputedSignal, type Signal } from "@/lib/signals";
import type { AxisLocation } from "@/types/variation";
import { Transform } from "@/lib/transform/Transform";
import { Alignment } from "@/lib/transform/Alignment";
import type { AlignmentType, DistributeType, ReflectAxis } from "@/types/transform";
import {
  Bounds,
  Vec2,
  type Bounds as BoundsType,
  type CubicCurve,
  type Point2D,
  type QuadraticCurve,
} from "@shift/geo";
import {
  Anchor,
  Component,
  Contour,
  GlyphStateGeometry as GlyphGeometry,
  IdIndex,
  type GeometryAnchorHit,
  type GeometryPointHit,
  type GeometrySegmentHit,
  type GlyphHit,
  Segment,
  type SegmentId,
  type GlyphPosition as GlyphLayerPosition,
  type GlyphPositions as GlyphLayerPositions,
  type GlyphPositionTarget as GlyphLayerPositionTarget,
  type GlyphSidebearings,
  type NewPoint,
  Point,
} from "@shift/glyph-state";
import { GlyphOutline } from "./GlyphOutline";
import {
  GlyphRenderModel,
  LayerRenderAnchor,
  LayerRenderContour,
  type RenderAnchor,
  type RenderContour,
  type GlyphRenderAnchorInput,
  type GlyphRenderContourInput,
} from "./GlyphRenderModel";
import { GlyphLayerPositionList } from "./GlyphLayerPositionList";
import { GlyphLayerPositionPatch } from "./GlyphLayerPositionPatch";
import {
  GlyphLayerState,
  type LayerContourCoordinates,
  type LayerCoordinateBuffers,
} from "./GlyphLayerState";
import type { Font } from "./Font";
import { LayerIntents } from "@/lib/workspace/LayerIntents";
import type { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";

export {
  GlyphGeometry,
  type GlyphSidebearings,
  type GlyphLayerPosition,
  type GlyphLayerPositions,
  type GlyphLayerPositionTarget,
};

interface GlyphEditState {
  readonly state: GlyphLayerState;
  readonly geometry: Signal<GlyphGeometry>;
}

/**
 * Resolved reactive inputs used to construct one read-only glyph instance.
 *
 * @remarks
 * `Font` owns these signals so source matching, interpolation, and outline
 * component lookup stay outside `GlyphInstance`.
 */
export interface GlyphInstanceInput {
  readonly location: Signal<AxisLocation>;
  readonly layer: Signal<GlyphLayer | null>;
  readonly geometry: Signal<GlyphGeometry>;
  readonly outline: GlyphOutline;
}

/**
 * Geometry lookup surface for a glyph instance.
 *
 * @remarks
 * Exact source instances read sparse reactive coordinate buffers so lookup and
 * hit testing avoid rebuilding full `GlyphGeometry` snapshots during pointer
 * previews. Interpolated instances currently resolve through immutable
 * geometry snapshots; callers should treat that as an implementation detail.
 */
export interface GlyphInstanceGeometry {
  readonly xAdvance: number;
  readonly xAdvanceCell: Signal<number>;
  readonly sidebearings: GlyphSidebearings;
  readonly sidebearingsCell: Signal<GlyphSidebearings>;
  readonly bounds: BoundsType | null;
  readonly contours: readonly Contour[];
  readonly allPoints: readonly Point[];

  contour(contourId: ContourId): Contour | null;
  point(pointId: PointId): Point | null;
  anchor(anchorId: AnchorId): Anchor | null;
  segment(segmentId: SegmentId): Segment | null;
  hitPoint(pos: Point2D, radius: number): GeometryPointHit | null;
  hitAnchor(pos: Point2D, radius: number): GeometryAnchorHit | null;
  hitAt(pos: Point2D, radius: number): GlyphHit | null;
  hitSegment(pos: Point2D, radius: number): GeometrySegmentHit | null;
}

class GlyphEditSession {
  readonly #editCoordinator: WorkspaceEditCoordinator;
  readonly #intents: LayerIntents;
  readonly #state: GlyphEditState;

  constructor(font: Font, layerId: LayerId, state: GlyphEditState) {
    this.#editCoordinator = font.editCoordinator;
    this.#intents = new LayerIntents(font.editCoordinator, layerId);
    this.#state = state;
  }

  get geometry(): GlyphGeometry {
    return this.#state.geometry.peek();
  }

  get layerState(): GlyphLayerState {
    return this.#state.state;
  }

  transaction<TResult>(label: string, body: () => TResult): TResult {
    return this.#editCoordinator.transaction(label, body);
  }

  setXAdvance(width: number): void {
    this.#intents.setXAdvance({ width });
  }

  applyPositionPatch(updates: GlyphLayerPositions): void {
    // One-shot edits persist through the same movePoints intent as drag
    // commits; the local apply keeps reads synchronous until the echo folds.
    this.commitPositionPatch(updates);
    this.#applyPositionPatchLocally(updates);
  }

  commitPositionPatch(updates: GlyphLayerPositions): void {
    const patch = GlyphLayerPositionPatch.from(updates);
    if (patch.isEmpty) return;

    const pointIds: PointId[] = [];
    const pointCoords: number[] = [];
    const anchorIds: AnchorId[] = [];
    const anchorCoords: number[] = [];
    for (const position of patch.positions) {
      if (position.kind === "point") {
        pointIds.push(position.id);
        pointCoords.push(position.x, position.y);
      } else {
        anchorIds.push(position.id);
        anchorCoords.push(position.x, position.y);
      }
    }

    const commit = () => {
      if (pointIds.length > 0) {
        this.#intents.movePoints({ pointIds, coords: pointCoords });
      }

      if (anchorIds.length > 0) {
        this.#intents.moveAnchors({ anchorIds, coords: anchorCoords });
      }
    };

    if (pointIds.length > 0 && anchorIds.length > 0) {
      this.transaction("Move positions", commit);
      return;
    }

    commit();
  }

  translateLayer(dx: number, dy: number): void {
    // Affine over every confirmed point: O(ids) wire, Rust does the math.
    const pointIds = this.geometry.allPoints.map((point) => point.id);
    if (pointIds.length === 0) return;

    this.#intents.translatePoints({ pointIds, dx, dy });
  }

  previewPositionPatch(updates: GlyphLayerPositions): void {
    if (updates.length === 0) return;
    this.#applyPositionPatchLocally(updates);
  }

  #applyPositionPatchLocally(updates: GlyphLayerPositions): void {
    this.#state.state.patchPositions(updates);
  }

  addContour(): ContourId {
    const contourId = mintContourId();

    this.#intents.addContour({ contourId, closed: false });

    return contourId;
  }

  addPoint(contourId: ContourId, edit: NewPoint): PointId {
    const pointId = mintPointId();

    this.#intents.addPoints({ contourId, points: [this.#seed(pointId, edit)] });

    return pointId;
  }

  insertPointBefore(beforePointId: PointId, edit: NewPoint): PointId {
    const pointId = mintPointId();

    // No contourId: Rust derives the contour from the anchor point — the
    // renderer never bookkeeps pending point→contour maps.
    this.#intents.addPoints({
      before: beforePointId,
      points: [this.#seed(pointId, edit)],
    });

    return pointId;
  }

  openContour(contourId: ContourId): void {
    this.#intents.setContourClosed({ contourId, closed: false });
  }

  closeContour(contourId: ContourId): void {
    this.#intents.setContourClosed({ contourId, closed: true });
  }

  reverseContour(contourId: ContourId): void {
    this.#intents.reverseContour({ contourId });
  }

  applyBooleanOp(
    contourIdA: ContourId,
    contourIdB: ContourId,
    operation: "union" | "subtract" | "intersect" | "difference",
  ): void {
    // Rust-only computation; the echo folds like any other intent.
    this.#intents.applyBooleanOp({ contourIdA, contourIdB, operation });
  }

  removePoints(pointIds: readonly PointId[]): void {
    if (pointIds.length === 0) return;

    this.#intents.removePoints({ pointIds: [...pointIds] });
  }

  addAnchor(name: string | null, position: Point2D): AnchorId {
    const anchorId = mintAnchorId();

    this.#intents.addAnchors({
      anchors: [
        {
          id: anchorId,
          x: position.x,
          y: position.y,
          ...(name === null ? {} : { name }),
        },
      ],
    });

    return anchorId;
  }

  removeAnchors(anchorIds: readonly AnchorId[]): void {
    if (anchorIds.length === 0) return;

    this.#intents.removeAnchors({ anchorIds: [...anchorIds] });
  }

  toggleSmooth(pointId: PointId): void {
    // Reading CONFIRMED state to compute the next value is describing, not
    // applying; an unconfirmed same-tick point cannot be toggled yet.
    const point = this.geometry.allPoints.find((candidate) => candidate.id === pointId);
    if (!point) {
      throw new Error(`cannot toggle smooth: point ${pointId} is not in confirmed state`);
    }

    this.#intents.setPointSmooth({ pointId, smooth: !point.smooth });
  }

  #seed(id: PointId, edit: NewPoint): PointSeed {
    return {
      id,
      x: edit.x,
      y: edit.y,
      pointType: edit.pointType,
      smooth: edit.smooth,
    };
  }
}

/**
 * Authored glyph layer data for one source.
 *
 * A source is the authored glyph at a designspace location. `GlyphLayer`
 * exposes the reactive geometry for that source and forwards mutations to the
 * bridge with the source layer's stable ID. Preview methods update the
 * renderer-facing reactive data; commit methods also produce bridge changes.
 */
export class GlyphLayer {
  readonly source: Source;
  readonly #edit: GlyphEditSession;

  constructor(source: Source, edit: GlyphEditSession) {
    this.source = source;
    this.#edit = edit;
  }

  /** @knipclassignore — stable edit identity for this authored glyph layer. */
  get id(): LayerId {
    return this.#edit.layerState.state.layerId;
  }

  get layerId(): LayerId {
    return this.id;
  }

  /** @knipclassignore — convenience alias for source identity. */
  get sourceId(): SourceId {
    return this.source.id;
  }

  get geometry(): GlyphGeometry {
    return this.#edit.geometry;
  }

  /** @internal Reactive glyph structure used by renderer-facing projections. */
  get structureCell(): Signal<GlyphStructure> {
    return this.#edit.layerState.structureCell;
  }

  /** @internal Reactive coordinate buffers used by renderer-facing projections. */
  get coordinateBuffers(): LayerCoordinateBuffers {
    return this.#edit.layerState.coordinateBuffers;
  }

  /** @internal Tracks replacement of the source coordinate-buffer container. */
  get coordinateBuffersCell(): Signal<LayerCoordinateBuffers> {
    return this.#edit.layerState.coordinateBuffersCell;
  }

  /** @internal Tracks any coordinate change without materializing full geometry. */
  get coordinateBuffersChangedCell(): Signal<LayerCoordinateBuffers> {
    return this.#edit.layerState.coordinateBuffersChangedCell;
  }

  get state(): GlyphState {
    return this.#edit.layerState.state;
  }

  get xAdvanceCell(): Signal<number> {
    return this.#edit.layerState.xAdvanceCell;
  }

  get xAdvance(): number {
    return this.#edit.layerState.xAdvance;
  }

  get pointCount(): number {
    return this.#edit.layerState.pointCount;
  }

  get contours(): readonly Contour[] {
    return this.geometry.contours;
  }

  get anchors(): readonly Anchor[] {
    return this.geometry.anchors;
  }

  /** @knipclassignore — public authored layer geometry API. */
  get components(): readonly Component[] {
    return this.geometry.components;
  }

  get bounds(): BoundsType | null {
    return this.geometry.bounds;
  }

  /** @knipclassignore — public authored-source metrics API. */
  get sidebearings(): GlyphSidebearings {
    return this.#edit.layerState.sidebearings;
  }

  get sidebearingsCell(): Signal<GlyphSidebearings> {
    return this.#edit.layerState.sidebearingsCell;
  }

  get allPoints(): Point[] {
    return this.geometry.allPoints;
  }

  point(pointId: PointId): Point | null {
    return this.geometry.point(pointId);
  }

  points(pointIds: readonly PointId[]): Point[] {
    return this.geometry.points(pointIds);
  }

  /** @knipclassignore — public authored-source lookup API. */
  anchor(anchorId: AnchorId): Anchor | null {
    return this.geometry.anchor(anchorId);
  }

  contour(contourId: ContourId): Contour | null {
    return this.geometry.contour(contourId);
  }

  segment(segmentId: SegmentId): Segment | null {
    return this.geometry.segment(segmentId);
  }

  contourIdOfPoint(pointId: PointId): ContourId | null {
    return this.#edit.layerState.contourIdOfPoint(pointId);
  }

  /**
   * Read current positions for mixed point/anchor targets.
   *
   * Missing targets are ignored. The returned positions are suitable for
   * transforms and for passing back to {@link applyPositionPatch} or
   * {@link previewPositionPatch}.
   *
   * @param targets - Points or anchors whose current source coordinates are required.
   * @returns Fresh position records for targets that exist in this source.
   *
   * @example
   * ```ts
   * const positions = source.positionsFor([{ kind: "point", id }])
   * source.applyPositionPatch(Transform.rotatePoints(positions, angle, origin))
   * ```
   */
  positionsFor(targets: readonly GlyphLayerPositionTarget[]): GlyphLayerPosition[] {
    const list = GlyphLayerPositionList.fromTargets(this.#edit.layerState, targets);
    return [...list.positions];
  }

  /**
   * Sets this source's horizontal advance.
   *
   * @param width - New advance width in UPM units.
   */
  setXAdvance(width: number): void {
    this.#edit.setXAdvance(width);
  }

  /**
   * Sets this source's right sidebearing by changing horizontal advance.
   *
   * @param value - Desired distance from outline right edge to advance width.
   */
  setRightSidebearing(value: number): void {
    const bounds = this.bounds;
    if (!bounds) return;

    const width = bounds.max.x + value;
    if (width === this.xAdvance) return;

    this.setXAdvance(width);
  }

  /**
   * Sets this source's left sidebearing by translating outline geometry.
   *
   * @remarks
   * The advance width changes by the same delta as the outline translation so
   * the right sidebearing remains unchanged. Anchors are not translated.
   *
   * @param value - Desired outline left edge position.
   */
  setLeftSidebearing(value: number): void {
    const current = this.sidebearings.lsb;
    if (current === null) return;

    const deltaX = value - current;
    if (deltaX === 0) return;

    this.#edit.transaction("Set left sidebearing", () => {
      this.translateLayer(deltaX, 0);
      this.setXAdvance(this.xAdvance + deltaX);
    });
  }

  /**
   * Apply a sparse point/anchor position patch to Rust and local geometry.
   *
   * Use this for one-shot edits and undo/redo of position operations. The bridge
   * validates and commits the patch; TypeScript applies the same sparse patch
   * locally without reading back a full glyph values buffer.
   *
   * @param updates - Point and anchor positions to write into the source.
   */
  applyPositionPatch(updates: GlyphLayerPositions): void {
    this.#edit.applyPositionPatch(updates);
  }

  /**
   * Commit a sparse point/anchor position patch to Rust only.
   *
   * Use this after the same patch has already been applied locally with
   * {@link previewPositionPatch}. This is the drag-end path: it updates the
   * native glyph layer without replacing TypeScript geometry.
   *
   * @param updates - Final point and anchor positions to persist.
   */
  commitPositionPatch(updates: GlyphLayerPositions): void {
    this.#edit.commitPositionPatch(updates);
  }

  /**
   * Translates every coordinate in this source layer.
   *
   * @param dx - Horizontal movement in UPM units.
   * @param dy - Vertical movement in UPM units.
   */
  translateLayer(dx: number, dy: number): void {
    this.#edit.translateLayer(dx, dy);
  }

  /**
   * Apply a sparse point/anchor position patch to local geometry only.
   *
   * This is the pointer-preview path. It updates the TypeScript geometry used
   * for rendering and hit feedback, but does not touch Rust or command history.
   *
   * @param updates - Point and anchor positions to show for the current interaction frame.
   */
  previewPositionPatch(updates: GlyphLayerPositions): void {
    this.#edit.previewPositionPatch(updates);
  }

  /**
   * Adds an empty contour to this source.
   *
   * @returns ID of the created contour.
   */
  addContour(): ContourId {
    return this.#edit.addContour();
  }

  /**
   * Adds a point to an existing contour.
   *
   * @param contourId - Contour that receives the point.
   * @param edit - Point construction data to append.
   * @returns ID of the created point.
   */
  addPoint(contourId: ContourId, edit: NewPoint): PointId {
    return this.#edit.addPoint(contourId, edit);
  }

  /**
   * Adds a corner on-curve point to an existing contour.
   *
   * @param contourId - Contour that receives the point.
   * @param position - Point position in glyph-local UPM units.
   * @returns ID of the created point.
   */
  addOnCurvePoint(contourId: ContourId, position: Point2D): PointId {
    return this.addPoint(contourId, Point.onCurve(position));
  }

  /**
   * Adds a smooth on-curve point to an existing contour.
   *
   * @param contourId - Contour that receives the point.
   * @param position - Point position in glyph-local UPM units.
   * @returns ID of the created point.
   */
  addSmoothPoint(contourId: ContourId, position: Point2D): PointId {
    return this.addPoint(contourId, Point.smooth(position));
  }

  /**
   * Adds an off-curve control point to an existing contour.
   *
   * @param contourId - Contour that receives the point.
   * @param position - Point position in glyph-local UPM units.
   * @returns ID of the created point.
   */
  addOffCurvePoint(contourId: ContourId, position: Point2D): PointId {
    return this.addPoint(contourId, Point.offCurve(position));
  }

  /**
   * Inserts a point immediately before an existing point.
   *
   * @param pointId - Existing point that determines the insertion position.
   * @param edit - Point construction data to insert.
   * @returns ID of the created point.
   */
  insertPointBefore(pointId: PointId, edit: NewPoint): PointId {
    return this.#edit.insertPointBefore(pointId, edit);
  }

  /**
   * Opens a closed contour in this source.
   *
   * @param contourId - Contour to mark as open.
   */
  openContour(contourId: ContourId): void {
    this.#edit.openContour(contourId);
  }

  /**
   * Closes an open contour in this source.
   *
   * @param contourId - Contour to mark as closed.
   */
  closeContour(contourId: ContourId): void {
    this.#edit.closeContour(contourId);
  }

  /**
   * Reverses point order for a contour in this source.
   *
   * @param contourId - Contour whose winding order is reversed.
   */
  reverseContour(contourId: ContourId): void {
    this.#edit.reverseContour(contourId);
  }

  /**
   * Splits a current segment and preserves its shape.
   *
   * @param segmentId - Segment in this layer's current geometry to split.
   * @param t - Parametric split position from 0 to 1.
   * @returns The inserted on-curve point id, or `null` when the segment is unavailable.
   */
  splitSegment(segmentId: SegmentId, t: number): PointId | null {
    const segment = this.geometry.segment(segmentId);
    if (!segment) return null;

    return this.#edit.transaction("Split segment", () => {
      switch (segment.type) {
        case "line":
          return this.#splitLineSegment(segment, t);
        case "quad":
          return this.#splitQuadraticSegment(segment, t);
        case "cubic":
          return this.#splitCubicSegment(segment, t);
      }
    });
  }

  /**
   * Converts a current line segment into a shape-preserving cubic segment.
   *
   * @param segmentId - Segment in this layer's current geometry to upgrade.
   * @returns `true` when the segment was upgraded; `false` when it is missing or not a line.
   */
  upgradeLineToCubic(segmentId: SegmentId): boolean {
    const segment = this.geometry.segment(segmentId);
    if (!segment || segment.type !== "line") return false;

    const points = segment.asLine();
    if (!points) return false;

    this.#edit.transaction("Upgrade line to cubic", () => {
      const control1Pos = {
        x: points.start.x + (points.end.x - points.start.x) / 3,
        y: points.start.y + (points.end.y - points.start.y) / 3,
      };
      const control2Pos = {
        x: points.start.x + ((points.end.x - points.start.x) * 2) / 3,
        y: points.start.y + ((points.end.y - points.start.y) * 2) / 3,
      };

      const control2Id = this.insertPointBefore(points.end.id, Point.offCurve(control2Pos));
      this.insertPointBefore(control2Id, Point.offCurve(control1Pos));
    });

    return true;
  }

  #splitLineSegment(segment: Segment, t: number): PointId {
    return this.insertPointBefore(segment.endId, Point.onCurve(segment.pointAt(t)));
  }

  #splitQuadraticSegment(segment: Segment, t: number): PointId {
    const points = segment.asQuad()!;
    const [curveA, curveB] = segment.splitAt(t) as [QuadraticCurve, QuadraticCurve];

    const splitPointId = this.insertPointBefore(points.end.id, Point.smooth(curveA.p1));
    this.insertPointBefore(points.end.id, Point.offCurve(curveB.c));
    this.movePointTo(points.control.id, curveA.c);

    return splitPointId;
  }

  #splitCubicSegment(segment: Segment, t: number): PointId {
    const points = segment.asCubic()!;
    const [curveA, curveB] = segment.splitAt(t) as [CubicCurve, CubicCurve];

    this.insertPointBefore(points.controlEnd.id, Point.offCurve(curveA.c1));
    const splitPointId = this.insertPointBefore(points.controlEnd.id, Point.smooth(curveA.p1));
    this.insertPointBefore(points.controlEnd.id, Point.offCurve(curveB.c0));
    this.movePointTo(points.controlStart.id, curveA.c0);
    this.movePointTo(points.controlEnd.id, curveB.c1);

    return splitPointId;
  }

  /**
   * Applies a boolean operation between two contours.
   *
   * @param contourIdA - First contour participating in the operation.
   * @param contourIdB - Second contour participating in the operation.
   * @param operation - Boolean operation to apply.
   */
  applyBooleanOp(
    contourIdA: ContourId,
    contourIdB: ContourId,
    operation: "union" | "subtract" | "intersect" | "difference",
  ): void {
    this.#edit.applyBooleanOp(contourIdA, contourIdB, operation);
  }

  /**
   * Removes points from this source.
   *
   * @param pointIds - Point IDs to delete; missing IDs are ignored by the source layer.
   */
  removePoints(pointIds: readonly PointId[]): void {
    this.#edit.removePoints(pointIds);
  }

  /**
   * Adds an anchor to this source.
   *
   * @param name - Anchor name, or null for an unnamed anchor.
   * @param position - Anchor position in glyph-local UPM units.
   * @returns ID of the created anchor.
   */
  addAnchor(name: string | null, position: Point2D): AnchorId {
    return this.#edit.addAnchor(name, position);
  }

  /**
   * Removes anchors from this source.
   *
   * @param anchorIds - Anchor IDs to delete.
   */
  removeAnchors(anchorIds: readonly AnchorId[]): void {
    this.#edit.removeAnchors(anchorIds);
  }

  /**
   * Toggles smooth/corner state for an on-curve point.
   *
   * @param pointId - Point whose smooth flag changes.
   */
  toggleSmooth(pointId: PointId): void {
    this.#edit.toggleSmooth(pointId);
  }

  /**
   * Moves one point to an absolute glyph-local position.
   *
   * @param pointId - Point to move.
   * @param position - Destination in glyph-local UPM units.
   */
  movePointTo(pointId: PointId, position: Point2D): void {
    this.applyPositionPatch([{ kind: "point", id: pointId, x: position.x, y: position.y }]);
  }

  /**
   * Moves points by a relative delta.
   *
   * @param pointIds - Points to translate together.
   * @param delta - Relative movement in glyph-local UPM units.
   */
  movePoints(pointIds: readonly PointId[], delta: Point2D): void {
    const positions = this.positionsFor(pointIds.map((id) => ({ kind: "point", id })));
    const nextPositions = positions.map((position) => {
      const next = Vec2.add(position, delta);
      return { ...position, x: next.x, y: next.y };
    });

    this.applyPositionPatch(nextPositions);
  }

  /**
   * Moves a point selection so an anchor position reaches a target position.
   *
   * @param pointIds - Points participating in the move.
   * @param target - Destination for the anchor point.
   * @param anchor - Existing anchor position used to compute the delta.
   */
  moveSelectionTo(pointIds: readonly PointId[], target: Point2D, anchor: Point2D): void {
    this.movePoints(pointIds, Vec2.sub(target, anchor));
  }

  /**
   * Rotates points around an origin.
   *
   * @param pointIds - Points to rotate.
   * @param angle - Rotation angle in radians.
   * @param origin - Rotation origin in glyph-local UPM units.
   */
  rotate(pointIds: readonly PointId[], angle: number, origin: Point2D): void {
    this.applyPositionPatch(
      Transform.rotatePoints(
        this.positionsFor(pointIds.map((id) => ({ kind: "point", id }))),
        angle,
        origin,
      ),
    );
  }

  /**
   * Scales points around an origin.
   *
   * @param pointIds - Points to scale.
   * @param sx - Horizontal scale factor.
   * @param sy - Vertical scale factor.
   * @param origin - Scale origin in glyph-local UPM units.
   */
  scale(pointIds: readonly PointId[], sx: number, sy: number, origin: Point2D): void {
    this.applyPositionPatch(
      Transform.scalePoints(
        this.positionsFor(pointIds.map((id) => ({ kind: "point", id }))),
        sx,
        sy,
        origin,
      ),
    );
  }

  /**
   * Reflects points across an axis through an origin.
   *
   * @param pointIds - Points to reflect.
   * @param axis - Reflection axis.
   * @param origin - Axis origin in glyph-local UPM units.
   */
  reflect(pointIds: readonly PointId[], axis: ReflectAxis, origin: Point2D): void {
    this.applyPositionPatch(
      Transform.reflectPoints(
        this.positionsFor(pointIds.map((id) => ({ kind: "point", id }))),
        axis,
        origin,
      ),
    );
  }

  /**
   * Aligns points using a geometric alignment rule.
   *
   * @param pointIds - Points to align.
   * @param alignment - Alignment operation to apply.
   */
  align(pointIds: readonly PointId[], alignment: AlignmentType): void {
    const points = this.positionsFor(pointIds.map((id) => ({ kind: "point", id })));
    const bounds = Bounds.fromPoints(points);
    if (!bounds) return;

    this.applyPositionPatch(Alignment.alignPoints(points, alignment, bounds));
  }

  /**
   * Distributes points according to a spacing rule.
   *
   * @param pointIds - Points to distribute.
   * @param type - Distribution operation to apply.
   */
  distribute(pointIds: readonly PointId[], type: DistributeType): void {
    this.applyPositionPatch(
      Alignment.distributePoints(
        this.positionsFor(pointIds.map((id) => ({ kind: "point", id }))),
        type,
      ),
    );
  }
}

/**
 * Represents one glyph resolved at one designspace location.
 *
 * @remarks
 * `geometry` is the lookup and hit-testing surface, and `render` is the drawing
 * surface. Editability is resolved separately through `Font.layer` or
 * `Font.editableLayerAt`; instances are read/render views only.
 */
export class GlyphInstance {
  readonly #location: Signal<AxisLocation>;
  readonly geometry: GlyphInstanceGeometry;
  readonly render: GlyphRenderModel;

  /**
   * Creates a glyph instance tied to a live designspace location.
   *
   * @param input - Resolved reactive inputs assembled by the owning font.
   */
  constructor(input: GlyphInstanceInput) {
    this.#location = input.location;

    this.geometry = new InstanceGeometry(input.layer, input.geometry);
    this.render = new InstanceRender(input.layer, input.geometry, input.outline).model;
  }

  get location(): AxisLocation {
    return this.#location.peek();
  }

  get xAdvance(): number {
    return this.geometry.xAdvance;
  }

  get xAdvanceCell(): Signal<number> {
    return this.geometry.xAdvanceCell;
  }

  get sidebearings(): GlyphSidebearings {
    return this.geometry.sidebearings;
  }

  get sidebearingsCell(): Signal<GlyphSidebearings> {
    return this.geometry.sidebearingsCell;
  }
}

class InstanceRender {
  readonly #contours = keyedCache({
    name: "glyphInstance.render.contours",
    key: (input: GlyphRenderContourInput) => input.data.id,
    create: (input) => new LayerRenderContour(input),
  });

  readonly #anchors = keyedCache({
    name: "glyphInstance.render.anchors",
    key: (input: GlyphRenderAnchorInput) => input.data.id,
    create: (input) => new LayerRenderAnchor(input),
  });

  readonly model: GlyphRenderModel;

  constructor(
    layer: Signal<GlyphLayer | null>,
    geometry: Signal<GlyphGeometry>,
    outline: GlyphOutline,
  ) {
    const contours = computed<readonly RenderContour[]>(() => {
      const source = layer.value;
      if (source) {
        return this.#sourceContours(source.structureCell.value, source.coordinateBuffersCell.value);
      }

      return GlyphRenderModel.geometryContours(geometry.value);
    });

    const anchors = computed<readonly RenderAnchor[]>(() => {
      const source = layer.value;
      if (source) {
        return this.#sourceAnchors(source.structureCell.value, source.coordinateBuffersCell.value);
      }

      return GlyphRenderModel.geometryAnchors(geometry.value);
    });

    this.model = new GlyphRenderModel(contours, anchors, outline);
  }

  #sourceContours(
    structure: GlyphStructure,
    coordinates: LayerCoordinateBuffers,
  ): readonly RenderContour[] {
    return this.#contours.map(this.#currentContourInputs(structure, coordinates));
  }

  #currentContourInputs(
    structure: GlyphStructure,
    coordinates: LayerCoordinateBuffers,
  ): readonly GlyphRenderContourInput[] {
    const inputs: GlyphRenderContourInput[] = [];

    for (let index = 0; index < structure.contours.length; index++) {
      const data = structure.contours[index];
      const contourCoordinates = coordinates.contours[index];
      if (data && contourCoordinates) inputs.push({ data, coordinates: contourCoordinates });
    }

    return inputs;
  }

  #sourceAnchors(
    structure: GlyphStructure,
    coordinates: LayerCoordinateBuffers,
  ): readonly RenderAnchor[] {
    return this.#anchors.map(
      structure.anchors.map((data, index) => ({
        data,
        values: coordinates.anchors,
        offset: index * 2,
      })),
    );
  }
}

class InstanceGeometry implements GlyphInstanceGeometry {
  readonly #resolved: ComputedSignal<GlyphInstanceGeometry>;
  readonly #xAdvance: ComputedSignal<number>;
  readonly #sidebearings: ComputedSignal<GlyphSidebearings>;

  constructor(layer: Signal<GlyphLayer | null>, geometry: Signal<GlyphGeometry>) {
    this.#resolved = computed(
      () => {
        const source = layer.value;
        if (source) return new SourceGeometryCache(source);

        return new SnapshotGeometryCache(geometry.value);
      },
      { name: "glyphInstance.geometry" },
    );
    this.#xAdvance = computed(() => this.#resolved.value.xAdvance, {
      name: "glyphInstance.geometry.xAdvance",
    });
    this.#sidebearings = computed(() => this.#resolved.value.sidebearings, {
      name: "glyphInstance.geometry.sidebearings",
    });
  }

  get allPoints(): readonly Point[] {
    return this.#resolved.peek().allPoints;
  }

  get xAdvance(): number {
    return this.#xAdvance.peek();
  }

  get xAdvanceCell(): Signal<number> {
    return this.#xAdvance;
  }

  get sidebearings(): GlyphSidebearings {
    return this.#sidebearings.peek();
  }

  get sidebearingsCell(): Signal<GlyphSidebearings> {
    return this.#sidebearings;
  }

  get contours(): readonly Contour[] {
    return this.#resolved.peek().contours;
  }

  get bounds(): BoundsType | null {
    return this.#resolved.peek().bounds;
  }

  contour(contourId: ContourId): Contour | null {
    return this.#resolved.peek().contour(contourId);
  }

  point(pointId: PointId): Point | null {
    return this.#resolved.peek().point(pointId);
  }

  anchor(anchorId: AnchorId): Anchor | null {
    return this.#resolved.peek().anchor(anchorId);
  }

  segment(segmentId: SegmentId): Segment | null {
    return this.#resolved.peek().segment(segmentId);
  }

  hitPoint(pos: Point2D, radius: number): GeometryPointHit | null {
    return this.#resolved.peek().hitPoint(pos, radius);
  }

  hitAnchor(pos: Point2D, radius: number): GeometryAnchorHit | null {
    return this.#resolved.peek().hitAnchor(pos, radius);
  }

  hitAt(pos: Point2D, radius: number): GlyphHit | null {
    return this.#resolved.peek().hitAt(pos, radius);
  }

  hitSegment(pos: Point2D, radius: number): GeometrySegmentHit | null {
    return this.#resolved.peek().hitSegment(pos, radius);
  }
}

class SnapshotGeometryCache implements GlyphInstanceGeometry {
  readonly #geometry: GlyphGeometry;
  readonly #xAdvance: Signal<number>;
  readonly #sidebearings: Signal<GlyphSidebearings>;

  constructor(geometry: GlyphGeometry) {
    this.#geometry = geometry;
    this.#xAdvance = computed(() => geometry.xAdvance, {
      name: "glyphInstance.snapshotGeometry.xAdvance",
    });
    this.#sidebearings = computed(() => geometry.sidebearings, {
      name: "glyphInstance.snapshotGeometry.sidebearings",
    });
  }

  get allPoints(): readonly Point[] {
    return this.#geometry.allPoints;
  }

  get xAdvance(): number {
    return this.#geometry.xAdvance;
  }

  get xAdvanceCell(): Signal<number> {
    return this.#xAdvance;
  }

  get sidebearings(): GlyphSidebearings {
    return this.#geometry.sidebearings;
  }

  get sidebearingsCell(): Signal<GlyphSidebearings> {
    return this.#sidebearings;
  }

  get contours(): readonly Contour[] {
    return this.#geometry.contours;
  }

  get bounds(): BoundsType | null {
    return this.#geometry.bounds;
  }

  contour(contourId: ContourId): Contour | null {
    return this.#geometry.contour(contourId);
  }

  point(pointId: PointId): Point | null {
    return this.#geometry.point(pointId);
  }

  anchor(anchorId: AnchorId): Anchor | null {
    return this.#geometry.anchor(anchorId);
  }

  segment(segmentId: SegmentId): Segment | null {
    return this.#geometry.segment(segmentId);
  }

  hitPoint(pos: Point2D, radius: number): GeometryPointHit | null {
    return this.#geometry.hitPoint(pos, radius);
  }

  hitAnchor(pos: Point2D, radius: number): GeometryAnchorHit | null {
    return this.#geometry.hitAnchor(pos, radius);
  }

  hitAt(pos: Point2D, radius: number): GlyphHit | null {
    return this.#geometry.hitAt(pos, radius);
  }

  hitSegment(pos: Point2D, radius: number): GeometrySegmentHit | null {
    return this.#geometry.hitSegment(pos, radius);
  }
}

class SourceGeometryCache implements GlyphInstanceGeometry {
  readonly #source: GlyphLayer;

  readonly #contourCache = keyedCache({
    name: "instanceGeometry.contours",
    key: (input: ContourInput) => input.data.id,
    create: (input) => new ContourCache(input),
  });

  readonly #sourceContours: ComputedSignal<readonly ContourCache[]>;
  readonly #contours: ComputedSignal<readonly Contour[]>;

  readonly #points: ComputedSignal<readonly Point[]>;
  readonly #pointOwners: ComputedSignal<ReadonlyMap<PointId, ContourCache>>;

  readonly #anchors: IdIndex<AnchorId, Anchor>;

  readonly #segmentOwners: ComputedSignal<ReadonlyMap<SegmentId, ContourCache>>;

  constructor(source: GlyphLayer) {
    this.#source = source;

    this.#sourceContours = computed(() =>
      this.#contoursFromSource(source.structureCell.value, source.coordinateBuffersCell.value),
    );
    this.#contours = computed(() =>
      this.#sourceContours.value.map((contour) => contour.contourCell.value),
    );

    this.#points = computed(() =>
      this.#sourceContours.value.flatMap((contour) => contour.pointsCell.value),
    );
    this.#pointOwners = computed(() => this.#pointOwnersFromSource(this.#sourceContours.value));

    const anchors = computed(() =>
      this.#anchorsFromSource(
        source.structureCell.value,
        source.coordinateBuffersCell.value.anchors.value,
      ),
    );
    this.#anchors = new IdIndex(
      () => anchors.peek(),
      (anchor) => anchor.id,
    );

    this.#segmentOwners = computed(() => this.#segmentOwnersFromSource(this.#sourceContours.value));
  }

  get allPoints(): readonly Point[] {
    return this.#points.peek();
  }

  get xAdvance(): number {
    return this.#source.xAdvance;
  }

  get xAdvanceCell(): Signal<number> {
    return this.#source.xAdvanceCell;
  }

  get sidebearings(): GlyphSidebearings {
    return this.#source.sidebearings;
  }

  get sidebearingsCell(): Signal<GlyphSidebearings> {
    return this.#source.sidebearingsCell;
  }

  get contours(): readonly Contour[] {
    return this.#contours.peek();
  }

  get bounds(): BoundsType | null {
    return this.#source.bounds;
  }

  contour(contourId: ContourId): Contour | null {
    return (
      this.#sourceContours
        .peek()
        .find((contour) => contour.id === contourId)
        ?.contourCell.peek() ?? null
    );
  }

  point(pointId: PointId): Point | null {
    return this.#pointOwners.peek().get(pointId)?.point(pointId) ?? null;
  }

  anchor(anchorId: AnchorId): Anchor | null {
    return this.#anchors.get(anchorId);
  }

  segment(segmentId: SegmentId): Segment | null {
    const owner = this.#segmentOwners.peek().get(segmentId);
    if (!owner) return null;

    const segment = owner.segment(segmentId);
    if (!segment) return null;

    return segment;
  }

  hitPoint(pos: Point2D, radius: number): GeometryPointHit | null {
    let best: GeometryPointHit | null = null;
    for (const contour of this.#sourceContours.peek()) {
      for (const point of contour.pointsCell.peek()) {
        const hit = Point.hit(point, pos, radius);
        if (hit && (!best || hit.distance < best.distance)) {
          best = { kind: "point", id: point.id, distance: hit.distance };
        }
      }
    }
    return best;
  }

  hitAnchor(pos: Point2D, radius: number): GeometryAnchorHit | null {
    let best: GeometryAnchorHit | null = null;
    for (const anchor of this.#anchors.all) {
      const hit = anchor.hit(pos, radius);
      if (hit && (!best || hit.distance < best.distance)) {
        best = { kind: "anchor", id: anchor.id, distance: hit.distance };
      }
    }
    return best;
  }

  hitAt(pos: Point2D, radius: number): GlyphHit | null {
    return (
      this.hitAnchor(pos, radius) ?? this.hitPoint(pos, radius) ?? this.hitSegment(pos, radius)
    );
  }

  hitSegment(pos: Point2D, radius: number): GeometrySegmentHit | null {
    let best: GeometrySegmentHit | null = null;

    for (const contour of this.#sourceContours.peek()) {
      for (const segment of contour.segmentsCell.peek()) {
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
    }

    return best;
  }

  #contoursFromSource(
    structure: GlyphStructure,
    coordinates: LayerCoordinateBuffers,
  ): readonly ContourCache[] {
    return this.#contourCache.map(this.#currentContourInputs(structure, coordinates));
  }

  #currentContourInputs(
    structure: GlyphStructure,
    coordinates: LayerCoordinateBuffers,
  ): readonly ContourInput[] {
    const inputs: ContourInput[] = [];

    for (let index = 0; index < structure.contours.length; index++) {
      const data = structure.contours[index];
      const contourCoordinates = coordinates.contours[index];
      if (data && contourCoordinates) inputs.push({ data, coordinates: contourCoordinates });
    }

    return inputs;
  }

  #pointOwnersFromSource(contours: readonly ContourCache[]): ReadonlyMap<PointId, ContourCache> {
    const owners = new Map<PointId, ContourCache>();
    for (const contour of contours) {
      for (const pointId of contour.pointIds) {
        owners.set(pointId, contour);
      }
    }
    return owners;
  }

  #segmentOwnersFromSource(
    contours: readonly ContourCache[],
  ): ReadonlyMap<SegmentId, ContourCache> {
    const owners = new Map<SegmentId, ContourCache>();
    for (const contour of contours) {
      for (const segmentId of contour.segmentIds) {
        owners.set(segmentId, contour);
      }
    }
    return owners;
  }

  #anchorsFromSource(structure: GlyphStructure, values: Float64Array): readonly Anchor[] {
    return structure.anchors.map((anchor, index) => new Anchor(anchor, values, index * 2));
  }
}

interface ContourInput {
  readonly data: ContourData;
  readonly coordinates: LayerContourCoordinates;
}

class ContourCache {
  readonly #input: Signal<ContourInput>;

  readonly #pointIds: ComputedSignal<readonly PointId[]>;
  readonly #points: IdIndex<PointId, Point>;

  readonly #segments: IdIndex<SegmentId, Segment>;
  readonly #segmentIds: ComputedSignal<readonly SegmentId[]>;

  readonly contourCell: ComputedSignal<Contour>;
  readonly pointsCell: ComputedSignal<readonly Point[]>;
  readonly segmentsCell: ComputedSignal<readonly Segment[]>;

  constructor(input: Signal<ContourInput>) {
    this.#input = input;
    this.#pointIds = computed(() => this.#input.value.data.points.map((point) => point.id));
    this.contourCell = computed(() => {
      const { data, coordinates } = this.#input.value;
      return new Contour(data, coordinates.values.value, 0);
    });

    this.pointsCell = computed(() => {
      const { data, coordinates } = this.#input.value;
      const values = coordinates.values.value;

      return data.points.map(
        (point, index) =>
          new Point({
            ...point,
            x: values[index * 2] ?? 0,
            y: values[index * 2 + 1] ?? 0,
          }),
      );
    });

    this.segmentsCell = computed(() => {
      const { data, coordinates } = this.#input.value;
      return new Contour(data, coordinates.values.value, 0).segments();
    });
    this.#segmentIds = computed(() => this.segmentsCell.value.map((segment) => segment.id));

    this.#points = new IdIndex(
      () => this.pointsCell.peek(),
      (point) => point.id,
    );

    this.#segments = new IdIndex(
      () => this.segmentsCell.peek(),
      (segment) => segment.id,
    );
  }

  get pointIds(): readonly PointId[] {
    return this.#pointIds.peek();
  }

  get segmentIds(): readonly SegmentId[] {
    return this.#segmentIds.peek();
  }

  get id(): ContourId {
    return this.#input.peek().data.id;
  }

  point(pointId: PointId): Point | null {
    return this.#points.get(pointId);
  }

  segment(segmentId: SegmentId): Segment | null {
    return this.#segments.get(segmentId);
  }

  get contour(): Contour {
    return this.contourCell.peek();
  }
}

/**
 * Reactive model for one local glyph source.
 *
 * @remarks
 * Public callers should resolve glyph identity, authored layers, and rendered
 * instances through `Font.glyph`, `Font.layer`, and `Font.instance`.
 */
export class Glyph {
  readonly #font: Font;
  readonly #source: Source;
  readonly #fallbackHandle: GlyphHandle;

  readonly #layerState: GlyphLayerState;
  readonly #glyphId: GlyphId;

  readonly #geometry: ComputedSignal<GlyphGeometry>;

  readonly #xAdvance: ComputedSignal<number>;
  readonly #edit: GlyphEditSession;
  readonly #instances = new WeakMap<Signal<AxisLocation>, GlyphInstance>();

  constructor(
    font: Font,
    glyphId: GlyphId,
    handle: GlyphHandle,
    source: Source,
    state: GlyphLayerState,
  ) {
    this.#fallbackHandle = handle;
    this.#font = font;
    this.#source = source;
    this.#glyphId = glyphId;

    this.#layerState = state;
    this.#geometry = computed(() => this.#layerState.geometryCell.value);

    this.#xAdvance = computed(() => this.#layerState.coordinateBuffersCell.value.xAdvance.value);

    this.#edit = new GlyphEditSession(font, state.state.layerId, {
      state: this.#layerState,
      geometry: this.#geometry,
    });
  }

  get id(): GlyphId {
    return this.#glyphId;
  }

  get handle(): GlyphHandle {
    const record = this.#font.glyph(this.#glyphId);
    if (!record) return this.#fallbackHandle;

    const unicode = record.unicodes[0];
    return unicode === undefined ? { name: record.name } : { name: record.name, unicode };
  }

  get name(): GlyphName {
    return this.handle.name;
  }

  get unicode(): Unicode | null {
    return this.handle.unicode ?? null;
  }

  get xAdvance(): number {
    return this.#xAdvance.peek();
  }

  get contours(): readonly Contour[] {
    return this.#geometry.peek().contours;
  }

  get anchors(): readonly Anchor[] {
    return this.#geometry.peek().anchors;
  }

  /** @knipclassignore — public visible-geometry API. */
  get components(): readonly Component[] {
    return this.#geometry.peek().components;
  }

  get bounds(): BoundsType | null {
    return this.#geometry.peek().bounds;
  }

  /** @knipclassignore — public metrics API. */
  get sidebearings(): GlyphSidebearings {
    return this.#geometry.peek().sidebearings;
  }

  get allPoints(): Point[] {
    return this.#geometry.peek().allPoints;
  }

  /**
   * Returns the cached instance for a live designspace location.
   *
   * @param location - Signal whose value controls source resolution and interpolation.
   * @returns The cached instance object for this glyph/location signal pair.
   * @internal
   */
  cachedInstanceForFont(location: Signal<AxisLocation>): GlyphInstance | null {
    return this.#instances.get(location) ?? null;
  }

  /**
   * Stores a font-created instance for this glyph/location signal pair.
   *
   * @param input - Resolved reactive inputs assembled by the owning font.
   * @returns The created instance object.
   * @internal
   */
  createInstanceForFont(input: GlyphInstanceInput): GlyphInstance {
    const existing = this.#instances.get(input.location);
    if (existing) return existing;

    const instance = new GlyphInstance(input);
    this.#instances.set(input.location, instance);
    return instance;
  }

  /** @internal Primary authored source backing the cached glyph model. */
  get primarySourceForFont(): Source {
    return this.#source;
  }

  /** @internal Primary source geometry backing fallback and interpolation. */
  get primaryGeometryForFont(): GlyphGeometry {
    return this.#geometry.peek();
  }

  /** @internal Structure used by variation interpolation values. */
  get interpolationStructureForFont(): GlyphStructure {
    return this.#layerState.structure;
  }

  isPrimarySource(source: Source): boolean {
    return source.id === this.#source.id;
  }

  /** @internal GlyphLayer caching is owned by the id-keyed FontStore model cache. */
  createGlyphLayer(source: Source, state?: GlyphLayerState | null): GlyphLayer | null {
    if (!this.#font.source(source.id)) return null;
    if (this.isPrimarySource(source)) return new GlyphLayer(source, this.#edit);
    if (!state) return null;

    const geometry = computed(() => state.geometryCell.value);
    const edit = new GlyphEditSession(this.#font, state.state.layerId, {
      state,
      geometry,
    });

    return new GlyphLayer(source, edit);
  }

  point(pointId: PointId): Point | null {
    return this.#geometry.peek().point(pointId);
  }

  points(pointIds: readonly PointId[]): Point[] {
    return this.#geometry.peek().points(pointIds);
  }

  contour(contourId: ContourId): Contour | null {
    return this.#geometry.peek().contour(contourId);
  }

  *segments(): Generator<{ segment: Segment; contourId: ContourId }> {
    for (const contour of this.contours) {
      for (const segment of contour.segments()) {
        yield { segment, contourId: contour.id };
      }
    }
  }

  toState(): GlyphState {
    return this.#layerState.state;
  }
}
