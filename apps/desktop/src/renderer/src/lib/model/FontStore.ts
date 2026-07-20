import type {
  AppliedChange,
  AnchorId,
  ContourData,
  ContourId,
  GlyphId,
  GlyphProjection,
  GlyphRecord,
  GlyphStructure,
  GlyphState,
  InterpolationBasis,
  LayerId,
  PointData,
  PointId,
  SourceId,
} from "@shift/types";
import { segmentIdFor, type SegmentId } from "@shift/glyph-state";
import { Validate } from "@shift/validation";
import type {
  WorkspaceGlyphLayerSnapshot,
  WorkspaceGlyphSnapshot,
  WorkspaceSnapshot,
} from "@shared/workspace/protocol";
import { batch, signal, type Signal, type WritableSignal } from "@/lib/signals/signal";
import type { GlyphObjectIndex, GlyphObjectSegment } from "@/types";
import type { AxisLocation } from "@/types/variation";
import { GlyphLayerState } from "./GlyphLayerState";
import type { Glyph, GlyphLayer, GlyphView } from "./Glyph";

export type WorkspaceCommitState = "idle" | "queued" | "applying";

type GlyphSourceKey = string & { readonly __glyphSourceKey: unique symbol };

/**
 * Renderer-local owner for font records, concrete glyph layer state, glyphs, and views.
 *
 * Workspace mutation and async read ordering are owned by
 * `WorkspaceEditCoordinator`. This store materializes returned glyph snapshots
 * into layer state and indexes objects from that concrete state.
 */
export class FontStore {
  readonly #workspace: WritableSignal<WorkspaceSnapshot | null>;

  #glyphObjectIndex: GlyphObjectIndex = emptyGlyphObjectIndex();

  readonly #layerStateCells = new Map<LayerId, WritableSignal<GlyphLayerState | null>>();
  readonly #layerByGlyphSource = new Map<GlyphSourceKey, LayerId>();
  readonly #glyphByLayer = new Map<LayerId, GlyphId>();
  readonly #glyphById = new Map<GlyphId, GlyphRecord>();
  readonly #glyphs = new Map<GlyphId, Glyph>();
  readonly #glyphLayers = new Map<GlyphSourceKey, GlyphLayer>();
  readonly #glyphViews = new Map<GlyphId, WeakMap<Signal<AxisLocation>, GlyphView>>();
  readonly #projectionCells = new Map<GlyphId, WritableSignal<GlyphProjection | null>>();
  readonly #interpolationBases = new Map<string, InterpolationBasis>();

  constructor(workspace: WorkspaceSnapshot | null = null) {
    this.#workspace = signal(workspace, { name: "fontStore.workspace" });
    if (workspace) this.#indexWorkspace(workspace);
  }

  get workspaceCell(): Signal<WorkspaceSnapshot | null> {
    return this.#workspace;
  }

  layerIdForPoint(pointId: PointId): LayerId | null {
    return this.#glyphObjectIndex.layerIdByPointId.get(pointId) ?? null;
  }

  contourIdForPoint(pointId: PointId): ContourId | null {
    return this.#glyphObjectIndex.contourIdByPointId.get(pointId) ?? null;
  }

  layerIdForAnchor(anchorId: AnchorId): LayerId | null {
    return this.#glyphObjectIndex.layerIdByAnchorId.get(anchorId) ?? null;
  }

  layerIdForContour(contourId: ContourId): LayerId | null {
    return this.#glyphObjectIndex.layerIdByContourId.get(contourId) ?? null;
  }

  layerIdForSegment(segmentId: SegmentId): LayerId | null {
    return this.#glyphObjectIndex.layerIdBySegmentId.get(segmentId) ?? null;
  }

  contourIdForSegment(segmentId: SegmentId): ContourId | null {
    return this.#glyphObjectIndex.contourIdBySegmentId.get(segmentId) ?? null;
  }

  pointIdsForSegment(segmentId: SegmentId): readonly PointId[] | null {
    return this.#glyphObjectIndex.pointIdsBySegmentId.get(segmentId) ?? null;
  }

  replaceWorkspace(snapshot: WorkspaceSnapshot | null): void {
    batch(() => {
      this.#workspace.set(snapshot);
      this.#indexWorkspace(snapshot);
      this.#clearLayerStates();
      this.#clearProjections();
      this.#interpolationBases.clear();
      this.#glyphs.clear();
      this.#glyphLayers.clear();
      this.#glyphViews.clear();
      this.#rebuildGlyphObjectIndex();
    });
  }

  applyGlyphSnapshots(snapshots: readonly WorkspaceGlyphSnapshot[]): void {
    batch(() => {
      let layerChanged = false;

      for (const snapshot of snapshots) {
        if (!this.#glyphById.has(snapshot.glyphId)) continue;

        this.#projectionCell(snapshot.glyphId).set(
          snapshot.projection ? this.#internProjection(snapshot.projection) : null,
        );

        for (const layer of snapshot.layers) {
          if (this.#applyLayerSnapshot(layer)) layerChanged = true;
        }
      }

      if (layerChanged) this.#rebuildGlyphObjectIndex();
    });
  }

  applyGlyphProjections(projections: readonly GlyphProjection[]): void {
    batch(() => {
      for (const projection of projections) {
        if (!this.#glyphById.has(projection.glyphId)) continue;
        this.#projectionCell(projection.glyphId).set(this.#internProjection(projection));
      }
    });
  }

  /**
   * Replaces a requested projection set after a structural workspace change.
   *
   * @remarks
   * The replacement is published in one signal batch. A requested glyph that
   * no longer has an authored shape resolves to `null`; additional component
   * projections returned by the bridge are retained too.
   *
   * @param glyphIds - Root glyph identities included in the native refresh.
   * @param projections - Refreshed roots and their transitive component projections.
   */
  replaceGlyphProjections(
    glyphIds: readonly GlyphId[],
    projections: readonly GlyphProjection[],
  ): void {
    const interned = projections.map((projection) => this.#internProjection(projection));
    const byGlyphId = new Map(interned.map((projection) => [projection.glyphId, projection]));

    batch(() => {
      for (const glyphId of glyphIds) {
        this.#projectionCell(glyphId).set(byGlyphId.get(glyphId) ?? null);
      }
      for (const projection of interned) {
        if (!this.#glyphById.has(projection.glyphId)) continue;
        this.#projectionCell(projection.glyphId).set(projection);
      }
    });
  }

  /**
   * Folds a replace-grade workspace echo and reports structural projection work.
   *
   * @remarks
   * Numeric layer edits flow through live layer signals and return no projection
   * work. Axis/source topology, glyph-layer membership, and structural layer
   * replacements return only resident glyph identities that need native rebuilding.
   *
   * @param applied - Replace-grade workspace echo to fold into renderer state.
   * @returns Resident glyph identities whose projections need replacement.
   */
  applyWorkspaceChange(applied: AppliedChange): readonly GlyphId[] {
    const current = this.#workspace.peek();
    if (!current) return [];
    const changedGlyphLayers = applied.next?.glyphs
      ? glyphIdsWithChangedLayers(current.glyphs, applied.next.glyphs)
      : [];
    const structurallyChangedGlyphIds = new Set(changedGlyphLayers);
    for (const layer of applied.layers) {
      if (!layer.structure) continue;

      const glyphId = this.#glyphByLayer.get(layer.layerId);
      if (glyphId) structurallyChangedGlyphIds.add(glyphId);
    }

    batch(() => {
      const next = applied.next;
      const nextWorkspace = next
        ? {
            ...current,
            metadata: next.metadata ?? current.metadata,
            glyphs: next.glyphs ?? current.glyphs,
            axes: next.axes ?? current.axes,
            axisMappings: next.axisMappings ?? current.axisMappings,
            metricDefinitions: next.metricDefinitions ?? current.metricDefinitions,
            sourceMetricsInterpolation: next.sourceMetricsInterpolation
              ? (next.sourceMetricsInterpolation.snapshot ?? null)
              : current.sourceMetricsInterpolation,
            namedInstances: next.namedInstances ?? current.namedInstances,
            sources: next.sources ?? current.sources,
          }
        : current;

      if (nextWorkspace !== current) {
        this.#workspace.set(nextWorkspace);
        this.#indexWorkspace(nextWorkspace);
      }

      let layerSetChanged = false;
      if (nextWorkspace !== current) {
        if (changedGlyphLayers.length > 0) {
          for (const glyphId of changedGlyphLayers) this.#glyphs.delete(glyphId);
        }
        if (next?.axes || next?.sources || changedGlyphLayers.length > 0) {
          this.#glyphLayers.clear();
        }
        if (next?.axes || next?.sources) this.#interpolationBases.clear();

        for (const [layerId, cell] of this.#layerStateCells) {
          if (this.#glyphByLayer.has(layerId)) continue;

          cell.set(null);
          this.#layerStateCells.delete(layerId);
          layerSetChanged = true;
        }

        for (const [glyphId, cell] of this.#projectionCells) {
          if (this.#glyphById.has(glyphId)) continue;

          cell.set(null);
          this.#projectionCells.delete(glyphId);
          this.#glyphViews.delete(glyphId);
        }
      }

      let structureChanged = false;
      for (const layer of applied.layers) {
        if (!this.#glyphByLayer.has(layer.layerId)) continue;

        if (layer.structure) {
          this.#replaceLayerState({
            layerId: layer.layerId,
            structure: layer.structure,
            values: layer.values,
          });
          structureChanged = true;
        } else {
          this.#peekLayerState(layer.layerId)?.replaceValues(layer.values);
        }
      }

      if (structureChanged || layerSetChanged) this.#rebuildGlyphObjectIndex();
    });

    if (applied.next?.axes || applied.next?.sources) {
      return this.#residentProjectionGlyphIds();
    }

    return [...structurallyChangedGlyphIds].filter(
      (glyphId) =>
        this.#glyphById.has(glyphId) && Boolean(this.#projectionCells.get(glyphId)?.peek()),
    );
  }

  layerState(layerId: LayerId): GlyphLayerState | null {
    return this.#layerStateCell(layerId).peek();
  }

  layerStateCell(layerId: LayerId): Signal<GlyphLayerState | null> {
    return this.#layerStateCell(layerId);
  }

  hasGlyph(glyphId: GlyphId): boolean {
    return this.#glyphById.has(glyphId);
  }

  recordForId(glyphId: GlyphId): GlyphRecord | null {
    return this.#glyphById.get(glyphId) ?? null;
  }

  projection(glyphId: GlyphId): GlyphProjection | null {
    return this.#projectionCell(glyphId).peek();
  }

  projectionCell(glyphId: GlyphId): Signal<GlyphProjection | null> {
    return this.#projectionCell(glyphId);
  }

  glyph(glyphId: GlyphId, create: () => Glyph | null): Glyph | null {
    const cached = this.#glyphs.get(glyphId);
    if (cached) return cached;

    const created = create();
    if (created) this.#glyphs.set(glyphId, created);
    return created;
  }

  glyphLayer(
    glyphId: GlyphId,
    sourceId: SourceId,
    create: () => GlyphLayer | null,
  ): GlyphLayer | null {
    const key = glyphSourceKey(glyphId, sourceId);
    const cached = this.#glyphLayers.get(key);
    if (cached) return cached;

    const created = create();
    if (created) this.#glyphLayers.set(key, created);
    return created;
  }

  glyphView(glyphId: GlyphId, location: Signal<AxisLocation>, create: () => GlyphView): GlyphView {
    let views = this.#glyphViews.get(glyphId);
    if (!views) {
      views = new WeakMap();
      this.#glyphViews.set(glyphId, views);
    }

    const cached = views.get(location);
    if (cached) return cached;

    const view = create();
    views.set(location, view);
    return view;
  }

  componentBaseGlyphIdsInLayerState(glyphId: GlyphId): readonly GlyphId[] {
    const baseGlyphIds = new Set<GlyphId>();
    for (const state of this.#loadedLayerStatesForGlyph(glyphId)) {
      for (const baseGlyphId of componentBaseGlyphIds(state.structure)) {
        baseGlyphIds.add(baseGlyphId);
      }
    }
    return [...baseGlyphIds];
  }

  #applyLayerSnapshot(snapshot: WorkspaceGlyphLayerSnapshot): boolean {
    const layerId = this.#layerByGlyphSource.get(
      glyphSourceKey(snapshot.glyphId, snapshot.sourceId),
    );
    if (layerId !== snapshot.state.layerId) return false;

    this.#replaceLayerState(snapshot.state);
    return true;
  }

  #replaceLayerState(state: GlyphState): GlyphLayerState {
    const cell = this.#layerStateCell(state.layerId);
    const existing = cell.peek();
    if (existing) {
      existing.replace(state);
      return existing;
    }

    const created = new GlyphLayerState(state);
    cell.set(created);
    return created;
  }

  #loadedLayerStatesForGlyph(glyphId: GlyphId): GlyphLayerState[] {
    const workspace = this.#workspace.peek();
    const record = workspace?.glyphs.find((candidate) => candidate.id === glyphId);
    if (!record) return [];

    return record.layers
      .map((layer) => this.#peekLayerState(layer.id))
      .filter((state): state is GlyphLayerState => state !== null);
  }

  #layerStateCell(layerId: LayerId): WritableSignal<GlyphLayerState | null> {
    let cell = this.#layerStateCells.get(layerId);
    if (!cell) {
      cell = signal(null, { name: `fontStore.layerState.${layerId}` });
      this.#layerStateCells.set(layerId, cell);
    }
    return cell;
  }

  #peekLayerState(layerId: LayerId): GlyphLayerState | null {
    return this.#layerStateCells.get(layerId)?.peek() ?? null;
  }

  #clearLayerStates(): void {
    for (const cell of this.#layerStateCells.values()) cell.set(null);
    this.#layerStateCells.clear();
  }

  #projectionCell(glyphId: GlyphId): WritableSignal<GlyphProjection | null> {
    let cell = this.#projectionCells.get(glyphId);
    if (!cell) {
      cell = signal(null, { name: `fontStore.projection.${glyphId}` });
      this.#projectionCells.set(glyphId, cell);
    }
    return cell;
  }

  #clearProjections(): void {
    for (const cell of this.#projectionCells.values()) cell.set(null);
    this.#projectionCells.clear();
  }

  #residentProjectionGlyphIds(): GlyphId[] {
    const glyphIds: GlyphId[] = [];
    for (const [glyphId, cell] of this.#projectionCells) {
      if (cell.peek()) glyphIds.push(glyphId);
    }
    return glyphIds;
  }

  #internProjection(projection: GlyphProjection): GlyphProjection {
    const interpolation = projection.interpolation;
    if (!interpolation) return projection;

    const key = interpolation.basis.sourceIds.join("\u0000");
    const basis = this.#interpolationBases.get(key);
    if (!basis) {
      this.#interpolationBases.set(key, interpolation.basis);
      return projection;
    }
    if (basis === interpolation.basis) return projection;

    return {
      ...projection,
      interpolation: { ...interpolation, basis },
    };
  }

  #rebuildGlyphObjectIndex(): void {
    this.#glyphObjectIndex = this.#buildGlyphObjectIndex();
  }

  #buildGlyphObjectIndex(): GlyphObjectIndex {
    const layerIdByPointId = new Map<PointId, LayerId>();
    const contourIdByPointId = new Map<PointId, ContourId>();
    const layerIdByContourId = new Map<ContourId, LayerId>();
    const layerIdByAnchorId = new Map<AnchorId, LayerId>();
    const layerIdBySegmentId = new Map<SegmentId, LayerId>();
    const contourIdBySegmentId = new Map<SegmentId, ContourId>();
    const pointIdsBySegmentId = new Map<SegmentId, readonly PointId[]>();

    for (const cell of this.#layerStateCells.values()) {
      const state = cell.peek();
      if (!state) continue;

      const layerId = state.layerId;
      const structure = state.structure;

      for (const contour of structure.contours) {
        layerIdByContourId.set(contour.id, layerId);

        for (const point of contour.points) {
          layerIdByPointId.set(point.id, layerId);
          contourIdByPointId.set(point.id, contour.id);
        }

        for (const segment of indexedSegments(contour)) {
          layerIdBySegmentId.set(segment.id, layerId);
          contourIdBySegmentId.set(segment.id, contour.id);
          pointIdsBySegmentId.set(segment.id, segment.pointIds);
        }
      }

      for (const anchor of structure.anchors) {
        layerIdByAnchorId.set(anchor.id, layerId);
      }
    }

    return {
      layerIdByPointId,
      contourIdByPointId,
      layerIdByContourId,
      layerIdByAnchorId,
      layerIdBySegmentId,
      contourIdBySegmentId,
      pointIdsBySegmentId,
    };
  }

  #indexWorkspace(snapshot: WorkspaceSnapshot | null): void {
    this.#layerByGlyphSource.clear();
    this.#glyphByLayer.clear();
    this.#glyphById.clear();
    if (!snapshot) return;

    for (const glyph of snapshot.glyphs) {
      this.#glyphById.set(glyph.id, glyph);
      for (const layer of glyph.layers) {
        this.#layerByGlyphSource.set(glyphSourceKey(glyph.id, layer.sourceId), layer.id);
        this.#glyphByLayer.set(layer.id, glyph.id);
      }
    }
  }
}

function glyphSourceKey(glyphId: GlyphId, sourceId: SourceId): GlyphSourceKey {
  return `${glyphId}:${sourceId}` as GlyphSourceKey;
}

function glyphIdsWithChangedLayers(
  before: readonly GlyphRecord[],
  after: readonly GlyphRecord[],
): GlyphId[] {
  const beforeById = new Map(before.map((glyph) => [glyph.id, glyph]));
  const changed: GlyphId[] = [];

  for (const glyph of after) {
    const previous = beforeById.get(glyph.id);
    if (!previous || !sameGlyphLayers(previous, glyph)) changed.push(glyph.id);
    beforeById.delete(glyph.id);
  }

  changed.push(...beforeById.keys());
  return changed;
}

function sameGlyphLayers(left: GlyphRecord, right: GlyphRecord): boolean {
  if (left.layers.length !== right.layers.length) return false;

  return left.layers.every((layer, index) => {
    const other = right.layers[index];
    return other?.id === layer.id && other.sourceId === layer.sourceId;
  });
}

function componentBaseGlyphIds(structure: GlyphStructure): readonly GlyphId[] {
  return structure.components.map((component) => component.baseGlyphId);
}

function emptyGlyphObjectIndex(): GlyphObjectIndex {
  return {
    layerIdByPointId: new Map(),
    contourIdByPointId: new Map(),
    layerIdByContourId: new Map(),
    layerIdByAnchorId: new Map(),
    layerIdBySegmentId: new Map(),
    contourIdBySegmentId: new Map(),
    pointIdsBySegmentId: new Map(),
  };
}

function indexedSegments(contour: ContourData): GlyphObjectSegment[] {
  const { points, closed } = contour;
  if (points.length < 2) return [];

  const segments: GlyphObjectSegment[] = [];
  let index = 0;

  const limit = closed ? points.length : points.length - 1;

  while (index < limit) {
    const start = pointAt(points, closed, index);
    const next = pointAt(points, closed, index + 1);
    if (!start || !next) break;

    if (isOnCurve(start) && isOnCurve(next)) {
      segments.push(indexedSegment(start, next, [start.id, next.id]));
      index += 1;
      continue;
    }

    if (isOnCurve(start) && isOffCurve(next)) {
      const maybeEnd = pointAt(points, closed, index + 2);
      if (!maybeEnd) break;

      if (isOnCurve(maybeEnd)) {
        segments.push(indexedSegment(start, maybeEnd, [start.id, next.id, maybeEnd.id]));
        index += 2;
        continue;
      }

      if (isOffCurve(maybeEnd)) {
        const end = pointAt(points, closed, index + 3);
        if (!end) break;

        segments.push(indexedSegment(start, end, [start.id, next.id, maybeEnd.id, end.id]));
        index += 3;
        continue;
      }
    }

    index += 1;
  }

  return segments;
}

function indexedSegment(
  start: PointData,
  end: PointData,
  pointIds: readonly PointId[],
): GlyphObjectSegment {
  return {
    id: segmentIdFor(start.id, end.id),
    pointIds,
  };
}

function pointAt(points: readonly PointData[], closed: boolean, index: number): PointData | null {
  if (index < points.length) return points[index] ?? null;
  if (!closed) return null;

  return points[index - points.length] ?? null;
}

function isOnCurve(point: PointData): boolean {
  return Validate.isOnCurve(point);
}

function isOffCurve(point: PointData): boolean {
  return Validate.isOffCurve(point);
}
