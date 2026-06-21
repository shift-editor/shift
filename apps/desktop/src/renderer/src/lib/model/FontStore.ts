import type {
  AppliedChange,
  FontIntent,
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
  WorkspaceGlyphSnapshot,
  WorkspaceSnapshot,
} from "@shared/workspace/protocol";
import { batch, signal, type Signal, type WritableSignal } from "@/lib/signals/signal";
import { GlyphLayerState } from "./GlyphLayerState";
import type { Glyph, GlyphLayer } from "./Glyph";

export type GlyphSnapshotStatus = "missing" | "loading" | "loaded" | "stale";
export type WorkspaceCommitState = "idle" | "queued" | "applying";

type GlyphSourceKey = string & { readonly __glyphSourceKey: unique symbol };

const EMPTY_STATUS: ReadonlyMap<GlyphId, GlyphSnapshotStatus> = new Map();

/** Mutates renderer-local font state from the serialized workspace sync lane. */
export interface FontStoreSyncPort {
  readonly settledCell: Signal<boolean>;
  readonly commitStateCell: Signal<WorkspaceCommitState>;

  replaceWorkspace(snapshot: WorkspaceSnapshot | null): void;
  enqueueIntent(intent: FontIntent): void;
  hasPendingIntents(): boolean;
  takePendingIntents(): FontIntent[];
  beginApplying(): void;
  markSettledIfIdle(busy: number): void;
  markSnapshotsLoading(glyphIds: readonly GlyphId[]): number;
  applyGlyphSnapshots(
    requestedGlyphIds: readonly GlyphId[],
    snapshots: readonly WorkspaceGlyphSnapshot[],
    generation: number,
  ): void;
  foldAppliedChange(applied: AppliedChange): void;
}

/** Exposes glyph snapshot freshness and dependency reads to the snapshot loader. */
export interface GlyphSnapshotStorePort {
  sourceIdsForGlyph(glyphId: GlyphId): readonly SourceId[];
  snapshotStatus(glyphId: GlyphId): GlyphSnapshotStatus;
  hasLayerSnapshot(glyphId: GlyphId, sourceId: SourceId): boolean;
  hasLayerRecord(glyphId: GlyphId, sourceId: SourceId): boolean;
  loadedComponentBaseGlyphIds(glyphId: GlyphId): readonly GlyphId[];
}

/**
 * Renderer-local owner for font records, loaded glyph snapshots, and pending
 * local commits.
 *
 * Model reads stay on the store. Workspace mutation enters through
 * {@link sync}; snapshot request coordination reads through
 * {@link glyphSnapshots}.
 */
export class FontStore {
  readonly #workspace: WritableSignal<WorkspaceSnapshot | null>;
  readonly #snapshotStatus: WritableSignal<ReadonlyMap<GlyphId, GlyphSnapshotStatus>>;
  readonly #settledCell = signal(true);
  readonly #commitState = signal<WorkspaceCommitState>("idle", {
    name: "workspace.commitState",
  });

  readonly #layerStates = new Map<LayerId, GlyphLayerState>();
  readonly #layerByGlyphSource = new Map<GlyphSourceKey, LayerId>();
  readonly #glyphByLayer = new Map<LayerId, GlyphId>();
  readonly #glyphById = new Map<GlyphId, GlyphRecord>();
  readonly #glyphModels = new Map<GlyphId, Glyph>();
  readonly #glyphLayerModels = new Map<GlyphSourceKey, GlyphLayer>();
  readonly #variationDataByGlyph = new Map<GlyphId, GlyphVariationData>();
  readonly #snapshotGeneration = new Map<GlyphId, number>();

  #generation = 0;
  #pendingIntents: FontIntent[] = [];

  readonly sync: FontStoreSyncPort = {
    settledCell: this.#settledCell,
    commitStateCell: this.#commitState,
    replaceWorkspace: (snapshot) => this.#replaceWorkspace(snapshot),
    enqueueIntent: (intent) => this.#enqueueIntent(intent),
    hasPendingIntents: () => this.#hasPendingIntents(),
    takePendingIntents: () => this.#takePendingIntents(),
    beginApplying: () => this.#beginApplying(),
    markSettledIfIdle: (busy) => this.#markSettledIfIdle(busy),
    markSnapshotsLoading: (glyphIds) => this.#markSnapshotsLoading(glyphIds),
    applyGlyphSnapshots: (requestedGlyphIds, snapshots, generation) =>
      this.#applyGlyphSnapshots(requestedGlyphIds, snapshots, generation),
    foldAppliedChange: (applied) => this.#foldAppliedChange(applied),
  };

  readonly glyphSnapshots: GlyphSnapshotStorePort = {
    sourceIdsForGlyph: (glyphId) => this.#sourceIdsForGlyph(glyphId),
    snapshotStatus: (glyphId) => this.#snapshotStatusForGlyph(glyphId),
    hasLayerSnapshot: (glyphId, sourceId) => this.#hasLayerSnapshot(glyphId, sourceId),
    hasLayerRecord: (glyphId, sourceId) => this.#hasLayerRecord(glyphId, sourceId),
    loadedComponentBaseGlyphIds: (glyphId) => this.#loadedComponentBaseGlyphIds(glyphId),
  };

  constructor(workspace: WorkspaceSnapshot | null = null) {
    this.#workspace = signal(workspace, { name: "fontStore.workspace" });
    this.#snapshotStatus = signal(EMPTY_STATUS, { name: "fontStore.snapshotStatus" });
    if (workspace) this.#indexWorkspace(workspace);
  }

  get workspaceCell(): Signal<WorkspaceSnapshot | null> {
    return this.#workspace;
  }

  #replaceWorkspace(snapshot: WorkspaceSnapshot | null): void {
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
      this.#pendingIntents = [];
      this.#settledCell.set(true);
      this.#commitState.set("idle");
    });
  }

  #enqueueIntent(intent: FontIntent): void {
    this.#pendingIntents.push(intent);
    this.#settledCell.set(false);
    if (this.#commitState.peek() === "idle") {
      this.#commitState.set("queued");
    }
  }

  #hasPendingIntents(): boolean {
    return this.#pendingIntents.length > 0;
  }

  #takePendingIntents(): FontIntent[] {
    const intents = this.#pendingIntents;
    this.#pendingIntents = [];
    return intents;
  }

  #beginApplying(): void {
    this.#commitState.set("applying");
  }

  #markSettledIfIdle(busy: number): void {
    if (busy === 0 && this.#pendingIntents.length === 0) {
      this.#settledCell.set(true);
      this.#commitState.set("idle");
    }
  }

  #markSnapshotsLoading(glyphIds: readonly GlyphId[]): number {
    const generation = this.#generation;
    const next = new Map(this.#snapshotStatus.peek());
    for (const glyphId of glyphIds) {
      this.#snapshotGeneration.set(glyphId, generation);
      next.set(glyphId, "loading");
    }
    this.#snapshotStatus.set(next);
    return generation;
  }

  #applyGlyphSnapshots(
    requestedGlyphIds: readonly GlyphId[],
    snapshots: readonly WorkspaceGlyphSnapshot[],
    generation: number,
  ): void {
    if (generation !== this.#generation) return;

    const received = new Set(snapshots.map((snapshot) => snapshot.glyphId));
    const nextStatus = new Map(this.#snapshotStatus.peek());

    batch(() => {
      for (const snapshot of snapshots) {
        if (this.#snapshotGeneration.get(snapshot.glyphId) !== generation) continue;

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

      for (const glyphId of requestedGlyphIds) {
        if (!received.has(glyphId) && this.#snapshotGeneration.get(glyphId) === generation) {
          nextStatus.set(glyphId, "missing");
        }
      }

      this.#snapshotStatus.set(nextStatus);
    });
  }

  #foldAppliedChange(applied: AppliedChange): void {
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

      if (staleGlyphIds.size > 0) {
        const nextStatus = new Map(this.#snapshotStatus.peek());
        for (const glyphId of staleGlyphIds) {
          const status = nextStatus.get(glyphId);
          if (status === "loaded") nextStatus.set(glyphId, "stale");
        }
        this.#snapshotStatus.set(nextStatus);
      }
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

  #sourceIdsForGlyph(glyphId: GlyphId): readonly SourceId[] {
    return this.recordForId(glyphId)?.layers.map((layer) => layer.sourceId) ?? [];
  }

  #snapshotStatusForGlyph(glyphId: GlyphId): GlyphSnapshotStatus {
    return this.#snapshotStatus.peek().get(glyphId) ?? "missing";
  }

  #hasLayerSnapshot(glyphId: GlyphId, sourceId: SourceId): boolean {
    return this.#layerStateForGlyphSource(glyphId, sourceId) !== null;
  }

  #hasLayerRecord(glyphId: GlyphId, sourceId: SourceId): boolean {
    return this.#layerByGlyphSource.has(glyphSourceKey(glyphId, sourceId));
  }

  #loadedComponentBaseGlyphIds(glyphId: GlyphId): readonly GlyphId[] {
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
