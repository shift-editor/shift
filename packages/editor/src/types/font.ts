import type {
  AppliedChange,
  FontIntent,
  FontSnapshot,
  GlyphEntry,
  GlyphId,
  GlyphPreview,
  GlyphRecord,
  GlyphSnapshot,
  GlyphSnapshotRequest,
  LayerId,
  LayerMatch,
  Location,
  WorkspaceDocumentState,
  WorkspaceSnapshot,
  GlyphName,
  Unicode,
} from "@shift/types";
import type { FontStore } from "../lib/model/FontStore";
import type { PendingEditId } from "./editing";
import type { WorkspaceEditListener } from "./history";
import type { GlyphReader } from "./glyph";

/** `FontStore` lookup key for the layer a glyph authors in one source. */
export type GlyphSourceKey = string & { readonly __glyphSourceKey: unique symbol };

/**
 * Every committed glyph relation, derived once by `FontStore` from one workspace or font snapshot.
 *
 * @remarks
 * The single index of glyph identity: `Font`'s directory queries read it rather
 * than re-indexing. Immutable: a new snapshot replaces the whole index so
 * readers can track it as a single signal value.
 */
export interface FontRecordIndex {
  /** Directory entries in font order. */
  readonly entries: readonly GlyphEntry[];
  /** Records of directory glyphs, in font order. */
  readonly records: readonly GlyphRecord[];
  /** Every assigned codepoint, ascending. */
  readonly unicodes: readonly Unicode[];
  readonly glyphById: ReadonlyMap<GlyphId, GlyphEntry>;
  readonly recordsById: ReadonlyMap<GlyphId, GlyphRecord>;
  readonly entryByName: ReadonlyMap<GlyphName, GlyphEntry>;
  readonly recordByName: ReadonlyMap<GlyphName, GlyphRecord>;
  /** The first glyph, in font order, that claims each codepoint. */
  readonly nameByUnicode: ReadonlyMap<Unicode, GlyphName>;
  /** Glyphs that reference each base glyph as a component. */
  readonly dependentsById: ReadonlyMap<GlyphId, ReadonlySet<GlyphId>>;
  /** At most one layer per glyph and source, as Rust enforces. */
  readonly layerByGlyphSource: ReadonlyMap<GlyphSourceKey, LayerId>;
  readonly glyphByLayer: ReadonlyMap<LayerId, GlyphId>;
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
