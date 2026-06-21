import type { GlyphId, SourceId } from "@shift/types";
import type { WorkspaceGlyphSnapshotRequest } from "@shared/workspace/protocol";
import type { GlyphSnapshotStorePort } from "./FontStore";

type SnapshotRequest = {
  glyphId: GlyphId;
  sourceIds: SourceId[];
};

export type GlyphSnapshotLoadOptions = {
  readonly sourceIds?: readonly SourceId[];
};

export interface GlyphSnapshotLoadPort {
  loadGlyphSnapshots(requests: readonly WorkspaceGlyphSnapshotRequest[]): Promise<void>;
}

type InFlightKey = string & { readonly __inFlightKey: unique symbol };

/**
 * Coordinates renderer glyph snapshot reads through the workspace sync lane.
 *
 * @remarks
 * Loaded geometry and freshness state remain in {@link FontStore}; this loader
 * only dedupes requests, chooses source scopes, and follows component bases.
 */
export class GlyphSnapshotLoader {
  readonly #store: GlyphSnapshotStorePort;
  readonly #sync: GlyphSnapshotLoadPort;
  readonly #inFlight = new Set<InFlightKey>();

  constructor(store: GlyphSnapshotStorePort, sync: GlyphSnapshotLoadPort) {
    this.#store = store;
    this.#sync = sync;
  }

  /**
   * Loads missing or stale snapshots for the requested glyphs.
   *
   * @param glyphIds - stable glyph identities whose local geometry should be available.
   * @param options - optional source scope; omitted means every authored layer for each glyph.
   */
  async load(glyphIds: readonly GlyphId[], options: GlyphSnapshotLoadOptions = {}): Promise<void> {
    const queue = this.#requestable(glyphIds, options);
    const seen = new Set<GlyphId>(queue.map((request) => request.glyphId));

    while (queue.length > 0) {
      const batch = queue.splice(0);
      for (const request of batch) this.#markInFlight(request);

      try {
        await this.#sync.loadGlyphSnapshots(batch);
      } finally {
        for (const request of batch) this.#unmarkInFlight(request);
      }

      for (const request of batch) {
        for (const baseGlyphId of this.#store.loadedComponentBaseGlyphIds(request.glyphId)) {
          if (seen.has(baseGlyphId)) continue;
          const neededSourceIds = this.#neededSourceIds(baseGlyphId, options);
          if (neededSourceIds.length === 0) continue;
          seen.add(baseGlyphId);
          queue.push({ glyphId: baseGlyphId, sourceIds: neededSourceIds });
        }
      }
    }
  }

  /**
   * Starts a background snapshot load and logs failures.
   *
   * @param glyphIds - stable glyph identities whose local geometry should be requested.
   * @param options - optional source scope; omitted means every authored layer for each glyph.
   */
  request(glyphIds: readonly GlyphId[], options: GlyphSnapshotLoadOptions = {}): void {
    void this.load(glyphIds, options).catch((error) => {
      console.error("failed to load glyph snapshots", error);
    });
  }

  #requestable(glyphIds: readonly GlyphId[], options: GlyphSnapshotLoadOptions): SnapshotRequest[] {
    const result: SnapshotRequest[] = [];
    const seen = new Set<GlyphId>();
    for (const glyphId of glyphIds) {
      if (seen.has(glyphId)) continue;
      const neededSourceIds = this.#neededSourceIds(glyphId, options);
      if (neededSourceIds.length === 0) continue;
      seen.add(glyphId);
      result.push({ glyphId, sourceIds: neededSourceIds });
    }
    return result;
  }

  #neededSourceIds(glyphId: GlyphId, options: GlyphSnapshotLoadOptions): SourceId[] {
    const status = this.#store.snapshotStatus(glyphId);
    const shouldReload = status === "stale" || status === "failed";
    const needed: SourceId[] = [];
    const seen = new Set<SourceId>();
    const sourceIds = options.sourceIds ?? this.#store.sourceIdsForGlyph(glyphId);

    for (const sourceId of sourceIds) {
      if (seen.has(sourceId)) continue;
      seen.add(sourceId);
      if (!this.#store.hasLayerRecord(glyphId, sourceId)) continue;
      if (this.#inFlight.has(inFlightKey(glyphId, sourceId))) continue;
      if (shouldReload || !this.#store.hasLayerSnapshot(glyphId, sourceId)) {
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
