import type {
  AppliedChange,
  GlyphId,
  GlyphLayerRecord,
  GlyphRecord,
  GlyphStructure,
  GlyphState,
  GlyphVariationData,
  LayerId,
  SourceId,
} from "@shift/types";
import type {
  WorkspaceGlyphLayerSnapshot,
  WorkspaceGlyphSnapshotRequest,
  WorkspaceGlyphSnapshot,
  WorkspaceSnapshot,
} from "@shared/workspace/protocol";
import { batch, signal, type Signal, type WritableSignal } from "@/lib/signals/signal";
import { GlyphLayerState } from "./GlyphLayerState";
import type { Glyph, GlyphLayer } from "./Glyph";

export type GlyphSnapshotStatus = "missing" | "loading" | "loaded" | "stale" | "failed";
export type WorkspaceCommitState = "idle" | "queued" | "applying";

type GlyphSourceKey = string & { readonly __glyphSourceKey: unique symbol };

const EMPTY_STATUS: ReadonlyMap<GlyphId, GlyphSnapshotStatus> = new Map();

export interface GlyphLoadBatch {
  readonly generation: number;
  readonly glyphIds: readonly GlyphId[];
}

/**
 * Renderer-local owner for font records, loaded glyph snapshots, model caches,
 * and snapshot status.
 *
 * Model reads and snapshot freshness live directly on the store. Workspace
 * mutation and async read ordering are owned by `WorkspaceEditCoordinator`; glyph-load
 * request selection is owned by `Font`.
 */
export class FontStore {
  readonly #workspace: WritableSignal<WorkspaceSnapshot | null>;
  readonly #snapshotStatus: WritableSignal<ReadonlyMap<GlyphId, GlyphSnapshotStatus>>;

  readonly #layerStates = new Map<LayerId, GlyphLayerState>();
  readonly #layerByGlyphSource = new Map<GlyphSourceKey, LayerId>();
  readonly #glyphByLayer = new Map<LayerId, GlyphId>();
  readonly #glyphById = new Map<GlyphId, GlyphRecord>();
  readonly #glyphModels = new Map<GlyphId, Glyph>();
  readonly #glyphLayerModels = new Map<GlyphSourceKey, GlyphLayer>();
  readonly #variationDataByGlyph = new Map<GlyphId, GlyphVariationData>();
  readonly #snapshotGeneration = new Map<GlyphId, number>();

  #generation = 0;

  constructor(workspace: WorkspaceSnapshot | null = null) {
    this.#workspace = signal(workspace, { name: "fontStore.workspace" });
    this.#snapshotStatus = signal(EMPTY_STATUS, { name: "fontStore.snapshotStatus" });
    if (workspace) this.#indexWorkspace(workspace);
  }

  get workspaceCell(): Signal<WorkspaceSnapshot | null> {
    return this.#workspace;
  }

  get snapshotStatusCell(): Signal<ReadonlyMap<GlyphId, GlyphSnapshotStatus>> {
    return this.#snapshotStatus;
  }

  replaceWorkspace(snapshot: WorkspaceSnapshot | null): void {
    batch(() => {
      this.#generation += 1;
      this.#workspace.set(snapshot);
      this.#indexWorkspace(snapshot);
      this.#layerStates.clear();
      this.#glyphModels.clear();
      this.#glyphLayerModels.clear();
      this.#variationDataByGlyph.clear();
      this.#snapshotGeneration.clear();
      this.#snapshotStatus.set(EMPTY_STATUS);
    });
  }

  beginGlyphLoad(requests: readonly WorkspaceGlyphSnapshotRequest[]): GlyphLoadBatch {
    const generation = this.#generation;
    const next = new Map(this.#snapshotStatus.peek());
    const glyphIds = requests.map((request) => request.glyphId);
    for (const glyphId of glyphIds) {
      this.#snapshotGeneration.set(glyphId, generation);
      next.set(glyphId, "loading");
    }
    this.#snapshotStatus.set(next);
    return { generation, glyphIds };
  }

  failGlyphLoad(batch: GlyphLoadBatch): void {
    if (batch.generation !== this.#generation) return;

    const next = new Map(this.#snapshotStatus.peek());
    for (const glyphId of batch.glyphIds) {
      if (this.#snapshotGeneration.get(glyphId) === batch.generation) {
        next.set(glyphId, "failed");
      }
    }
    this.#snapshotStatus.set(next);
  }

  finishGlyphLoad(load: GlyphLoadBatch, snapshots: readonly WorkspaceGlyphSnapshot[]): void {
    if (load.generation !== this.#generation) return;

    const received = new Set(snapshots.map((snapshot) => snapshot.glyphId));
    const nextStatus = new Map(this.#snapshotStatus.peek());

    batch(() => {
      for (const snapshot of snapshots) {
        if (this.#snapshotGeneration.get(snapshot.glyphId) !== load.generation) continue;

        if (snapshot.variationData) {
          this.#variationDataByGlyph.set(snapshot.glyphId, snapshot.variationData);
        } else {
          this.#variationDataByGlyph.delete(snapshot.glyphId);
        }

        for (const layer of snapshot.layers) {
          this.#applyLayerSnapshot(layer);
        }
        nextStatus.set(snapshot.glyphId, "loaded");
      }

      for (const glyphId of load.glyphIds) {
        if (!received.has(glyphId) && this.#snapshotGeneration.get(glyphId) === load.generation) {
          nextStatus.set(glyphId, "missing");
        }
      }

      this.#snapshotStatus.set(nextStatus);
    });
  }

  applyWorkspaceChange(applied: AppliedChange): void {
    const current = this.#workspace.peek();
    if (!current) return;

    batch(() => {
      const nextWorkspace =
        applied.glyphs || applied.axes || applied.sources
          ? {
              ...current,
              glyphs: applied.glyphs ?? current.glyphs,
              axes: applied.axes ?? current.axes,
              sources: applied.sources ?? current.sources,
            }
          : current;

      if (nextWorkspace !== current) {
        this.#generation += 1;
        this.#workspace.set(nextWorkspace);
        this.#indexWorkspace(nextWorkspace);
      }

      const staleGlyphIds = new Set<GlyphId>(applied.dependents);
      for (const layer of applied.layers) {
        const glyphId = this.#glyphByLayer.get(layer.layerId);
        if (glyphId) staleGlyphIds.add(glyphId);

        const state = this.#layerStates.get(layer.layerId);
        if (!state) continue;

        if (layer.structure) {
          state.replace({
            layerId: layer.layerId,
            structure: layer.structure,
            values: layer.values,
          });
        } else {
          state.replaceValues(layer.values);
        }
      }

      if (applied.axes || applied.sources) {
        for (const glyphId of this.#snapshotStatus.peek().keys()) {
          staleGlyphIds.add(glyphId);
        }
      }

      this.#markLoadedSnapshotsStale(staleGlyphIds);
    });
  }

  layerState(layerId: LayerId): GlyphLayerState | null {
    return this.#layerStates.get(layerId) ?? null;
  }

  hasGlyph(glyphId: GlyphId): boolean {
    return this.#glyphById.has(glyphId);
  }

  recordForId(glyphId: GlyphId): GlyphRecord | null {
    return this.#glyphById.get(glyphId) ?? null;
  }

  layerRecordForId(glyphId: GlyphId, sourceId: SourceId): GlyphLayerRecord | null {
    return this.recordForId(glyphId)?.layers.find((layer) => layer.sourceId === sourceId) ?? null;
  }

  variationData(glyphId: GlyphId): GlyphVariationData | null {
    return this.#variationDataByGlyph.get(glyphId) ?? null;
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

  sourceIdsForGlyph(glyphId: GlyphId): readonly SourceId[] {
    return this.recordForId(glyphId)?.layers.map((layer) => layer.sourceId) ?? [];
  }

  snapshotStatus(glyphId: GlyphId): GlyphSnapshotStatus {
    return this.#snapshotStatus.peek().get(glyphId) ?? "missing";
  }

  hasLayerSnapshot(glyphId: GlyphId, sourceId: SourceId): boolean {
    return this.#layerStateForGlyphSource(glyphId, sourceId) !== null;
  }

  hasLayerRecord(glyphId: GlyphId, sourceId: SourceId): boolean {
    return this.#layerByGlyphSource.has(glyphSourceKey(glyphId, sourceId));
  }

  needsGlyphSource(glyphId: GlyphId, sourceId: SourceId): boolean {
    if (!this.hasLayerRecord(glyphId, sourceId)) return false;
    const status = this.snapshotStatus(glyphId);
    return status === "stale" || status === "failed" || !this.hasLayerSnapshot(glyphId, sourceId);
  }

  loadedComponentBaseGlyphIds(glyphId: GlyphId): readonly GlyphId[] {
    const baseGlyphIds = new Set<GlyphId>();
    for (const state of this.#loadedLayerStatesForGlyph(glyphId)) {
      for (const baseGlyphId of componentBaseGlyphIds(state.structure)) {
        baseGlyphIds.add(baseGlyphId);
      }
    }
    return [...baseGlyphIds];
  }

  #layerStateForGlyphSource(glyphId: GlyphId, sourceId: SourceId): GlyphLayerState | null {
    const layerId = this.#layerByGlyphSource.get(glyphSourceKey(glyphId, sourceId));
    return layerId ? (this.#layerStates.get(layerId) ?? null) : null;
  }

  #applyLayerSnapshot(snapshot: WorkspaceGlyphLayerSnapshot): void {
    this.#glyphByLayer.set(snapshot.state.layerId, snapshot.glyphId);
    this.#layerByGlyphSource.set(
      glyphSourceKey(snapshot.glyphId, snapshot.sourceId),
      snapshot.state.layerId,
    );
    this.#replaceLayerState(snapshot.state);
  }

  #replaceLayerState(state: GlyphState): GlyphLayerState {
    const existing = this.#layerStates.get(state.layerId);
    if (existing) {
      existing.replace(state);
      return existing;
    }

    const created = new GlyphLayerState(state);
    this.#layerStates.set(state.layerId, created);
    return created;
  }

  #loadedLayerStatesForGlyph(glyphId: GlyphId): GlyphLayerState[] {
    const workspace = this.#workspace.peek();
    const record = workspace?.glyphs.find((candidate) => candidate.id === glyphId);
    if (!record) return [];

    return record.layers
      .map((layer) => this.#layerStates.get(layer.id))
      .filter((state): state is GlyphLayerState => state !== undefined);
  }

  #markLoadedSnapshotsStale(glyphIds: Iterable<GlyphId>): void {
    const nextStatus = new Map(this.#snapshotStatus.peek());
    let changed = false;

    for (const glyphId of glyphIds) {
      if (nextStatus.get(glyphId) !== "loaded") continue;
      nextStatus.set(glyphId, "stale");
      changed = true;
    }

    if (changed) this.#snapshotStatus.set(nextStatus);
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
