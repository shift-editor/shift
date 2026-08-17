import type {
  AnchorId,
  Axis,
  AxisMappingBasis,
  ComponentGlyph as ComponentGlyphDefinition,
  ComponentId,
  ContourId,
  GlyphComponents,
  GlyphId,
  GlyphLayerShape,
  GlyphName,
  GlyphProjection,
  GlyphEntry,
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
import {
  batch,
  computed,
  keyedCache,
  signal,
  track,
  type ComputedSignal,
  type KeyedCache,
  type Signal,
  type WritableSignal,
} from "@/lib/signals";
import type { GlyphOptions } from "@/types/glyph";
import type { DesignAxisLocation, ExternalAxisLocation } from "@/types/variation";
import {
  designAxisLocationFromLocation,
  designAxisLocationsEqual,
  mapAxisLocation,
} from "@/lib/variation/location";
import {
  interpolateSourceValues,
  interpolationWeights,
} from "@/lib/interpolation/InterpolationBasis";
import { evaluateVariationBasis } from "@/lib/interpolation/VariationBasis";
import { Transform } from "@/lib/transform/Transform";
import { Alignment } from "@/lib/transform/Alignment";
import type { AlignmentType, DistributeType, ReflectAxis } from "@/types/transform";
import {
  Bounds,
  Mat,
  Vec2,
  type Bounds as BoundsType,
  type CubicCurve,
  type MatModel,
  type Point2D,
  type QuadraticCurve,
} from "@shift/geo";
import {
  Anchor,
  Component,
  Contour,
  GlyphGeometry,
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
import { ComponentGlyph, GlyphContour } from "./ComponentGlyph";
import {
  geometryRenderAnchors,
  geometryRenderContours,
  LayerRenderAnchor,
  LayerRenderContour,
  type RenderAnchor,
  type RenderContour,
} from "./GlyphRenderModel";
import { GlyphLayerPositionList } from "./GlyphLayerPositionList";
import { GlyphLayerPositionPatch } from "./GlyphLayerPositionPatch";
import { GlyphLayerEdit } from "./GlyphLayerEdit";
import { GlyphLayerState } from "./GlyphLayerState";
import type { ContourBuffer } from "./ContourBuffer";
import type { LayerBuffers } from "./LayerBuffers";
import { LayerIntents } from "@/lib/workspace/LayerIntents";
import type { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";
import { LayerPositions } from "./positions";

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
 * Geometry lookup surface for a Glyph render model.
 *
 * @remarks
 * Exact-source render models read sparse reactive layer buffers so lookup
 * and hit testing avoid rebuilding full `GlyphGeometry` snapshots during pointer
 * previews. Interpolated render models currently resolve through immutable
 * geometry snapshots; callers should treat that as an implementation detail.
 */
interface GlyphRenderGeometry {
  readonly xAdvance: number;
  readonly xAdvanceCell: Signal<number>;
  readonly allPoints: readonly Point[];

  point(pointId: PointId): Point | null;
  anchor(anchorId: AnchorId): Anchor | null;
  segment(segmentId: SegmentId): Segment | null;
  hitAt(pos: Point2D, radius: number): GlyphHit | null;
}

class GlyphEditSession {
  readonly #editCoordinator: WorkspaceEditCoordinator;
  readonly #intents: LayerIntents;
  readonly #state: GlyphEditState;

  constructor(editCoordinator: WorkspaceEditCoordinator, layerId: LayerId, state: GlyphEditState) {
    this.#editCoordinator = editCoordinator;
    this.#intents = new LayerIntents(editCoordinator, layerId);
    this.#state = state;
  }

  get geometry(): GlyphGeometry {
    return this.#state.geometry.peek();
  }

  get geometryCell(): Signal<GlyphGeometry> {
    return this.#state.geometry;
  }

  get layerState(): GlyphLayerState {
    return this.#state.state;
  }

  transaction<TResult>(label: string, body: () => TResult): TResult {
    return this.#editCoordinator.transaction(label, body);
  }

  setXAdvance(width: number): void {
    const editId = this.#intents.setXAdvance({ width });
    this.#state.state.setXAdvance(editId, width);
  }

  applyPositionPatch(updates: GlyphLayerPositions): void {
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
        const editId = this.#intents.movePoints({ pointIds, coords: pointCoords });
        this.#state.state.movePoints(editId, pointIds, pointCoords);
      }

      if (anchorIds.length > 0) {
        const editId = this.#intents.moveAnchors({ anchorIds, coords: anchorCoords });
        this.#state.state.moveAnchors(editId, anchorIds, anchorCoords);
      }
    };

    if (pointIds.length > 0 && anchorIds.length > 0) {
      this.transaction("Move positions", commit);
      return;
    }

    commit();
  }

  translateLayer(dx: number, dy: number): void {
    // Affine over every current point: O(ids) wire, Rust does the authoritative math.
    const pointIds = this.geometry.allPoints.map((point) => point.id);
    if (pointIds.length === 0) return;

    const editId = this.#intents.translatePoints({ pointIds, dx, dy });
    this.#state.state.translatePoints(editId, pointIds, dx, dy);
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

    const editId = this.#intents.addContour({ contourId, closed: false });
    this.#state.state.addContour(editId, contourId, false);

    return contourId;
  }

  addPoint(contourId: ContourId, edit: NewPoint): PointId {
    const [pointId] = this.addPoints(contourId, [edit]);
    if (!pointId) throw new Error("addPoint requires one point");

    return pointId;
  }

  addPoints(contourId: ContourId, edits: readonly NewPoint[]): PointId[] {
    if (edits.length === 0) return [];

    const points = edits.map((edit) => this.#seed(mintPointId(), edit));
    this.addPointSeeds(contourId, points);
    return points.map((point) => point.id);
  }

  addPointSeeds(contourId: ContourId, points: readonly PointSeed[]): void {
    if (points.length === 0) return;

    const editId = this.#intents.addPoints({ contourId, points: [...points] });
    this.#state.state.addPoints(editId, points, contourId);
  }

  insertPointBefore(beforePointId: PointId, edit: NewPoint): PointId {
    const pointId = mintPointId();

    // No contourId: Rust derives the contour from the anchor point — the
    // renderer never bookkeeps pending point→contour maps.
    const points = [this.#seed(pointId, edit)];
    const editId = this.#intents.addPoints({
      before: beforePointId,
      points,
    });
    this.#state.state.addPoints(editId, points, undefined, beforePointId);

    return pointId;
  }

  openContour(contourId: ContourId): void {
    const editId = this.#intents.setContourClosed({ contourId, closed: false });
    this.#state.state.setContourClosed(editId, contourId, false);
  }

  closeContour(contourId: ContourId): void {
    const editId = this.#intents.setContourClosed({ contourId, closed: true });
    this.#state.state.setContourClosed(editId, contourId, true);
  }

  reverseContour(contourId: ContourId): void {
    const editId = this.#intents.reverseContour({ contourId });
    this.#state.state.reverseContour(editId, contourId);
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

    const ids = [...pointIds];
    const editId = this.#intents.removePoints({ pointIds: ids });
    this.#state.state.removePoints(editId, ids);
  }

  addAnchor(name: string | null, position: Point2D): AnchorId {
    const anchorId = mintAnchorId();

    const anchors = [
      {
        id: anchorId,
        x: position.x,
        y: position.y,
        ...(name === null ? {} : { name }),
      },
    ];
    const editId = this.#intents.addAnchors({ anchors });
    this.#state.state.addAnchors(editId, anchors);

    return anchorId;
  }

  removeAnchors(anchorIds: readonly AnchorId[]): void {
    if (anchorIds.length === 0) return;

    const ids = [...anchorIds];
    const editId = this.#intents.removeAnchors({ anchorIds: ids });
    this.#state.state.removeAnchors(editId, ids);
  }

  setPointSmooth(pointId: PointId, smooth: boolean): void {
    const editId = this.#intents.setPointSmooth({ pointId, smooth });
    this.#state.state.setPointSmooth(editId, pointId, smooth);
  }

  toggleSmooth(pointId: PointId): void {
    const point = this.geometry.allPoints.find((candidate) => candidate.id === pointId);
    if (!point) {
      throw new Error(`cannot toggle smooth: point ${pointId} is not in the layer`);
    }

    this.setPointSmooth(pointId, !point.smooth);
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
 * exposes the reactive geometry for that source and queues mutations with the
 * source layer's stable ID. Preview methods update renderer state only; accepted
 * edits also produce workspace intents.
 */
export class GlyphLayer {
  readonly positions: LayerPositions;
  readonly #sourceCell: WritableSignal<Source>;
  readonly #edit: GlyphEditSession;

  constructor(source: Source, editCoordinator: WorkspaceEditCoordinator, state: GlyphLayerState) {
    this.#sourceCell = signal(source, { name: "glyphLayer.source" });
    this.#edit = new GlyphEditSession(editCoordinator, state.layerId, {
      state,
      geometry: state.geometryCell,
    });
    this.positions = new LayerPositions(this);
  }

  get source(): Source {
    return this.#sourceCell.peek();
  }

  replaceSource(source: Source): void {
    this.#sourceCell.set(source);
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

  /** @internal Reactive geometry used for component transform and attachment reads. */
  get geometryCell(): Signal<GlyphGeometry> {
    return this.#edit.geometryCell;
  }

  /** @internal Reactive glyph structure used by renderer-facing projections. */
  get structureCell(): Signal<GlyphStructure> {
    return this.#edit.layerState.structureCell;
  }

  /** @internal Reactive numeric buffers used by renderer-facing projections. */
  get buffers(): LayerBuffers {
    return this.#edit.layerState.buffers;
  }

  /** @internal Tracks replacement of the source layer-buffer container. */
  get buffersCell(): Signal<LayerBuffers> {
    return this.#edit.layerState.buffersCell;
  }

  /** @internal Tracks any numeric layer change without materializing full geometry. */
  get buffersChangedCell(): Signal<LayerBuffers> {
    return this.#edit.layerState.buffersChangedCell;
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
   * Translates every coordinate in this source layer.
   *
   * @param dx - Horizontal movement in UPM units.
   * @param dy - Vertical movement in UPM units.
   */
  translateLayer(dx: number, dy: number): void {
    this.#edit.translateLayer(dx, dy);
  }

  /** Begins a reversible edit that mutates this layer's reactive topology directly. */
  beginEdit(): GlyphLayerEdit {
    return new GlyphLayerEdit(this, this.#edit.layerState);
  }

  /** @internal Groups accepted edit operations into one workspace and undo transaction. */
  transaction<TResult>(label: string, body: () => TResult): TResult {
    return this.#edit.transaction(label, body);
  }

  /** @internal Adds prepared point identities through the accepted workspace path. */
  addPointSeeds(contourId: ContourId, points: readonly PointSeed[]): void {
    this.#edit.addPointSeeds(contourId, points);
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
   * Adds a complete cubic segment to an existing contour.
   *
   * The contour already owns `curve.p0`; both controls and the corner endpoint
   * are appended as one ordered topology update.
   *
   * @param contourId - Contour that receives the segment.
   * @param curve - Exact cubic geometry to append.
   * @returns ID of the new corner endpoint.
   */
  addCubic(contourId: ContourId, curve: CubicCurve): PointId {
    const pointIds = this.#edit.addPoints(contourId, [
      Point.offCurve(curve.c0),
      Point.offCurve(curve.c1),
      Point.onCurve(curve.p1),
    ]);
    const endpointId = pointIds[2];
    if (!endpointId) throw new Error("addCubic requires a complete cubic point sequence");

    return endpointId;
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
   * Sets smooth/corner state for an on-curve point.
   *
   * @param pointId - Point whose smooth flag changes.
   * @param smooth - Whether the point is smooth.
   */
  setPointSmooth(pointId: PointId, smooth: boolean): void {
    this.#edit.setPointSmooth(pointId, smooth);
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

const IDENTITY_GLYPH_TRANSFORM_CELL = signal<MatModel>(Mat.Identity());
const NO_ACTIVE_SOURCE_CELL = signal<SourceId | null>(null);

/**
 * Represents one glyph, including component occurrences, at a designspace location.
 *
 * @remarks
 * `contours` is the complete displayed stream used by rendering and bounds.
 * Point, segment, anchor lookup, and `allPoints` remain root-owned so inherited
 * component nodes cannot enter parent-glyph editing operations.
 */
export class GlyphRenderModel {
  readonly #glyphId: GlyphId;

  readonly #externalLocation: Signal<ExternalAxisLocation>;
  readonly #activeSourceId: Signal<SourceId | null>;

  readonly #projectionCell: Signal<GlyphProjection | null>;

  readonly #exactSourceId: (
    location: ExternalAxisLocation,
    sourceId: SourceId | null,
  ) => SourceId | null;
  readonly #layerAt: (
    glyphId: GlyphId,
    location: ExternalAxisLocation,
    sourceId: SourceId | null,
  ) => GlyphLayer | null;
  readonly #geometryAt: (
    glyphId: GlyphId,
    location: ExternalAxisLocation,
    sourceId: SourceId | null,
  ) => GlyphGeometry;

  readonly #geometry: GlyphRenderGeometry;

  readonly #componentCache: KeyedCache<ComponentGlyphDefinition, string, ComponentGlyph>;
  readonly #contoursByGlyph = new Map<GlyphId, Signal<readonly RenderContour[]>>();

  readonly #componentsCell: Signal<readonly ComponentGlyph[]>;
  readonly #contoursCell: Signal<readonly GlyphContour[]>;
  readonly #boundsCell: Signal<BoundsType | null>;
  readonly #drawPathCell: Signal<Path2D>;
  readonly #svgPathCell: Signal<string>;
  readonly #sidebearingsCell: Signal<GlyphSidebearings>;
  readonly #anchorsCell: Signal<readonly RenderAnchor[]>;

  /**
   * Creates a Glyph render model tied to a live external location and optional exact source.
   *
   * @param glyphId - Stable identity of the root glyph.
   * @param externalLocation - Live external location followed by the render model.
   * @param activeSourceId - Exact authored source override selected by the editor.
   * @param layer - Exact authored root layer at the current position, when one exists.
   * @param geometry - Resolved root geometry at the current position.
   * @param projectionCell - Rust-owned component relationships for the root glyph.
   * @param exactSourceId - Resolves an exact master identity at the current position.
   * @param layerAt - Resolves exact authored layers for root or component glyphs.
   * @param geometryAt - Resolves root or component geometry at the current position.
   */
  constructor(
    glyphId: GlyphId,
    externalLocation: Signal<ExternalAxisLocation>,
    activeSourceId: Signal<SourceId | null>,
    layer: Signal<GlyphLayer | null>,
    geometry: Signal<GlyphGeometry>,
    projectionCell: Signal<GlyphProjection | null>,
    exactSourceId: (location: ExternalAxisLocation, sourceId: SourceId | null) => SourceId | null,
    layerAt: (
      glyphId: GlyphId,
      location: ExternalAxisLocation,
      sourceId: SourceId | null,
    ) => GlyphLayer | null,
    geometryAt: (
      glyphId: GlyphId,
      location: ExternalAxisLocation,
      sourceId: SourceId | null,
    ) => GlyphGeometry,
  ) {
    this.#glyphId = glyphId;
    this.#externalLocation = externalLocation;
    this.#activeSourceId = activeSourceId;
    this.#projectionCell = projectionCell;
    this.#exactSourceId = exactSourceId;
    this.#layerAt = layerAt;
    this.#geometryAt = geometryAt;
    this.#geometry = new ViewGeometry(layer, geometry);
    this.#anchorsCell = new ViewAnchors(layer, geometry).anchorsCell;
    this.#componentCache = keyedCache<ComponentGlyphDefinition, string, ComponentGlyph>({
      name: "glyph.renderModel.components",
      key: (definition) => componentPathKey(definition.componentPath),
      create: (definitionCell) => new ComponentGlyph(definitionCell, this.#externalLocation, this),
    });
    this.#componentsCell = computed(() => {
      const components = this.#componentsAt(
        this.#externalLocation.value,
        this.#activeSourceId.value,
        this.#projectionCell.value,
      );
      return this.#componentCache.map(components.components);
    });
    const rootContoursCell = this.contoursAt(
      signal(this.#glyphId, { name: "glyph.renderModel.glyphId" }),
      IDENTITY_GLYPH_TRANSFORM_CELL,
      null,
    );
    this.#contoursCell = computed(() => [
      ...rootContoursCell.value,
      ...this.#componentsCell.value.flatMap((component) => component.contoursCell.value),
    ]);
    this.#boundsCell = computed(() => {
      const contours = this.#contoursCell.value;
      for (const contour of contours) contour.trackShape();

      return Bounds.unionAll(contours.map((contour) => contour.bounds));
    });
    this.#drawPathCell = computed(() => {
      const path = new Path2D();
      for (const contour of this.#contoursCell.value) {
        contour.trackShape();
        path.addPath(contour.path);
      }
      return path;
    });
    this.#svgPathCell = computed(() => {
      const contours = this.#contoursCell.value;
      for (const contour of contours) contour.trackShape();

      return contours.map((contour) => contour.svgPath).join(" ");
    });
    this.#sidebearingsCell = computed(() => {
      const bounds = this.#boundsCell.value;
      if (!bounds) return { lsb: null, rsb: null };

      return {
        lsb: bounds.min.x,
        rsb: this.#geometry.xAdvanceCell.value - bounds.max.x,
      };
    });
  }

  /** @internal Resolves numeric geometry for component occurrence arithmetic. */
  geometryAt(glyphId: GlyphId, location: ExternalAxisLocation): GlyphGeometry {
    track(this.#activeSourceId);
    const sourceId = this.#activeSourceId.peek();
    const layer = this.#layerAt(glyphId, location, sourceId);
    if (layer) {
      track(layer.geometryCell);
      return layer.geometryCell.peek();
    }

    return this.#geometryAt(glyphId, location, sourceId);
  }

  /** @internal Builds contour occurrences owned directly by one glyph occurrence. */
  contoursAt(
    glyphIdCell: Signal<GlyphId>,
    matrixCell: Signal<MatModel>,
    component: ComponentGlyph | null,
  ): Signal<readonly GlyphContour[]> {
    const contourCache = keyedCache<RenderContour, string, GlyphContour>({
      name: "glyph.renderModel.contours",
      key: (contour) => contour.id,
      create: (contourCell) => new GlyphContour(contourCell, matrixCell, component),
    });

    return computed(() => contourCache.map(this.#contoursForGlyph(glyphIdCell.value).value));
  }

  /** Shares one evaluated source-contour stream across every occurrence of a glyph. */
  #contoursForGlyph(glyphId: GlyphId): Signal<readonly RenderContour[]> {
    const existing = this.#contoursByGlyph.get(glyphId);
    if (existing) return existing;

    const layerContourCache = keyedCache<ContourBuffer, string, LayerRenderContour>({
      name: `glyph.renderModel.sourceContours.${glyphId}`,
      key: (contour) => contour.data.id,
      create: (contourCell) => new LayerRenderContour(contourCell),
    });
    const contoursCell = computed(() => {
      const location = this.#externalLocation.value;
      const sourceId = this.#activeSourceId.value;
      const source = this.#layerAt(glyphId, location, sourceId);
      if (!source) {
        layerContourCache.clear();
        return geometryRenderContours(this.#geometryAt(glyphId, location, sourceId));
      }

      return layerContourCache.map(source.buffersCell.value.contoursCell.value);
    });
    this.#contoursByGlyph.set(glyphId, contoursCell);
    return contoursCell;
  }

  /** @internal Returns one component occurrence by its stable ancestry. */
  componentAt(path: readonly ComponentId[]): ComponentGlyph | null {
    const key = componentPathKey(path);
    return (
      this.#componentsCell
        .peek()
        .find((component) => componentPathKey(component.componentPath) === key) ?? null
    );
  }

  /** @internal Returns direct children of one component ancestry or the root. */
  childrenOf(
    path: readonly ComponentId[],
    components: readonly ComponentGlyph[],
  ): readonly ComponentGlyph[] {
    const parentKey = componentPathKey(path);
    return components.filter((component) => componentPathKey(component.parentPath) === parentKey);
  }

  #componentsAt(
    location: ExternalAxisLocation,
    sourceId: SourceId | null,
    projection: GlyphProjection | null,
  ): GlyphComponents {
    if (!projection) return { rootGlyphId: this.#glyphId, components: [] };

    const exactSourceId = this.#exactSourceId(location, sourceId);
    const exact = projection.exactSourceComponents.find(
      (source) => source.sourceId === exactSourceId,
    );
    return exact?.components ?? projection.components;
  }

  get location(): ExternalAxisLocation {
    return this.#externalLocation.peek();
  }

  get contours(): readonly GlyphContour[] {
    return this.#contoursCell.peek();
  }

  get contoursCell(): Signal<readonly GlyphContour[]> {
    return this.#contoursCell;
  }

  get components(): readonly ComponentGlyph[] {
    return this.#componentsCell.peek();
  }

  get componentsCell(): Signal<readonly ComponentGlyph[]> {
    return this.#componentsCell;
  }

  /** Returns direct root anchors; component anchors remain placement inputs. */
  get anchors(): readonly RenderAnchor[] {
    return this.#anchorsCell.peek();
  }

  /** Reactive direct root anchors for editor affordances. */
  get anchorsCell(): Signal<readonly RenderAnchor[]> {
    return this.#anchorsCell;
  }

  get bounds(): BoundsType | null {
    return this.#boundsCell.peek();
  }

  get boundsCell(): Signal<BoundsType | null> {
    return this.#boundsCell;
  }

  get drawPath(): Path2D {
    return this.#drawPathCell.peek();
  }

  get svgPath(): string {
    return this.#svgPathCell.peek();
  }

  get svgPathCell(): Signal<string> {
    return this.#svgPathCell;
  }

  get isEmpty(): boolean {
    return this.#contoursCell.peek().length === 0;
  }

  get allPoints(): readonly Point[] {
    return this.#geometry.allPoints;
  }

  point(pointId: PointId): Point | null {
    return this.#geometry.point(pointId);
  }

  anchor(anchorId: AnchorId): Anchor | null {
    return this.#geometry.anchor(anchorId);
  }

  get xAdvance(): number {
    return this.#geometry.xAdvance;
  }

  get xAdvanceCell(): Signal<number> {
    return this.#geometry.xAdvanceCell;
  }

  get sidebearings(): GlyphSidebearings {
    return this.#sidebearingsCell.peek();
  }

  get sidebearingsCell(): Signal<GlyphSidebearings> {
    return this.#sidebearingsCell;
  }

  segment(segmentId: SegmentId): Segment | null {
    return this.#geometry.segment(segmentId);
  }

  hitAt(pos: Point2D, radius: number): GlyphHit | null {
    return this.#geometry.hitAt(pos, radius);
  }

  trackShape(): void {
    track(this.#contoursCell);
    for (const contour of this.#contoursCell.peek()) contour.trackShape();
  }

  /** Subscribes the current reactive consumer to direct root-anchor changes. */
  trackAnchors(): void {
    track(this.#anchorsCell);
    for (const anchor of this.#anchorsCell.peek()) anchor.trackShape();
  }
}

function componentPathKey(path: readonly ComponentId[]): string {
  return path.join("/");
}

class ViewAnchors {
  readonly #anchors = keyedCache({
    name: "glyph.renderModel.anchors",
    key: (anchor: Anchor) => anchor.id,
    create: (anchor) => new LayerRenderAnchor(anchor),
  });

  readonly anchorsCell: Signal<readonly RenderAnchor[]>;

  constructor(layer: Signal<GlyphLayer | null>, geometry: Signal<GlyphGeometry>) {
    this.anchorsCell = computed<readonly RenderAnchor[]>(() => {
      const source = layer.value;
      if (source) return this.#anchors.map(source.buffersCell.value.anchors.anchorsCell.value);

      return geometryRenderAnchors(geometry.value);
    });
  }
}

class ViewGeometry implements GlyphRenderGeometry {
  readonly #resolved: ComputedSignal<GlyphRenderGeometry>;
  readonly #xAdvance: ComputedSignal<number>;

  constructor(layer: Signal<GlyphLayer | null>, geometry: Signal<GlyphGeometry>) {
    this.#resolved = computed(
      () => {
        const source = layer.value;
        if (source) return new SourceGeometryCache(source);

        return new SnapshotGeometryCache(geometry.value);
      },
      { name: "glyph.renderModel.resolvedGeometry" },
    );
    this.#xAdvance = computed(() => this.#resolved.value.xAdvanceCell.value, {
      name: "glyph.renderModel.geometry.xAdvance",
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

  point(pointId: PointId): Point | null {
    return this.#resolved.peek().point(pointId);
  }

  anchor(anchorId: AnchorId): Anchor | null {
    return this.#resolved.peek().anchor(anchorId);
  }

  segment(segmentId: SegmentId): Segment | null {
    return this.#resolved.peek().segment(segmentId);
  }

  hitAt(pos: Point2D, radius: number): GlyphHit | null {
    return this.#resolved.peek().hitAt(pos, radius);
  }
}

class SnapshotGeometryCache implements GlyphRenderGeometry {
  readonly #geometry: GlyphGeometry;
  readonly #xAdvance: Signal<number>;

  constructor(geometry: GlyphGeometry) {
    this.#geometry = geometry;
    this.#xAdvance = computed(() => geometry.xAdvance, {
      name: "glyph.renderModel.snapshotGeometry.xAdvance",
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

  point(pointId: PointId): Point | null {
    return this.#geometry.point(pointId);
  }

  anchor(anchorId: AnchorId): Anchor | null {
    return this.#geometry.anchor(anchorId);
  }

  segment(segmentId: SegmentId): Segment | null {
    return this.#geometry.segment(segmentId);
  }

  hitAt(pos: Point2D, radius: number): GlyphHit | null {
    return this.#geometry.hitAt(pos, radius);
  }
}

class SourceGeometryCache implements GlyphRenderGeometry {
  readonly #source: GlyphLayer;
  readonly #sourceContours: ComputedSignal<readonly ContourBuffer[]>;
  readonly #points: ComputedSignal<readonly Point[]>;
  readonly #pointOwners: ComputedSignal<ReadonlyMap<PointId, ContourBuffer>>;
  readonly #anchors: IdIndex<AnchorId, Anchor>;
  readonly #segmentOwners: ComputedSignal<ReadonlyMap<SegmentId, ContourBuffer>>;

  constructor(source: GlyphLayer) {
    this.#source = source;
    this.#sourceContours = computed(() => source.buffersCell.value.contoursCell.value);
    this.#points = computed(() =>
      this.#sourceContours.value.flatMap((contour) => contour.pointsCell.value),
    );
    this.#pointOwners = computed(() => {
      const owners = new Map<PointId, ContourBuffer>();
      for (const contour of this.#sourceContours.value) {
        for (const point of contour.dataCell.value.points) owners.set(point.id, contour);
      }
      return owners;
    });

    const anchors = computed(() => source.buffersCell.value.anchors.anchorsCell.value);
    this.#anchors = new IdIndex(
      () => anchors.peek(),
      (anchor) => anchor.id,
    );
    this.#segmentOwners = computed(() => {
      const owners = new Map<SegmentId, ContourBuffer>();
      for (const contour of this.#sourceContours.value) {
        for (const segment of contour.segmentsCell.value) owners.set(segment.id, contour);
      }
      return owners;
    });
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

  point(pointId: PointId): Point | null {
    return this.#pointOwners.peek().get(pointId)?.point(pointId) ?? null;
  }

  anchor(anchorId: AnchorId): Anchor | null {
    return this.#anchors.get(anchorId);
  }

  segment(segmentId: SegmentId): Segment | null {
    return this.#segmentOwners.peek().get(segmentId)?.segment(segmentId) ?? null;
  }

  hitPoint(pos: Point2D, radius: number): GeometryPointHit | null {
    let best: GeometryPointHit | null = null;
    for (const point of this.#points.peek()) {
      const hit = Point.hit(point, pos, radius);
      if (hit && (!best || hit.distance < best.distance)) {
        best = { kind: "point", id: point.id, distance: hit.distance };
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
}

/**
 * Complete synchronously usable model for one loaded glyph.
 *
 * @remarks
 * Font assembles every authored layer and component dependency before making
 * this object available. Collection replacements preserve Glyph identity while
 * layer geometry continues to update through each GlyphLayerState signal graph.
 */
export class Glyph {
  readonly #entryCell: WritableSignal<GlyphEntry>;
  readonly #layersCell: WritableSignal<readonly GlyphLayer[]>;
  readonly #axesCell: Signal<Axis[]>;
  readonly #axisMappingBasesCell: Signal<AxisMappingBasis[]>;
  readonly #sourcesCell: Signal<Source[]>;
  readonly #projectionCell: Signal<GlyphProjection | null>;
  readonly #defaultSourceId: SourceId;
  readonly #layersBySourceId = new Map<SourceId, GlyphLayer>();
  readonly #layersById = new Map<LayerId, GlyphLayer>();
  readonly #componentGlyphsById = new Map<GlyphId, Glyph>();
  readonly #renderModels = new WeakMap<
    Signal<ExternalAxisLocation>,
    WeakMap<Signal<SourceId | null>, GlyphRenderModel>
  >();

  constructor(options: GlyphOptions) {
    this.#entryCell = signal(options.entry, { name: "glyph.entry" });
    this.#layersCell = signal(options.layers, { name: "glyph.layers" });
    this.#axesCell = options.axesCell;
    this.#axisMappingBasesCell = options.axisMappingBasesCell;
    this.#sourcesCell = options.sourcesCell;
    this.#projectionCell = options.projectionCell;
    this.#defaultSourceId = options.defaultSourceId;
    this.replaceLayers(options.layers);
    this.replaceComponentGlyphs(options.componentGlyphs);
  }

  get id(): GlyphId {
    return this.#entryCell.peek().id;
  }

  get entry(): GlyphEntry {
    return this.#entryCell.peek();
  }

  get handle(): GlyphHandle {
    const entry = this.#entryCell.peek();
    const unicode = entry.unicodes[0];
    return unicode === undefined ? { name: entry.name } : { name: entry.name, unicode };
  }

  get name(): GlyphName {
    return this.#entryCell.peek().name;
  }

  get unicode(): Unicode | null {
    return this.#entryCell.peek().unicodes[0] ?? null;
  }

  get layers(): readonly GlyphLayer[] {
    return this.#layersCell.peek();
  }

  layerForSource(sourceId: SourceId): GlyphLayer | null {
    track(this.#layersCell);

    return this.#layersBySourceId.get(sourceId) ?? null;
  }

  layerForId(layerId: LayerId): GlyphLayer | null {
    return this.#layersById.get(layerId) ?? null;
  }

  layerAt(location: ExternalAxisLocation): GlyphLayer | null {
    track(this.#layersCell);
    track(this.#axesCell);
    track(this.#axisMappingBasesCell);

    const axes = this.#axesCell.peek();
    const mappedLocation = mapAxisLocation(location, axes, this.#axisMappingBasesCell.peek());
    for (const layer of this.#layersCell.peek()) {
      if (
        designAxisLocationsEqual(
          designAxisLocationFromLocation(layer.source.location),
          mappedLocation,
          axes,
        )
      ) {
        return layer;
      }
    }

    return null;
  }

  geometryAt(externalLocation: ExternalAxisLocation): GlyphGeometry {
    track(this.#layersCell);
    track(this.#axesCell);
    track(this.#axisMappingBasesCell);
    track(this.#sourcesCell);
    track(this.#projectionCell);

    const layer = this.layerAt(externalLocation);
    if (layer) {
      track(layer.geometryCell);
      return layer.geometry;
    }

    const axes = this.#axesCell.peek();
    const designLocation = mapAxisLocation(
      externalLocation,
      axes,
      this.#axisMappingBasesCell.peek(),
    );
    const exactSource = this.#sourcesCell
      .peek()
      .find((source) =>
        designAxisLocationsEqual(
          designAxisLocationFromLocation(source.location),
          designLocation,
          axes,
        ),
      );
    return this.#geometryAtDesignLocation(designLocation, exactSource?.id ?? null);
  }

  geometryForSource(sourceId: SourceId): GlyphGeometry {
    track(this.#layersCell);
    track(this.#axesCell);
    track(this.#sourcesCell);
    track(this.#projectionCell);

    const layer = this.layerForSource(sourceId);
    if (layer) {
      track(layer.geometryCell);
      return layer.geometry;
    }

    const source = this.#sourcesCell.peek().find((candidate) => candidate.id === sourceId);
    if (!source) {
      return (
        this.primaryGeometryForFont ??
        new GlyphGeometry({ contours: [], anchors: [], components: [] }, new Float64Array([0]))
      );
    }

    return this.#geometryAtDesignLocation(
      designAxisLocationFromLocation(source.location),
      sourceId,
    );
  }

  #geometryAtDesignLocation(
    designLocation: DesignAxisLocation,
    exactSourceId: SourceId | null,
  ): GlyphGeometry {
    const projection = this.#projectionCell.peek();
    if (!projection) {
      return (
        this.primaryGeometryForFont ??
        new GlyphGeometry({ contours: [], anchors: [], components: [] }, new Float64Array([0]))
      );
    }

    if (exactSourceId === this.#defaultSourceId) {
      return projectionGeometry(projection.fallback);
    }

    const exactShape = projection.exactSourceShapes.find(
      (sourceShape) => sourceShape.sourceId === exactSourceId,
    );
    if (exactShape) return projectionGeometry(exactShape.shape);

    const axes = this.#axesCell.peek();
    const interpolation = projection.interpolation;
    if (interpolation) {
      const weights = interpolationWeights(interpolation.basis, designLocation, axes);
      const values = interpolateSourceValues(interpolation.basis, weights, (sourceId) => {
        const sourceLayer = this.#layersBySourceId.get(sourceId);
        if (sourceLayer) {
          track(sourceLayer.geometryCell);
          return sourceLayer.state.values;
        }

        return interpolation.sources.find((source) => source.sourceId === sourceId)?.values ?? null;
      });
      if (!values) return projectionGeometry(projection.fallback);

      return new GlyphGeometry(
        projection.fallback.structure,
        values,
        projection.fallback.componentTransformKind,
      );
    }

    const variation = projection.variation;
    if (!variation) return projectionGeometry(projection.fallback);

    const adjustments = evaluateVariationBasis(variation.basis, designLocation, axes);
    const values = new Float64Array(projection.fallback.values);
    for (let index = 0; index < values.length; index++) {
      values[index] += adjustments[index] ?? 0;
    }

    return new GlyphGeometry(
      projection.fallback.structure,
      values,
      projection.fallback.componentTransformKind,
    );
  }

  /** @internal Returns the position-bound render model for editor infrastructure. */
  renderModelAt(
    externalLocationCell: Signal<ExternalAxisLocation>,
    activeSourceIdCell: Signal<SourceId | null> = NO_ACTIVE_SOURCE_CELL,
  ): GlyphRenderModel {
    let renderModels = this.#renderModels.get(externalLocationCell);
    if (!renderModels) {
      renderModels = new WeakMap();
      this.#renderModels.set(externalLocationCell, renderModels);
    }
    const existing = renderModels.get(activeSourceIdCell);
    if (existing) return existing;

    const layerCell = computed(
      () => {
        const sourceId = activeSourceIdCell.value;
        return sourceId ? this.layerForSource(sourceId) : this.layerAt(externalLocationCell.value);
      },
      { name: "glyph.renderModel.layer" },
    );
    const geometryCell = computed(
      () => {
        const sourceId = activeSourceIdCell.value;
        return sourceId
          ? this.geometryForSource(sourceId)
          : this.geometryAt(externalLocationCell.value);
      },
      { name: "glyph.renderModel.geometry" },
    );
    const renderModel = new GlyphRenderModel(
      this.id,
      externalLocationCell,
      activeSourceIdCell,
      layerCell,
      geometryCell,
      this.#projectionCell,
      (location, sourceId) => {
        if (sourceId) return sourceId;

        track(this.#sourcesCell);
        track(this.#axesCell);
        track(this.#axisMappingBasesCell);
        const axes = this.#axesCell.peek();
        const designLocation = mapAxisLocation(location, axes, this.#axisMappingBasesCell.peek());
        const source = this.#sourcesCell
          .peek()
          .find((candidate) =>
            designAxisLocationsEqual(
              designAxisLocationFromLocation(candidate.location),
              designLocation,
              axes,
            ),
          );
        return source?.id ?? null;
      },
      (glyphId, location, sourceId) => {
        const glyph = glyphId === this.id ? this : this.#componentGlyphsById.get(glyphId);
        return sourceId
          ? (glyph?.layerForSource(sourceId) ?? null)
          : (glyph?.layerAt(location) ?? null);
      },
      (glyphId, location, sourceId) => {
        const glyph = glyphId === this.id ? this : this.#componentGlyphsById.get(glyphId);
        return (
          (sourceId ? glyph?.geometryForSource(sourceId) : glyph?.geometryAt(location)) ??
          new GlyphGeometry({ contours: [], anchors: [], components: [] }, new Float64Array([0]))
        );
      },
    );
    renderModels.set(activeSourceIdCell, renderModel);
    return renderModel;
  }

  replaceEntry(entry: GlyphEntry): void {
    this.#entryCell.set(entry);
  }

  replaceLayers(layers: readonly GlyphLayer[]): void {
    batch(() => {
      this.#layersBySourceId.clear();
      this.#layersById.clear();

      for (const layer of layers) {
        this.#layersBySourceId.set(layer.sourceId, layer);
        this.#layersById.set(layer.id, layer);
      }

      this.#layersCell.set(layers);
    });
  }

  replaceComponentGlyphs(componentGlyphs: ReadonlyMap<GlyphId, Glyph>): void {
    this.#componentGlyphsById.clear();
    for (const [glyphId, glyph] of componentGlyphs) {
      this.#componentGlyphsById.set(glyphId, glyph);
    }
  }

  get xAdvance(): number {
    return this.primaryGeometryForFont?.xAdvance ?? 0;
  }

  get contours(): readonly Contour[] {
    return this.primaryGeometryForFont?.contours ?? [];
  }

  get anchors(): readonly Anchor[] {
    return this.primaryGeometryForFont?.anchors ?? [];
  }

  /** @knipclassignore — public visible-geometry API. */
  get components(): readonly Component[] {
    return this.primaryGeometryForFont?.components ?? [];
  }

  get bounds(): BoundsType | null {
    return this.primaryGeometryForFont?.bounds ?? null;
  }

  /** @knipclassignore — public metrics API. */
  get sidebearings(): GlyphSidebearings {
    return this.primaryGeometryForFont?.sidebearings ?? { lsb: 0, rsb: 0 };
  }

  get allPoints(): Point[] {
    return this.primaryGeometryForFont?.allPoints ?? [];
  }

  /** @internal Primary source geometry backing fallback and interpolation. */
  get primaryGeometryForFont(): GlyphGeometry | null {
    return (
      this.#layersBySourceId.get(this.#defaultSourceId)?.geometry ??
      this.#layersCell.peek()[0]?.geometry ??
      null
    );
  }

  point(pointId: PointId): Point | null {
    return this.primaryGeometryForFont?.point(pointId) ?? null;
  }

  points(pointIds: readonly PointId[]): Point[] {
    return this.primaryGeometryForFont?.points(pointIds) ?? [];
  }

  contour(contourId: ContourId): Contour | null {
    return this.primaryGeometryForFont?.contour(contourId) ?? null;
  }

  *segments(): Generator<{ segment: Segment; contourId: ContourId }> {
    for (const contour of this.contours) {
      for (const segment of contour.segments()) {
        yield { segment, contourId: contour.id };
      }
    }
  }

  toState(): GlyphState {
    const layer = this.#layersCell.peek()[0];
    if (!layer) throw new Error(`glyph ${this.id} has no authored layers`);

    return layer.state;
  }
}

function projectionGeometry(shape: GlyphLayerShape): GlyphGeometry {
  return new GlyphGeometry(shape.structure, shape.values, shape.componentTransformKind);
}
