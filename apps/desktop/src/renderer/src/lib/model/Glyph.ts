import type {
  AnchorId,
  ContourId,
  GlyphName,
  GlyphState,
  GlyphStructure,
  GlyphStructureChange,
  GlyphValueChange,
  GlyphVariationData,
  PointId,
  PointType,
  Source,
  Unicode,
} from "@shift/types";
import type { GlyphHandle } from "@shift/bridge";
import {
  batch,
  computed,
  signal,
  type ComputedSignal,
  type Signal,
  type WritableSignal,
} from "@/lib/signals/signal";
import { interpolate, normalize } from "@/lib/interpolation/interpolate";
import { axisLocationFromLocation, axisLocationsEqual } from "@/lib/variation/location";
import type { AxisLocation } from "@/types/variation";
import { Transform } from "@/lib/transform/Transform";
import { Alignment } from "@/lib/transform/Alignment";
import type { AlignmentType, DistributeType, ReflectAxis } from "@/types/transform";
import { Bounds, Vec2, type Bounds as BoundsType, type Point2D } from "@shift/geo";
import {
  Anchor,
  Component,
  Contour,
  GlyphStateGeometry as GlyphGeometry,
  Segment,
  type GlyphPosition as SourcePosition,
  type GlyphPositions as SourcePositions,
  type GlyphPositionTarget as SourcePositionTarget,
  type GlyphSidebearings,
  type Point,
} from "@shift/glyph-state";
import { GlyphOutline } from "./GlyphOutline";
import { SourcePositionList } from "./SourcePositionList";
import type { Font } from "./Font";

export interface PointEdit {
  readonly x: number;
  readonly y: number;
  readonly pointType: PointType;
  readonly smooth: boolean;
}

export {
  GlyphGeometry,
  type GlyphSidebearings,
  type SourcePosition,
  type SourcePositions,
  type SourcePositionTarget,
};

interface GlyphEditState {
  readonly structure: WritableSignal<GlyphStructure>;
  readonly values: WritableSignal<Float64Array>;
  readonly geometry: Signal<GlyphGeometry>;
}

class GlyphEditSession {
  readonly #font: Font;
  readonly #handle: GlyphHandle;
  readonly #source: Source;
  readonly #state: GlyphEditState;

  constructor(font: Font, handle: GlyphHandle, source: Source, state: GlyphEditState) {
    this.#font = font;
    this.#handle = handle;
    this.#source = source;
    this.#state = state;
  }

  get geometry(): GlyphGeometry {
    return this.#state.geometry.value;
  }

  setXAdvance(width: number): void {
    this.#ensureActiveSession();
    this.#applyValueChange(this.#font.bridge.setXAdvance(width));
  }

  setPositions(updates: SourcePositions): void {
    if (updates.length === 0) return;
    this.#ensureActiveSession();
    this.#applyValueChange(
      this.#font.bridge.setPositions(...GlyphGeometry.packPositionUpdates(updates)),
    );
  }

  translateLayer(dx: number, dy: number): void {
    this.#ensureActiveSession();
    this.#applyValueChange(this.#font.bridge.translateLayer(dx, dy));
  }

  previewPositions(updates: SourcePositions): void {
    if (updates.length === 0) return;
    const nextGeometry = this.#state.geometry.peek().withPositionUpdates(updates);
    this.#state.values.set(nextGeometry.values);
  }

  addContour(): ContourId {
    this.#ensureActiveSession();
    const change = this.#font.bridge.addContour();
    this.#applyStructureChange(change);
    const contourId = change.changed.contourIds[0];
    if (!contourId) throw new Error("Bridge did not return a created contour ID");
    return contourId;
  }

  addPoint(contourId: ContourId, edit: PointEdit): PointId {
    this.#ensureActiveSession();
    const change = this.#font.bridge.addPoint(
      contourId,
      edit.x,
      edit.y,
      edit.pointType,
      edit.smooth,
    );
    this.#applyStructureChange(change);
    const pointId = change.changed.pointIds[0];
    if (!pointId) throw new Error("Bridge did not return a created point ID");
    return pointId;
  }

  insertPointBefore(beforePointId: PointId, edit: PointEdit): PointId {
    this.#ensureActiveSession();
    const change = this.#font.bridge.insertPointBefore(
      beforePointId,
      edit.x,
      edit.y,
      edit.pointType,
      edit.smooth,
    );
    this.#applyStructureChange(change);
    const pointId = change.changed.pointIds[0];
    if (!pointId) throw new Error("Bridge did not return a created point ID");
    return pointId;
  }

  openContour(contourId: ContourId): void {
    this.#ensureActiveSession();
    this.#applyStructureChange(this.#font.bridge.openContour(contourId));
  }

  closeContour(contourId: ContourId): void {
    this.#ensureActiveSession();
    this.#applyStructureChange(this.#font.bridge.closeContour(contourId));
  }

  reverseContour(contourId: ContourId): void {
    this.#ensureActiveSession();
    this.#applyStructureChange(this.#font.bridge.reverseContour(contourId));
  }

  applyBooleanOp(
    contourIdA: ContourId,
    contourIdB: ContourId,
    operation: "union" | "subtract" | "intersect" | "difference",
  ): void {
    this.#ensureActiveSession();
    this.#applyStructureChange(this.#font.bridge.applyBooleanOp(contourIdA, contourIdB, operation));
  }

  removePoints(pointIds: readonly PointId[]): void {
    if (pointIds.length === 0) return;
    this.#ensureActiveSession();
    this.#applyStructureChange(this.#font.bridge.removePoints([...pointIds]));
  }

  toggleSmooth(pointId: PointId): void {
    this.#ensureActiveSession();
    this.#applyStructureChange(this.#font.bridge.toggleSmooth(pointId));
  }

  restore(state: GlyphState): void {
    this.#ensureActiveSession();
    this.#applyStructureChange(this.#font.bridge.restoreState(state.structure, state.values));
  }

  #ensureActiveSession(): void {
    const bridge = this.#font.bridge;
    if (
      bridge.getEditingGlyphName() === this.#handle.name &&
      bridge.getEditingSourceId() === this.#source.id
    ) {
      return;
    }

    if (bridge.hasEditSession()) {
      bridge.endEditSession();
    }

    bridge.startEditSession(this.#handle, this.#source.id);
  }

  #applyStructureChange(change: GlyphStructureChange): void {
    batch(() => {
      this.#state.structure.set(change.structure);
      this.#state.values.set(change.values);
    });
  }

  #applyValueChange(change: GlyphValueChange): void {
    this.#state.values.set(change.values);
  }
}

export class GlyphSource {
  readonly source: Source;
  readonly #edit: GlyphEditSession;

  constructor(source: Source, edit: GlyphEditSession) {
    this.source = source;
    this.#edit = edit;
  }

  /** @knipclassignore — convenience alias for source identity. */
  get id() {
    return this.source.id;
  }

  /** @knipclassignore — convenience alias for source identity. */
  get sourceId() {
    return this.source.id;
  }

  get geometry(): GlyphGeometry {
    return this.#edit.geometry;
  }

  get state(): GlyphState {
    return {
      structure: this.geometry.structure,
      values: new Float64Array(this.geometry.values),
    };
  }

  get xAdvance(): number {
    return this.geometry.xAdvance;
  }

  get contours(): readonly Contour[] {
    return this.geometry.contours;
  }

  get anchors(): readonly Anchor[] {
    return this.geometry.anchors;
  }

  /** @knipclassignore — public authored-source geometry API. */
  get components(): readonly Component[] {
    return this.geometry.components;
  }

  get bounds(): BoundsType | null {
    return this.geometry.bounds;
  }

  /** @knipclassignore — public authored-source metrics API. */
  get sidebearings(): GlyphSidebearings {
    return this.geometry.sidebearings;
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

  positionsFor(targets: readonly SourcePositionTarget[]): SourcePosition[] {
    return [...SourcePositionList.fromTargets(this.geometry, targets).positions];
  }

  setXAdvance(width: number): void {
    this.#edit.setXAdvance(width);
  }

  setPositions(updates: SourcePositions): void {
    this.#edit.setPositions(updates);
  }

  translateLayer(dx: number, dy: number): void {
    this.#edit.translateLayer(dx, dy);
  }

  previewPositions(updates: SourcePositions): void {
    this.#edit.previewPositions(updates);
  }

  addContour(): ContourId {
    return this.#edit.addContour();
  }

  addPoint(contourId: ContourId, edit: PointEdit): PointId {
    return this.#edit.addPoint(contourId, edit);
  }

  insertPointBefore(pointId: PointId, edit: PointEdit): PointId {
    return this.#edit.insertPointBefore(pointId, edit);
  }

  openContour(contourId: ContourId): void {
    this.#edit.openContour(contourId);
  }

  closeContour(contourId: ContourId): void {
    this.#edit.closeContour(contourId);
  }

  reverseContour(contourId: ContourId): void {
    this.#edit.reverseContour(contourId);
  }

  applyBooleanOp(
    contourIdA: ContourId,
    contourIdB: ContourId,
    operation: "union" | "subtract" | "intersect" | "difference",
  ): void {
    this.#edit.applyBooleanOp(contourIdA, contourIdB, operation);
  }

  removePoints(pointIds: readonly PointId[]): void {
    this.#edit.removePoints(pointIds);
  }

  toggleSmooth(pointId: PointId): void {
    this.#edit.toggleSmooth(pointId);
  }

  movePointTo(pointId: PointId, position: Point2D): void {
    this.setPositions([{ kind: "point", id: pointId, x: position.x, y: position.y }]);
  }

  movePoints(pointIds: readonly PointId[], delta: Point2D): void {
    const positions = this.positionsFor(pointIds.map((id) => ({ kind: "point", id })));
    const nextPositions = positions.map((position) => {
      const next = Vec2.add(position, delta);
      return { ...position, x: next.x, y: next.y };
    });

    this.setPositions(nextPositions);
  }

  translate(pointIds: readonly PointId[], delta: Point2D): void {
    this.movePoints(pointIds, delta);
  }

  moveSelectionTo(pointIds: readonly PointId[], target: Point2D, anchor: Point2D): void {
    this.movePoints(pointIds, Vec2.sub(target, anchor));
  }

  rotate(pointIds: readonly PointId[], angle: number, origin: Point2D): void {
    this.setPositions(
      Transform.rotatePoints(
        this.positionsFor(pointIds.map((id) => ({ kind: "point", id }))),
        angle,
        origin,
      ),
    );
  }

  scale(pointIds: readonly PointId[], sx: number, sy: number, origin: Point2D): void {
    this.setPositions(
      Transform.scalePoints(
        this.positionsFor(pointIds.map((id) => ({ kind: "point", id }))),
        sx,
        sy,
        origin,
      ),
    );
  }

  reflect(pointIds: readonly PointId[], axis: ReflectAxis, origin: Point2D): void {
    this.setPositions(
      Transform.reflectPoints(
        this.positionsFor(pointIds.map((id) => ({ kind: "point", id }))),
        axis,
        origin,
      ),
    );
  }

  align(pointIds: readonly PointId[], alignment: AlignmentType): void {
    const points = this.positionsFor(pointIds.map((id) => ({ kind: "point", id })));
    const bounds = Bounds.fromPoints(points);
    if (!bounds) return;

    this.setPositions(Alignment.alignPoints(points, alignment, bounds));
  }

  distribute(pointIds: readonly PointId[], type: DistributeType): void {
    this.setPositions(
      Alignment.distributePoints(
        this.positionsFor(pointIds.map((id) => ({ kind: "point", id }))),
        type,
      ),
    );
  }

  restore(state: GlyphState): void {
    this.#edit.restore(state);
  }
}

export class GlyphInstance {
  readonly location: AxisLocation;

  readonly #glyph: Glyph;

  constructor(glyph: Glyph, location: AxisLocation) {
    this.#glyph = glyph;
    this.location = location;
  }

  get geometry(): GlyphGeometry {
    return this.#glyph.geometryAt(this.location);
  }

  get outline(): GlyphOutline {
    return this.#glyph.outlineAt(this.location);
  }
}

export class Glyph {
  readonly handle: GlyphHandle;

  readonly #font: Font;
  readonly #source: Source;

  readonly #structure: WritableSignal<GlyphStructure>;
  readonly #values: WritableSignal<Float64Array>;
  readonly #variationData: GlyphVariationData | null;

  readonly #geometry: ComputedSignal<GlyphGeometry>;

  readonly #xAdvance: ComputedSignal<number>;
  readonly #edit: GlyphEditSession;

  constructor(font: Font, handle: GlyphHandle, source: Source, state: GlyphState) {
    this.handle = handle;
    this.#font = font;
    this.#source = source;

    this.#structure = signal(state.structure);
    this.#values = signal(state.values);
    this.#variationData = state.variationData ?? null;

    this.#geometry = computed(() => new GlyphGeometry(this.#structure.value, this.#values.value));

    this.#xAdvance = computed(() => this.#geometry.value.xAdvance);
    this.#edit = new GlyphEditSession(font, handle, source, {
      structure: this.#structure,
      values: this.#values,
      geometry: this.#geometry,
    });
  }

  get name(): GlyphName {
    return this.handle.name;
  }

  get unicode(): Unicode | null {
    return this.handle.unicode ?? null;
  }

  get xAdvance(): number {
    return this.#xAdvance.value;
  }

  get contours(): readonly Contour[] {
    return this.#geometry.value.contours;
  }

  get anchors(): readonly Anchor[] {
    return this.#geometry.value.anchors;
  }

  /** @knipclassignore — public visible-geometry API. */
  get components(): readonly Component[] {
    return this.#geometry.value.components;
  }

  get bounds(): BoundsType | null {
    return this.#geometry.value.bounds;
  }

  /** @knipclassignore — public metrics API. */
  get sidebearings(): GlyphSidebearings {
    return this.#geometry.value.sidebearings;
  }

  get allPoints(): Point[] {
    return this.#geometry.value.allPoints;
  }

  /** @knipclassignore — reactive contour API for UI consumers. */
  get $contours(): Signal<readonly Contour[]> {
    return computed(() => this.contours);
  }

  get $xAdvance(): Signal<number> {
    return this.#xAdvance;
  }

  instanceAt(location: AxisLocation): GlyphInstance {
    return new GlyphInstance(this, location);
  }

  geometryAt(location: AxisLocation): GlyphGeometry {
    const sourceLocation = axisLocationFromLocation(this.#source.location);
    if (axisLocationsEqual(location, sourceLocation, [...this.#font.getAxes()])) {
      return this.#geometry.value;
    }

    const exactSource = this.#font.sourceAt(location);
    if (exactSource) {
      return this.#font.glyphSource(this.handle, exactSource)?.geometry ?? this.#geometry.value;
    }

    if (!this.#variationData) {
      return this.#geometry.value;
    }

    const values = interpolate(this.#variationData, normalize(location, [...this.#font.getAxes()]));

    if (values.length === 0) {
      return this.#geometry.value;
    }

    return new GlyphGeometry(this.#structure.value, values);
  }

  outline(location: Signal<AxisLocation>): GlyphOutline {
    return new GlyphOutline(this, {
      variationLocation: location,
      glyph: (handle) => this.#font.glyph(handle),
    });
  }

  outlineAt(location: AxisLocation): GlyphOutline {
    return this.outline(signal(location));
  }

  isPrimarySource(source: Source): boolean {
    return source.id === this.#source.id;
  }

  /** @internal GlyphSource caching is owned by Font.glyphSource(). */
  createGlyphSource(source: Source, state?: GlyphState | null): GlyphSource | null {
    if (!this.#font.source(source.id)) return null;
    if (this.isPrimarySource(source)) return new GlyphSource(source, this.#edit);
    if (!state) return null;

    const structure = signal(state.structure);
    const values = signal(state.values);
    const geometry = computed(() => new GlyphGeometry(structure.value, values.value));
    const edit = new GlyphEditSession(this.#font, this.handle, source, {
      structure,
      values,
      geometry,
    });
    return new GlyphSource(source, edit);
  }

  point(pointId: PointId): Point | null {
    return this.#geometry.value.point(pointId);
  }

  points(pointIds: readonly PointId[]): Point[] {
    return this.#geometry.value.points(pointIds);
  }

  contour(contourId: ContourId): Contour | null {
    return this.#geometry.value.contour(contourId);
  }

  *segments(): Generator<{ segment: Segment; contourId: ContourId }> {
    for (const contour of this.contours) {
      for (const segment of contour.segments()) {
        yield { segment, contourId: contour.id };
      }
    }
  }

  toState(): GlyphState {
    const variationData = this.#variationData;
    if (!variationData) return { structure: this.#structure.value, values: this.#values.value };

    return {
      structure: this.#structure.value,
      values: this.#values.value,
      variationData,
    };
  }
}
