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
  ShaperFont,
  WorkspaceDocumentState,
  WorkspaceSnapshot,
  GlyphName,
  Unicode,
  ReadonlyEntityMap,
  SourceId,
} from "@shift/types";
import type { FontStore } from "../lib/model/FontStore";
import type { LayerUpdate } from "../lib/model/GlyphLayerState";
import type { Signal } from "../lib/signals/signal";
import type { EditablePair, InterpolatedMetrics } from "../lib/wasm/engine";
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
  readonly glyphById: ReadonlyEntityMap<GlyphId, GlyphEntry>;
  readonly recordsById: ReadonlyEntityMap<GlyphId, GlyphRecord>;
  readonly entryByName: ReadonlyEntityMap<GlyphName, GlyphEntry>;
  readonly recordByName: ReadonlyEntityMap<GlyphName, GlyphRecord>;
  /** The first glyph, in font order, that claims each codepoint. */
  readonly nameByUnicode: ReadonlyMap<Unicode, GlyphName>;
  /** Glyphs that reference each base glyph as a component. */
  readonly dependentsById: ReadonlyMap<GlyphId, ReadonlySet<GlyphId>>;
  /** At most one layer per glyph and source, as Rust enforces. */
  readonly layerByGlyphSource: ReadonlyEntityMap<GlyphSourceKey, LayerId>;
  readonly glyphByLayer: ReadonlyEntityMap<LayerId, GlyphId>;
}

export interface FontStoreOptions {
  readonly font?: FontSnapshot | null;
  // oxlint-disable-next-line shift/no-optional-collection-field -- an options bag; absent starts with no glyph records
  readonly records?: readonly GlyphRecord[];
  readonly workspace?: WorkspaceSnapshot | null;
  /** The window's editing engine, which answers kerning and metric reads; absent, nothing kerns. */
  readonly engine?: FontEngine | null;
}

/**
 * Where kerning is read: at the source being edited, or at a design location
 * given as coordinates in the font's axis order, NaN for an axis default.
 */
export type KerningPlace =
  | { readonly kind: "source"; readonly sourceId: SourceId }
  | { readonly kind: "location"; readonly location: readonly number[] };

/**
 * The font as the window's editing engine holds it, read synchronously: the
 * kerning and metric rules run once, in Rust, over the engine's own font.
 *
 * @remarks
 * Reads answer from the engine's font as it stands, an open edit included.
 * The revision cells change whenever what a read returns may have changed,
 * including when the engine opens, so reactive readers track them.
 */
export interface FontEngine {
  /** Changes whenever {@link kerningRun} or {@link kerningPairs} may answer differently. */
  readonly kerningRevisionCell: Signal<number>;
  /** Changes whenever {@link sourceMetricsAt} may answer differently. */
  readonly sourceMetricsRevisionCell: Signal<number>;

  /**
   * Reads the kerning between glyph pairs at one place, in one call.
   *
   * @param pairs - Each pair's first glyph then its second.
   * @returns One value per pair, in font units; zeros while the engine is not open.
   */
  kerningRun(pairs: readonly GlyphId[], place: KerningPlace): readonly number[];

  /**
   * Reads, for each glyph pair, the authored pair an edit to it at a source
   * changes, and whether that pair applies there.
   *
   * @param pairs - Each pair's first glyph then its second.
   * @returns One entry per pair; empty while the engine is not open.
   */
  kerningPairs(sourceId: SourceId, pairs: readonly GlyphId[]): readonly EditablePair[];

  /**
   * Interpolates the masters' source metrics at a design location.
   *
   * @param location - Design coordinates in the font's axis order, NaN for an axis default.
   * @returns null for a font whose masters do not interpolate, or while the engine is not open.
   */
  sourceMetricsAt(location: readonly number[]): InterpolatedMetrics | null;

  /**
   * The name a new glyph asked to be called `name` takes: `name` trimmed, or
   * `newGlyph` when blank, numbered `.1`, `.2`, … past any glyph called that.
   *
   * @throws When the engine is not open.
   */
  nextGlyphName(name: string): GlyphName;

  /**
   * The name a new anchor added to every one of `layerIds` takes: `new`,
   * numbered `.1`, `.2`, … past any anchor called that in any of them.
   *
   * @throws When the engine is not open.
   */
  newAnchorName(layerIds: readonly LayerId[]): string;
}

/**
 * An edit that stays open across frames, as a drag does: each
 * {@link OpenEdit.stage} replaces what the edit applied before, in the
 * window's engine, and shows it at once.
 */
export interface OpenEdit {
  /**
   * Applies `intents` in place of what this edit applied so far; none
   * returns the font to where the edit began.
   *
   * @throws When the engine rejects the intents; the edit is then as it was.
   */
  stage(intents: readonly FontIntent[]): void;
  /** Closes the edit as one undo step and persists it; an edit that staged nothing commits nothing. */
  commit(label: string): void;
  /** Closes the edit, leaving the font as it was before it began. */
  cancel(): void;
}

export interface WorkspaceEditCoordinator {
  push(intent: FontIntent): PendingEditId;
  /**
   * Applies `intents` as {@link WorkspaceEditCoordinator.push} applies one,
   * in one engine call that shows each touched layer once.
   */
  pushAll(intents: readonly FontIntent[]): PendingEditId;
  /**
   * Every layer `intents` would touch, as they would leave it, without keeping
   * the edit; a layer whose structure they keep comes with values only.
   */
  preview(intents: readonly FontIntent[]): readonly LayerUpdate[];
  transaction<TResult>(label: string, body: () => TResult): TResult;
  /**
   * Opens an edit that stays open across frames until committed or cancelled.
   *
   * @throws When a transaction or another open edit is open.
   */
  openEdit(): OpenEdit;
  apply(intents: FontIntent[], label?: string): Promise<AppliedChange>;
  readGlyphSnapshots(requests: readonly GlyphSnapshotRequest[]): Promise<GlyphSnapshot[]>;
  readGlyphPreviews(glyphIds: readonly GlyphId[], location: Location): Promise<GlyphPreview[]>;
  readLayers(layerIds: readonly LayerId[]): Promise<GlyphLayerSnapshot[]>;
  resolveLayers(layerIds: readonly LayerId[]): Promise<LayerRead[]>;
  matchLayers(referenceLayerId: LayerId, targetLayerId: LayerId): Promise<LayerMatch>;
  mapLocation(location: Location): Promise<Location>;
  shaperFont(knownRevision: number | null): Promise<ShaperFont | null>;
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
