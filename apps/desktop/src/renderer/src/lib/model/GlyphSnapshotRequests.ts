import type { GlyphId, SourceId } from "@shift/types";
import type { FontStore } from "./FontStore";
import type { WorkspaceEditCoordinator } from "@/lib/workspace/WorkspaceEditCoordinator";

type SnapshotRequest = {
  glyphId: GlyphId;
  sourceIds: SourceId[];
};

type InFlightKey = string & { readonly __inFlightKey: unique symbol };

export class GlyphSnapshotRequests {
  readonly #store: FontStore;
  readonly #edits: WorkspaceEditCoordinator;
  readonly #inFlight = new Set<InFlightKey>();

  constructor(store: FontStore, edits: WorkspaceEditCoordinator) {
    this.#store = store;
    this.#edits = edits;
  }

  async load(glyphIds: readonly GlyphId[], sourceIds: readonly SourceId[]): Promise<void> {
    const queue = this.#requestable(glyphIds, sourceIds);
    const seen = new Set<GlyphId>(queue.map((request) => request.glyphId));

    while (queue.length > 0) {
      const batch = queue.splice(0);
      for (const request of batch) this.#markInFlight(request);

      try {
        await this.#edits.loadGlyphSnapshots(batch);
      } finally {
        for (const request of batch) this.#unmarkInFlight(request);
      }

      for (const request of batch) {
        for (const baseGlyphId of this.#store.loadedComponentBaseGlyphIds(request.glyphId)) {
          if (seen.has(baseGlyphId)) continue;
          const neededSourceIds = this.#neededSourceIds(baseGlyphId, sourceIds);
          if (neededSourceIds.length === 0) continue;
          seen.add(baseGlyphId);
          queue.push({ glyphId: baseGlyphId, sourceIds: neededSourceIds });
        }
      }
    }
  }

  #requestable(glyphIds: readonly GlyphId[], sourceIds: readonly SourceId[]): SnapshotRequest[] {
    const result: SnapshotRequest[] = [];
    const seen = new Set<GlyphId>();
    for (const glyphId of glyphIds) {
      if (seen.has(glyphId)) continue;
      const neededSourceIds = this.#neededSourceIds(glyphId, sourceIds);
      if (neededSourceIds.length === 0) continue;
      seen.add(glyphId);
      result.push({ glyphId, sourceIds: neededSourceIds });
    }
    return result;
  }

  #neededSourceIds(glyphId: GlyphId, sourceIds: readonly SourceId[]): SourceId[] {
    const status = this.#store.snapshotStatus(glyphId);
    const stale = status === "stale";
    const needed: SourceId[] = [];
    const seen = new Set<SourceId>();

    for (const sourceId of sourceIds) {
      if (seen.has(sourceId)) continue;
      seen.add(sourceId);
      if (!this.#store.hasLayerRecord(glyphId, sourceId)) continue;
      if (this.#inFlight.has(inFlightKey(glyphId, sourceId))) continue;
      if (stale || !this.#store.hasLayerSnapshot(glyphId, sourceId)) {
        needed.push(sourceId);
      }
    }

    return needed;
  }

  #markInFlight(request: SnapshotRequest): void {
    for (const sourceId of request.sourceIds) {
      this.#inFlight.add(inFlightKey(request.glyphId, sourceId));
    }
  }

  #unmarkInFlight(request: SnapshotRequest): void {
    for (const sourceId of request.sourceIds) {
      this.#inFlight.delete(inFlightKey(request.glyphId, sourceId));
    }
  }
}

function inFlightKey(glyphId: GlyphId, sourceId: SourceId): InFlightKey {
  return `${glyphId}:${sourceId}` as InFlightKey;
}
