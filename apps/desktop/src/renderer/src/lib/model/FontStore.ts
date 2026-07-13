import type {
  AppliedChange,
  AnchorId,
  ContourData,
  ContourId,
  GlyphId,
  GlyphRecord,
  GlyphStructure,
  GlyphState,
  GlyphVariationData,
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
import { GlyphLayerState } from "./GlyphLayerState";
import type { Glyph, GlyphLayer } from "./Glyph";

export type WorkspaceCommitState = "idle" | "queued" | "applying";

type GlyphSourceKey = string & { readonly __glyphSourceKey: unique symbol };

/**
 * Renderer-local owner for font records, concrete glyph layer state, and model caches.
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
  readonly #glyphModels = new Map<GlyphId, Glyph>();
  readonly #glyphLayerModels = new Map<GlyphSourceKey, GlyphLayer>();
  readonly #variationDataCells = new Map<GlyphId, WritableSignal<GlyphVariationData | null>>();

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
      this.#clearVariationData();
      this.#glyphModels.clear();
      this.#glyphLayerModels.clear();
      this.#rebuildGlyphObjectIndex();
    });
  }

  applyGlyphSnapshots(snapshots: readonly WorkspaceGlyphSnapshot[]): void {
    batch(() => {
      let layerChanged = false;

      for (const snapshot of snapshots) {
        if (!this.#glyphById.has(snapshot.glyphId)) continue;

        this.#variationDataCell(snapshot.glyphId).set(snapshot.variationData ?? null);

        for (const layer of snapshot.layers) {
          if (this.#applyLayerSnapshot(layer)) layerChanged = true;
        }
      }

      if (layerChanged) this.#rebuildGlyphObjectIndex();
    });
  }

  applyWorkspaceChange(applied: AppliedChange): void {
    const current = this.#workspace.peek();
    if (!current) return;

    batch(() => {
      const nextWorkspace =
        applied.glyphs || applied.axes || applied.axisMappings || applied.sources
          ? {
              ...current,
              glyphs: applied.glyphs ?? current.glyphs,
              axes: applied.axes ?? current.axes,
              axisMappings: applied.axisMappings ?? current.axisMappings,
              sources: applied.sources ?? current.sources,
            }
          : current;

      if (nextWorkspace !== current) {
        this.#workspace.set(nextWorkspace);
        this.#indexWorkspace(nextWorkspace);
      }

      let layerSetChanged = false;
      if (nextWorkspace !== current) {
        for (const [layerId, cell] of this.#layerStateCells) {
          if (this.#glyphByLayer.has(layerId)) continue;

          cell.set(null);
          this.#layerStateCells.delete(layerId);
          layerSetChanged = true;
        }

        for (const [glyphId, cell] of this.#variationDataCells) {
          if (this.#glyphById.has(glyphId)) continue;

          cell.set(null);
          this.#variationDataCells.delete(glyphId);
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
  }

  layerState(layerId: LayerId): GlyphLayerState | null {
    return this.#layerStateCell(layerId).peek();
  }

  hasGlyph(glyphId: GlyphId): boolean {
    return this.#glyphById.has(glyphId);
  }

  recordForId(glyphId: GlyphId): GlyphRecord | null {
    return this.#glyphById.get(glyphId) ?? null;
  }

  variationData(glyphId: GlyphId): GlyphVariationData | null {
    return this.#variationDataCell(glyphId).peek();
  }

  glyphModel(glyphId: GlyphId, create: () => Glyph | null): Glyph | null {
    const cached = this.#glyphModels.get(glyphId);
    if (cached) return cached;

    const created = create();
    if (created) this.#glyphModels.set(glyphId, created);
    return created;
  }

  glyphLayerModel(
    glyphId: GlyphId,
    sourceId: SourceId,
    create: () => GlyphLayer | null,
  ): GlyphLayer | null {
    const key = glyphSourceKey(glyphId, sourceId);
    const cached = this.#glyphLayerModels.get(key);
    if (cached) return cached;

    const created = create();
    if (created) this.#glyphLayerModels.set(key, created);
    return created;
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

  #variationDataCell(glyphId: GlyphId): WritableSignal<GlyphVariationData | null> {
    let cell = this.#variationDataCells.get(glyphId);
    if (!cell) {
      cell = signal(null, { name: `fontStore.variationData.${glyphId}` });
      this.#variationDataCells.set(glyphId, cell);
    }
    return cell;
  }

  #clearVariationData(): void {
    for (const cell of this.#variationDataCells.values()) cell.set(null);
    this.#variationDataCells.clear();
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
