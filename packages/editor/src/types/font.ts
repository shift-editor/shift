import type {
  AppliedChange,
  FontIntent,
  FontSnapshot,
  GlyphEntry,
  GlyphId,
  GlyphLayerSnapshot,
  GlyphPreview,
  GlyphRecord,
  GlyphSnapshot,
  GlyphSnapshotRequest,
  LayerId,
  LayerMatch,
  LayerRead,
  Location,
  WorkspaceDocumentState,
  WorkspaceSnapshot,
} from "@shift/types";
import type { FontStore } from "../lib/model/FontStore";
import type { PendingEditId } from "./editing";
import type { WorkspaceEditListener } from "./history";
import type { GlyphReader } from "./glyph";

/** `FontStore` lookup key for the layer a glyph authors in one source. */
export type GlyphSourceKey = string & { readonly __glyphSourceKey: unique symbol };

/**
 * Committed glyph lookups `FontStore` derives from one workspace or font snapshot.
 *
 * @remarks
 * Immutable: a new snapshot replaces the whole index so readers can track it
 * as a single signal value.
 */
export interface FontRecordIndex {
  readonly layerByGlyphSource: ReadonlyMap<GlyphSourceKey, LayerId>;
  readonly glyphByLayer: ReadonlyMap<LayerId, GlyphId>;
  readonly glyphById: ReadonlyMap<GlyphId, GlyphEntry>;
  readonly recordsById: ReadonlyMap<GlyphId, GlyphRecord>;
}

export interface FontStoreOptions {
  readonly font?: FontSnapshot | null;
  readonly records?: readonly GlyphRecord[];
  readonly workspace?: WorkspaceSnapshot | null;
}

export interface WorkspaceEditCoordinator {
  push(intent: FontIntent): PendingEditId;
  transaction<TResult>(label: string, body: () => TResult): TResult;
  apply(intents: FontIntent[], label?: string): Promise<AppliedChange>;
  readGlyphSnapshots(requests: readonly GlyphSnapshotRequest[]): Promise<GlyphSnapshot[]>;
  readGlyphPreviews(glyphIds: readonly GlyphId[], location: Location): Promise<GlyphPreview[]>;
  readLayers(layerIds: readonly LayerId[]): Promise<GlyphLayerSnapshot[]>;
  resolveLayers(layerIds: readonly LayerId[]): Promise<LayerRead[]>;
  matchLayers(referenceLayerId: LayerId, targetLayerId: LayerId): Promise<LayerMatch>;
  mapLocation(location: Location): Promise<Location>;
  settled(): Promise<void>;
  undo(): Promise<AppliedChange | null>;
  redo(): Promise<AppliedChange | null>;
  discardRedo(): Promise<void>;
  onEdit(listener: WorkspaceEditListener): () => void;
  state(): Promise<WorkspaceDocumentState | null>;
  readonly settledCell: { readonly value: boolean };
}

export interface FontOptions {
  readonly store: FontStore;
  readonly glyphInfo?: {
    getGlyphName(codepoint: number): string | null;
    getGlyphByName(name: string): { readonly codepoint: number } | null;
  };
  readonly editCoordinator?: WorkspaceEditCoordinator;
  readonly reader?: GlyphReader;
}
