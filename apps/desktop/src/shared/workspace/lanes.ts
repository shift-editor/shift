import type {
  AppliedChange,
  CatalogAtlasPage,
  CatalogAtlasWeights,
  FontSnapshot,
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
import type { LaneMethods } from "./remote";

export type {
  FontSessionMode,
  Specimen,
  WorkspaceDocumentSourceKind,
  WorkspaceDocumentState,
  WorkspaceGlyphLayerSnapshot,
  WorkspaceSnapshot,
} from "@shift/types";

export type WorkspaceGlyphSnapshotRequest = {
  glyphId: GlyphId;
};

/** Process-local origin required to stream or discard one prepared atlas page. */
export type SlugAtlasOrigin = "native" | "cached";

/** Prepared page descriptor paired with its utility-owned byte origin. */
export type WorkspaceSlugAtlas = SlugAtlas & {
  origin: SlugAtlasOrigin;
};

/** One deterministic fixed-page request within the current authored revision. */
export type WorkspaceSlugAtlasPageRequest = {
  glyphIds: GlyphId[];
  alignment: number;
  pageIndex: number;
  pageCount: number;
  replacementPageIndices: number[];
};

/** Recoverable authored workspace discovered under the app-owned documents root. */
export type WorkspaceRecovery =
  | {
      kind: "saved";
      state: "recoverable";
      workspaceId: string;
      documentId: string;
      canonicalPath: string;
    }
  | {
      kind: "unsaved";
      state: "recoverable";
      workspaceId: string;
    };

/** Main-visible identity for one retained, read-only foreign source session. */
export type FontSourceSession = {
  sessionId: string;
  canonicalPath: string;
};

/** Renderer catch-up state for the retained backend of the shared catalog. */
export type FontSourceSnapshot = FontSourceSession & {
  font: FontSnapshot;
};

/** One deterministic page request expressed in source-local glyph indexes. */
export type FontSourceAtlasPageRequest = {
  pageIndex: number;
  glyphIds: GlyphId[];
  coordinates: number[];
  alignment: number;
};

/** Identifies one concrete canonical `.shift` document path. */
export type WorkspaceDocumentIdentity = {
  documentId: string;
  canonicalPath: string;
};

/** Identifies the compiled font written by a workspace export. */
export type WorkspaceExportResult = {
  path: string;
  format: "ttf";
};

/** What the workspace wrote for one persisted change set, and the document state it left. */
export type PersistedChange = {
  applied: AppliedChange;
  documentState: WorkspaceDocumentState;
};

/**
 * Where an open workspace's font store lives, so another process can read
 * it read-only (its directory and layers): a document with its recovery
 * overlay, or the working store behind an untitled or imported workspace.
 */
export type FontStoreLocation =
  | { kind: "document"; documentPath: string; recoveryPath: string }
  | { kind: "working"; storePath: string };

export const FontStoreLocation = {
  /** Whether `a` and `b` name the same store files. */
  equals(a: FontStoreLocation, b: FontStoreLocation | null): boolean {
    if (!b) return false;
    switch (a.kind) {
      case "document":
        return (
          b.kind === "document" &&
          a.documentPath === b.documentPath &&
          a.recoveryPath === b.recoveryPath
        );
      case "working":
        return b.kind === "working" && a.storePath === b.storePath;
    }
  },
};

/**
 * Shell lane: what main asks of the workspace utility process. Plumbing only;
 * never font data.
 *
 * @remarks
 * Create and open return document lifecycle state only; font records stay on
 * the {@link WorkspaceSync} lane. Authored Save is not here: it rides the sync
 * lane so its queue orders it behind edits. Preview conversion is the
 * exception because a preview has no authored window lane or edits;
 * {@link WorkspaceShell.createFromSource} atomically creates its first
 * canonical document. Main reads {@link WorkspaceShell.documentState} to decide
 * Save vs Save As and learns save outcomes from the `document.changed` event.
 *
 * Handing over a window's sync-lane port (`connect`) carries a transferred
 * port, so it is a ported call in `ShellPortCallMap`, not a method here.
 */
export interface WorkspaceShell {
  /**
   * Creates an untitled workspace in a fresh working store.
   *
   * @returns The new workspace's document state.
   * @throws {Error} when a preview or document is already open.
   */
  create(): Promise<WorkspaceDocumentState>;

  /**
   * Fully imports a foreign source and atomically publishes its first Shift
   * document at `documentPath`.
   *
   * @param sourcePath - Font file to import.
   * @param documentPath - Destination `.shift` document; removed again when the import fails.
   * @returns The document state, bound to `documentPath`.
   * @throws {Error} when a preview or document is already open, or the import or save fails.
   */
  createFromSource(sourcePath: string, documentPath: string): Promise<WorkspaceDocumentState>;

  /**
   * Reads a `.shift` document's identity without opening it.
   *
   * @param path - Document to inspect.
   * @returns Its stable document id and canonical path, for reusing a live session.
   * @throws {Error} when `path` is not a readable Shift document.
   */
  inspectDocument(path: string): Promise<WorkspaceDocumentIdentity>;

  /**
   * Opens a `.shift` document, resuming its recovery if one exists, or imports
   * any other font file into a working store.
   *
   * @param path - User-selected source path.
   * @returns The opened workspace's document state.
   * @throws {Error} when a preview or document is already open, or the file cannot be read.
   */
  open(path: string): Promise<WorkspaceDocumentState>;

  /**
   * Lists the recoverable workspaces under the documents root, pruning orphaned storage first.
   *
   * @returns Saved and unsaved recoveries; empty when none.
   */
  listRecoveries(): Promise<WorkspaceRecovery[]>;

  /**
   * Resumes one app-owned working store left behind by an earlier process.
   *
   * @param workspaceId - A workspace id from {@link WorkspaceShell.listRecoveries}.
   * @returns The resumed workspace's document state.
   * @throws {Error} when a preview or document is already open, or the store is missing.
   */
  resume(workspaceId: string): Promise<WorkspaceDocumentState>;

  /**
   * Closes the open workspace and deletes its app-owned storage.
   *
   * @param discard - True only when the user chose to discard unsaved edits.
   * @returns `null` once closed; also when nothing was open.
   * @throws {Error} when the workspace is dirty and `discard` is false.
   */
  close(discard: boolean): Promise<null>;

  /**
   * Opens a font file as a read-only preview, without allocating a workspace.
   *
   * @param path - Font file to preview.
   * @returns The retained source's session identity.
   * @throws {Error} when a preview or document is already open, or the file cannot be read.
   */
  openSource(path: string): Promise<FontSourceSession>;

  /**
   * Closes the open preview.
   *
   * @returns `null` once closed.
   * @throws {Error} when no preview is open.
   */
  closeSource(): Promise<null>;

  /**
   * Reads the open workspace's document lifecycle state.
   *
   * @returns `null` when no workspace document is open.
   */
  documentState(): Promise<WorkspaceDocumentState | null>;

  /**
   * Builds the recent-files thumbnail specimen: from the open document's
   * current state, otherwise from the font file at `path`.
   *
   * @remarks
   * Compiles on a worker thread; the workspace queue is released while it runs.
   *
   * @param path - Font file to read when no document is open.
   * @returns `null` when the font draws nothing usable.
   * @throws {Error} when the font cannot be read or compiled.
   */
  specimen(path: string): Promise<Specimen | null>;
}

/** The methods the shell lane serves. */
export const workspaceShellMethods: LaneMethods<WorkspaceShell> = {
  create: true,
  createFromSource: true,
  inspectDocument: true,
  open: true,
  listRecoveries: true,
  resume: true,
  close: true,
  openSource: true,
  closeSource: true,
  documentState: true,
  specimen: true,
};

/**
 * Sync lane: what a window asks of the workspace it shows.
 *
 * @remarks
 * Every response is the window's next state — states, not acks. Create and
 * open are main-owned {@link WorkspaceShell} operations; the window catches up
 * by reading {@link WorkspaceSync.snapshot}. Calls run in arrival order behind
 * one queue in the workspace, so a save or read never overtakes an earlier
 * edit; the exceptions say so.
 *
 * Streaming atlas bytes carries a transferred response port, so those calls
 * are ported calls in `SyncStreamCallMap`, not methods here.
 */
export interface WorkspaceSync {
  /**
   * Reads the open workspace's font summary for the window's model to open from.
   *
   * @returns `null` when no workspace document is open (a preview, or closed).
   */
  snapshot(): Promise<WorkspaceSnapshot | null>;

  /**
   * Reads where the open workspace's store lives, for the window's read-only layer reader.
   *
   * @returns `null` for a preview, which has no store.
   */
  storeLocation(): Promise<FontStoreLocation | null>;

  /**
   * Reads the open font's directory, every layer a placeholder, as named
   * MessagePack: what the window's engine opens with.
   *
   * @returns `null` for a preview.
   */
  directory(): Promise<Uint8Array | null>;

  /**
   * Reads the open preview's retained font.
   *
   * @returns `null` when no preview is open.
   */
  sourceSnapshot(): Promise<FontSourceSnapshot | null>;

  /**
   * Reads one retained, location-independent preview glyph and its component closure.
   *
   * @param glyphId - Glyph in the open preview.
   * @returns The glyph first, then the glyphs its components reference.
   */
  sourceGlyph(glyphId: GlyphId): Promise<GlyphSnapshot[]>;

  /**
   * Prepares one preview atlas page at dense source coordinates, for streaming.
   *
   * @param request - The page's glyphs, coordinates and alignment.
   * @returns The page descriptor; its generation names it to the stream and discard calls.
   * @throws {Error} when no preview is open.
   */
  prepareSourceAtlasPage(request: FontSourceAtlasPageRequest): Promise<CatalogAtlasPage>;

  /**
   * Releases a prepared preview page rejected before streaming.
   *
   * @param pageIndex - The page's index in its request.
   * @param generation - The prepared page's generation.
   * @returns `null` once released.
   */
  discardSourceAtlasPage(pageIndex: number, generation: number): Promise<null>;

  /**
   * Resolves every retained page's weights at one dense source location.
   *
   * @param coordinates - Dense source coordinates, one per axis.
   * @returns One weight set per prepared page.
   */
  sourceAtlasWeights(coordinates: number[]): Promise<CatalogAtlasWeights[]>;

  /**
   * Reads the open workspace's document lifecycle state.
   *
   * @returns `null` when no workspace document is open.
   */
  documentState(): Promise<WorkspaceDocumentState | null>;

  /**
   * Persists a change set the window's engine already applied: the one mutation verb.
   *
   * @remarks
   * The window keeps the undo history. Emits `document.changed`.
   *
   * @param changeSet - The change set as named MessagePack.
   * @param saveState - Where the change claims to leave the font; the workspace
   *   verifies a claim to match the saved document before discarding unsaved edits.
   * @returns A receipt plus what only the workspace can build (glyph records,
   *   dependent composites), and the document state it left.
   * @throws {Error} when the change set does not match the font or cannot be written.
   */
  persist(changeSet: Uint8Array, saveState: SaveState): Promise<PersistedChange>;

  /**
   * Saves to the current canonical document.
   *
   * @remarks
   * Rides the edit lane so the workspace serializes it behind every persisted
   * edit — no cross-lane watermark required. Emits `document.changed`.
   *
   * @returns The saved document state.
   * @throws {Error} when the workspace still needs a path.
   */
  save(): Promise<WorkspaceDocumentState>;

  /**
   * Saves to `path` (main's Save As dialog choice) and adopts it as the target.
   *
   * @remarks
   * The stores the workspace moved off stay until
   * {@link WorkspaceSync.releaseRetiredStores}. Emits `document.changed`.
   *
   * @param path - Destination `.shift` document.
   * @returns The document state, bound to `path`.
   * @throws {Error} when no document is open or the document cannot be written;
   *   the previous binding is kept.
   */
  saveAs(path: string): Promise<WorkspaceDocumentState>;

  /**
   * Deletes the stores Save As moved the workspace off, once the window's
   * layer reader has followed it to the new store.
   *
   * @remarks
   * A store that cannot be deleted yet (still held open) is retried on the
   * next release, or removed with the workspace on close.
   *
   * @returns `null` once attempted.
   */
  releaseRetiredStores(): Promise<null>;

  /**
   * Captures the committed workspace and compiles it, without changing document state.
   *
   * @remarks
   * The capture waits behind earlier edits; compiling releases the queue.
   *
   * @param path - Destination selected by the user; must end in `.ttf`.
   * @returns The written font's path and format.
   * @throws {Error} when compilation fails.
   */
  export(path: string): Promise<WorkspaceExportResult>;

  /**
   * Reads replace-grade glyph snapshots by stable glyph id.
   *
   * @param requests - Glyphs to read.
   * @returns One snapshot per requested glyph, in request order.
   * @throws {Error} when a glyph is not in the font.
   */
  glyphSnapshots(requests: WorkspaceGlyphSnapshotRequest[]): Promise<GlyphSnapshot[]>;

  /**
   * Reads exact authored layers by stable identity.
   *
   * @param layerIds - Layer identities in the order results should follow.
   * @returns One accepted-state snapshot per requested layer.
   * @throws {Error} when any layer identity is not in the font.
   */
  readLayers(layerIds: LayerId[]): Promise<GlyphLayerSnapshot[]>;

  /**
   * Reads exact authored layers with composited geometry at each layer's source.
   *
   * @param layerIds - Layer identities in the order results should follow.
   * @returns One authored snapshot and resolved geometry per requested layer.
   * @throws {Error} when any layer identity is not in the font or a component cannot resolve.
   */
  resolveLayers(layerIds: LayerId[]): Promise<LayerRead[]>;

  /**
   * Derives cross-layer entity matches between two layers.
   *
   * @param referenceLayerId - Layer whose entities are matched from.
   * @param targetLayerId - Layer whose entities are matched to.
   * @returns The match of each reference entity in the target.
   */
  layerMatch(referenceLayerId: LayerId, targetLayerId: LayerId): Promise<LayerMatch>;

  /**
   * Reads compact glyph projection models and their component dependencies.
   *
   * @param glyphIds - Stable root glyph identities.
   * @returns Location-independent models for synchronous evaluation in the window.
   */
  glyphProjections(glyphIds: GlyphId[]): Promise<GlyphProjection[]>;

  /**
   * Resolves drawable glyph previews (svg path and advance) at one internal location.
   *
   * @param glyphIds - Stable glyph identities.
   * @param location - Internal location; axis mappings must already be evaluated.
   * @returns One preview per resolvable glyph; missing ids are omitted.
   */
  glyphPreviews(glyphIds: GlyphId[], location: Location): Promise<GlyphPreview[]>;

  /**
   * Builds one native, location-independent authored Slug generation, for streaming.
   *
   * @param alignment - Byte alignment of the atlas's sections.
   * @returns The atlas descriptor; its generation names it to the stream and discard calls.
   */
  prepareSlugAtlas(alignment: number): Promise<SlugAtlas>;

  /**
   * Opens a cached page, or builds one fixed root-glyph page and its component closure.
   *
   * @param request - The page's glyphs and its place in the current build.
   * @returns The page descriptor with the origin its stream and discard calls need.
   * @throws {Error} when no document is open.
   */
  prepareSlugAtlasPage(request: WorkspaceSlugAtlasPageRequest): Promise<WorkspaceSlugAtlas>;

  /**
   * Releases native CPU residency of an atlas rejected before streaming.
   *
   * @param generation - The prepared atlas's generation.
   * @returns `null` once released.
   */
  discardSlugAtlas(generation: number): Promise<null>;

  /**
   * Releases one prepared page rejected before streaming.
   *
   * @param generation - The prepared page's generation.
   * @param origin - Where the page's bytes come from.
   * @returns `null` once released.
   */
  discardSlugAtlasPage(generation: number, origin: SlugAtlasOrigin): Promise<null>;

  /**
   * Evaluates the font's independent and cross-axis mappings in Rust.
   *
   * @param location - External location keyed by stable axis id.
   * @returns The mapped location, with omitted axes filled from their defaults.
   */
  mapLocation(location: Location): Promise<Location>;

  /**
   * Compiles the font's feature code into a shaper font for the window to shape with.
   *
   * @remarks
   * Not queued: a synchronous read, so it never waits behind a save or import.
   *
   * @param knownRevision - The revision the window already has, or `null`.
   * @returns `null` while `knownRevision` is still current.
   */
  shaperFont(knownRevision: number | null): Promise<ShaperFont | null>;
}

/** The methods the sync lane serves. */
export const workspaceSyncMethods: LaneMethods<WorkspaceSync> = {
  snapshot: true,
  storeLocation: true,
  directory: true,
  sourceSnapshot: true,
  sourceGlyph: true,
  prepareSourceAtlasPage: true,
  discardSourceAtlasPage: true,
  sourceAtlasWeights: true,
  documentState: true,
  persist: true,
  save: true,
  saveAs: true,
  releaseRetiredStores: true,
  export: true,
  glyphSnapshots: true,
  readLayers: true,
  resolveLayers: true,
  layerMatch: true,
  glyphProjections: true,
  glyphPreviews: true,
  prepareSlugAtlas: true,
  prepareSlugAtlasPage: true,
  discardSlugAtlas: true,
  discardSlugAtlasPage: true,
  mapLocation: true,
  shaperFont: true,
};
