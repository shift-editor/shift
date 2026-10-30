import type {
  CatalogAtlasPage,
  CatalogAtlasWeights,
  GlyphId,
  GlyphLayerSnapshot,
  GlyphPreview,
  GlyphProjection,
  GlyphSnapshot,
  LayerId,
  LayerMatch,
  LayerRead,
  Location,
  SaveState,
  ShaperFont,
  SlugAtlas,
  Specimen,
  WorkspaceDocumentState,
  WorkspaceSnapshot,
} from "@shift/types";
import type {
  FontSourceAtlasPageRequest,
  FontSourceSession,
  FontSourceSnapshot,
  FontStoreLocation,
  PersistedChange,
  SlugAtlasOrigin,
  WorkspaceDocumentIdentity,
  WorkspaceExportResult,
  WorkspaceGlyphSnapshotRequest,
  WorkspaceRecovery,
  WorkspaceSlugAtlas,
  WorkspaceSlugAtlasPageRequest,
} from "./lanes";

export type {
  FontSessionMode,
  FontSourceAtlasPageRequest,
  FontSourceSession,
  FontSourceSnapshot,
  SlugAtlasOrigin,
  Specimen,
  WorkspaceDocumentIdentity,
  WorkspaceDocumentSourceKind,
  WorkspaceDocumentState,
  WorkspaceExportResult,
  WorkspaceGlyphLayerSnapshot,
  WorkspaceGlyphSnapshotRequest,
  WorkspaceRecovery,
  WorkspaceSlugAtlas,
  WorkspaceSlugAtlasPageRequest,
  WorkspaceSnapshot,
} from "./lanes";
export { FontStoreLocation } from "./lanes";

/** Bounded byte delivery over a dedicated transferred port. */
export type ByteStreamMessage =
  | { kind: "chunk"; offset: number; bytes: Uint8Array<ArrayBuffer> }
  | { kind: "complete"; totalLength: number }
  | { kind: "error"; message: string };

/** Receiver backpressure for a dedicated bounded byte stream. */
export type ByteStreamControl =
  | { kind: "ack"; nextOffset: number }
  | { kind: "cancel"; message: string };

/** Minimal readable-stream contract shared by native and web streams. */
export type ByteReadableStream<T> =
  | { getReader(): ByteReadableStreamReader<T> }
  | ReadableStream<T>;

export interface ByteReadableStreamReader<T> {
  read(): Promise<{ done: false; value: T } | { done: true; value: undefined }>;
  cancel(reason?: unknown): Promise<void>;
  releaseLock(): void;
}

/**
 * Shell-lane calls that carry a transferred port, served beside
 * `WorkspaceShell`.
 *
 * @remarks
 * The port arrives in the handler's context, not in the payload.
 */
export type ShellPortCallMap = {
  /** Hands the window's sync-lane port to the workspace; replaces the previous sync lane. */
  connect: { request: void; response: void };
};

/** One-way shell-lane events from the workspace to main. */
export type ShellEventMap = {
  ready: void;
  "document.changed": WorkspaceDocumentState | null;
};

/**
 * Sync-lane calls that stream bytes over a transferred response port, served
 * beside `WorkspaceSync`.
 *
 * @remarks
 * Each resolves once the stream completes; the bytes travel on the port as
 * {@link ByteStreamMessage}s. Their prepare and discard calls are interface
 * methods.
 */
export type SyncStreamCallMap = {
  /** Streams one prepared preview page (from `prepareSourceAtlasPage`). */
  streamSourceAtlasPage: {
    request: { generation: number; maximumLength: number };
    response: null;
  };
  /** Streams one prepared atlas generation (from `prepareSlugAtlas`). */
  streamSlugAtlas: {
    request: { generation: number; maximumLength: number };
    response: null;
  };
  /** Streams one prepared page (from `prepareSlugAtlasPage`). */
  streamSlugAtlasPage: {
    request: { generation: number; origin: SlugAtlasOrigin; maximumLength: number };
    response: null;
  };
};

/** One-way sync-lane events from the workspace to the window. */
export type SyncEventMap = {
  "document.changed": WorkspaceDocumentState | null;
};

/**
 * Shell lane: main ↔ utility. Plumbing only; never font data.
 *
 * @remarks
 * `workspace.connect` carries the renderer's sync-lane port as a transferred
 * port, not as payload. Create/open return document lifecycle state only; font
 * records stay on the sync lane. Authored Save is NOT here: it rides the sync
 * lane so FIFO orders it behind edits (see `workspace.save`). Preview conversion
 * is the exception because a preview has no authored renderer lane or edits;
 * `workspace.createFromSource` atomically creates its first canonical document.
 * Main reads `document.state` to decide Save vs Save As and learns save outcomes
 * from the `document.changed` event.
 */
export type ShellCallMap = {
  "workspace.create": { request: void; response: WorkspaceDocumentState };
  "workspace.createFromSource": {
    request: { sourcePath: string; documentPath: string };
    response: WorkspaceDocumentState;
  };
  "workspace.inspectDocument": {
    request: { path: string };
    response: WorkspaceDocumentIdentity;
  };
  "workspace.open": {
    request: { path: string };
    response: WorkspaceDocumentState;
  };
  "workspace.listRecoveries": {
    request: void;
    response: WorkspaceRecovery[];
  };
  "workspace.resume": {
    request: { workspaceId: string };
    response: WorkspaceDocumentState;
  };
  "workspace.close": { request: { discard: boolean }; response: null };
  "source.open": {
    request: { path: string };
    response: FontSourceSession;
  };
  "source.close": { request: void; response: null };
  "workspace.connect": { request: void; response: void };
  "document.state": { request: void; response: WorkspaceDocumentState | null };
  /**
   * Builds the recent-files thumbnail specimen: from the open document's
   * current state, otherwise from the font file at `path`.
   */
  "workspace.specimen": { request: { path: string }; response: Specimen | null };
};

export type SyncCallMap = {
  "workspace.snapshot": { request: void; response: WorkspaceSnapshot | null };
  /** The open workspace's store, for the window's read-only layer reader; `null` for a preview. */
  "workspace.storeLocation": { request: void; response: FontStoreLocation | null };
  /**
   * The open font's directory, every layer a placeholder, as named
   * MessagePack: what the window's engine opens with. `null` for a preview.
   */
  "workspace.directory": { request: void; response: Uint8Array | null };
  "source.snapshot": { request: void; response: FontSourceSnapshot | null };
  "source.glyph": {
    request: { glyphId: GlyphId };
    response: GlyphSnapshot[];
  };
  "source.atlasPagePrepare": {
    request: FontSourceAtlasPageRequest;
    response: CatalogAtlasPage;
  };
  "source.atlasPageStream": {
    request: { generation: number; maximumLength: number };
    response: null;
  };
  "source.atlasPageDiscard": {
    request: { pageIndex: number; generation: number };
    response: null;
  };
  "source.atlasWeights": {
    request: { coordinates: number[] };
    response: CatalogAtlasWeights[];
  };
  "document.state": { request: void; response: WorkspaceDocumentState | null };
  /**
   * The one mutation verb: persists a change set the window's engine already
   * applied, as named MessagePack. The window keeps the undo history; the
   * response is a receipt plus what only the workspace can build (glyph
   * records, dependent composites).
   */
  "workspace.persist": {
    /**
     * `saveState` claims where the change leaves the font; the workspace
     * verifies a claim to match the saved document before discarding unsaved
     * edits.
     */
    request: { changeSet: Uint8Array; saveState: SaveState };
    response: PersistedChange;
  };
  /**
   * Saves to the current canonical document, or rejects when the workspace still
   * needs a path. Rides the edit lane so the utility serializes it behind every
   * committed edit — no cross-lane watermark required.
   */
  "workspace.save": { request: void; response: WorkspaceDocumentState };
  /** Saves to `path` (main's Save As dialog choice) and adopts it as target. */
  "workspace.saveAs": {
    request: { path: string };
    response: WorkspaceDocumentState;
  };
  /**
   * Deletes the stores Save As moved the workspace off, once the window's
   * layer reader has followed it to the new store.
   */
  "workspace.releaseRetiredStores": { request: void; response: null };
  /** Captures the committed workspace and compiles it without changing document state. */
  "workspace.export": {
    request: { path: string };
    response: WorkspaceExportResult;
  };
  "workspace.glyphSnapshots": {
    request: { requests: WorkspaceGlyphSnapshotRequest[] };
    response: GlyphSnapshot[];
  };
  /** Reads exact authored layers in request order; unknown identities reject. */
  "workspace.layers.read": {
    request: { layerIds: LayerId[] };
    response: GlyphLayerSnapshot[];
  };
  /** Reads exact authored layers with composited geometry at each layer's source. */
  "workspace.layers.resolve": {
    request: { layerIds: LayerId[] };
    response: LayerRead[];
  };
  "workspace.layerMatch": {
    request: { referenceLayerId: LayerId; targetLayerId: LayerId };
    response: LayerMatch;
  };
  "workspace.glyphProjections": {
    request: { glyphIds: GlyphId[] };
    response: GlyphProjection[];
  };
  /** Resolves drawable previews (svg path + advance) at one internal location. */
  "workspace.glyphPreviews": {
    request: { glyphIds: GlyphId[]; location: Location };
    response: GlyphPreview[];
  };
  /** Builds one native, location-independent authored Slug generation. */
  "workspace.slugAtlasPrepare": {
    request: { alignment: number };
    response: SlugAtlas;
  };
  /** Opens or builds one fixed root-glyph page and its component closure. */
  "workspace.slugAtlasPagePrepare": {
    request: WorkspaceSlugAtlasPageRequest;
    response: WorkspaceSlugAtlas;
  };
  /** Streams bounded atlas chunks over the transferred response port. */
  "workspace.slugAtlasStream": {
    request: { generation: number; maximumLength: number };
    response: null;
  };
  /** Streams one prepared page over the transferred response port. */
  "workspace.slugAtlasPageStream": {
    request: { generation: number; origin: SlugAtlasOrigin; maximumLength: number };
    response: null;
  };
  /** Releases native CPU residency when adapter initialization is rejected. */
  "workspace.slugAtlasDiscard": {
    request: { generation: number };
    response: null;
  };
  /** Releases one rejected prepared page. */
  "workspace.slugAtlasPageDiscard": {
    request: { generation: number; origin: SlugAtlasOrigin };
    response: null;
  };
  /** Evaluates font-owned independent and cross-axis mappings in Rust. */
  "workspace.mapLocation": { request: Location; response: Location };
  /**
   * Compiles the font's feature code into a shaper font for the editor to
   * shape with; null while the editor already has `knownRevision`.
   */
  "workspace.shaperFont": {
    request: { knownRevision: number | null };
    response: ShaperFont | null;
  };
};
