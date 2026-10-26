import type {
  AppliedChange,
  SaveState,
  FontIntent,
  GlyphId,
  GlyphLayerSnapshot,
  GlyphPreview,
  GlyphProjection,
  GlyphSnapshot,
  GlyphState,
  LayerId,
  LayerMatch,
  LayerRead,
  Location,
  ParagraphRequest,
  ShapedRun,
  ShaperFont,
  SlugAtlas,
} from "@shift/types";
import type {
  WorkspaceDocumentState,
  WorkspaceExportResult,
  SlugAtlasOrigin,
  WorkspaceGlyphSnapshotRequest,
  WorkspaceSlugAtlas,
  WorkspaceSlugAtlasPageRequest,
} from "@shared/workspace/protocol";
import { batch, signal, type Signal, type WritableSignal } from "@shift/editor/signals";
import type { EngineEdit, EngineLayer, FontStore } from "@shift/editor/model";
import type { PendingEditId, WorkspaceEditEvent, WorkspaceEditListener } from "@shift/editor/types";
import type { WorkspaceApplyStatus, WorkspaceEdit } from "@/types/workspace";
import type { FontSessionClient } from "./FontSessionClient";
import type { WindowEngine } from "../engine/WindowEngine";

export type { WorkspaceApplyStatus } from "@/types/workspace";

/** The receipt for an edit that changed nothing, so nothing was persisted. */
const UNCHANGED: AppliedChange = { layers: [], dependents: [] };

/**
 * Applies the window's edits through its editing engine, then sends them to
 * the utility workspace to persist, in order.
 *
 * @remarks
 * Each edit applies in the window's engine first, in the frame it is made, and
 * the layers it touched are shown at once; an edit the engine rejects is never
 * sent. The workspace applies the same intents with the same shift-font code
 * and persists them, so its echo only adds what the engine cannot build: glyph
 * records and projections to rebuild. Undo and redo are the only
 * changes the engine did not make; their echo carries the change set the
 * workspace replayed, and the engine replays it too.
 *
 * Every editing verb pushes one operation by default. Use
 * {@link transaction} to group multiple intents into one `workspace.apply`,
 * one SQLite transaction, and one undo step. The coordinator assigns opaque
 * pending identities but never interprets intent envelopes or mutates layer
 * state. Undo, redo, snapshot reads, and save are serialized through the same
 * queue so none can overtake a committed edit.
 *
 * Save ownership lives in the utility. The renderer issues save as one more op
 * on this queue (see {@link save}); because it shares the FIFO edit lane, the
 * utility serializes the write behind every committed edit with no cross-lane
 * watermark.
 */
export class WorkspaceEditCoordinator {
  readonly #session: FontSessionClient;
  readonly #store: FontStore;
  readonly #engine: WindowEngine;
  readonly #settledCell: WritableSignal<boolean>;
  readonly #applyStatus: WritableSignal<WorkspaceApplyStatus>;
  readonly #authoredRevisionCell: WritableSignal<number>;
  // non-reactive: subscriber registry; listeners are invoked imperatively, never read in computeds
  readonly #editListeners = new Set<WorkspaceEditListener>();

  #chain: Promise<unknown> = Promise.resolve();
  #busy = 0;
  #nextEditId = 1;
  #transaction: {
    readonly id: PendingEditId;
    readonly label: string;
    /** Each resident layer's state before the transaction first changed it. */
    readonly before: Map<LayerId, GlyphState>;
  } | null = null;

  constructor(session: FontSessionClient, store: FontStore, engine: WindowEngine) {
    this.#session = session;
    this.#store = store;
    this.#engine = engine;
    this.#settledCell = signal(true);
    this.#applyStatus = signal<WorkspaceApplyStatus>("idle", {
      name: "workspace.applyStatus",
    });
    this.#authoredRevisionCell = signal(0, { name: "workspace.authoredRevision" });
  }

  /**
   * False while any intent is queued or in flight. Drives the dirty
   * indicator: un-echoed state must never read as durable.
   */
  get settledCell(): Signal<boolean> {
    return this.#settledCell;
  }

  /**
   * Returns the workspace-apply lifecycle for locally-authored edits.
   *
   * @remarks
   * This is intentionally separate from utility-owned `documentState.dirty`.
   * It covers the short window after a tool commits an edit locally but before
   * the utility process has echoed the new dirty state.
   */
  get applyStatusCell(): Signal<WorkspaceApplyStatus> {
    return this.#applyStatus;
  }

  /** Returns the session-local sequence of authored font state transitions. */
  get authoredRevisionCell(): Signal<number> {
    return this.#authoredRevisionCell;
  }

  /**
   * Applies one intent in the window's engine, shows the result, and queues it
   * for the workspace.
   *
   * @returns The edit's renderer-local pending identity.
   * @throws When the engine rejects the intent; nothing is shown or sent.
   */
  push(intent: FontIntent): PendingEditId {
    const transaction = this.#transaction;
    if (transaction) {
      this.#applyInEngine([intent], transaction.before);
      return transaction.id;
    }

    // Readers of the shown layers run when the batch ends, so any read they
    // queue on the workspace lane follows this edit rather than overtaking it.
    return batch(() => {
      const id = this.#mintPendingEditId();
      this.#enqueuePersist(this.#applyEdit([intent]), undefined, id);
      return id;
    });
  }

  /**
   * Every layer `intents` would touch, as they would leave it, worked out by
   * the window's engine without keeping the edit or sending it: a gesture's
   * preview.
   *
   * @throws When the engine rejects the intents.
   */
  preview(intents: readonly FontIntent[]): EngineLayer[] {
    return this.#engine.preview(intents);
  }

  /**
   * Groups synchronous edit intents into one workspace operation.
   *
   * @remarks
   * Calls to {@link push} inside `body` are buffered and committed as one apply
   * after the outermost transaction returns. Transactions are synchronous;
   * callers must complete all edits before returning.
   *
   * @param label - Human-readable operation name for diagnostics and future ledger labels.
   * @param body - Synchronous edit body that may call layer mutation APIs.
   * @returns The value returned by `body`.
   * @throws {Error} when `body` returns a Promise.
   */
  transaction<TResult>(label: string, body: () => TResult): TResult {
    const active = this.#transaction;
    if (active) {
      return this.#runTransactionBody(label, body);
    }

    const id = this.#mintPendingEditId();
    const before = new Map<LayerId, GlyphState>();
    this.#transaction = { id, label, before };
    this.#engine.beginEdit();
    const records = this.#store.recordsCheckpoint();

    return batch(() => {
      try {
        const result = this.#runTransactionBody(label, body);
        const transaction = this.#transaction;
        if (!transaction) throw new Error("workspace transaction ended without an active edit");

        this.#transaction = null;
        this.#enqueuePersist(this.#engine.endEdit(), transaction.label, transaction.id);
        return result;
      } catch (error) {
        // The workspace never saw the transaction: take it back in the engine
        // and show each layer as it was.
        this.#transaction = null;
        this.#engine.cancelEdit();
        this.#store.restoreRecords(records);
        this.#store.publishLayers(before.values().toArray());
        throw error;
      }
    });
  }

  #runTransactionBody<TResult>(label: string, body: () => TResult): TResult {
    const result = body();

    if (result instanceof Promise) {
      throw new Error(`workspace transaction "${label}" must be synchronous`);
    }

    return result;
  }

  /**
   * Subscribes to accepted, committed, and failed renderer-authored edits.
   *
   * @param listener - Synchronous observer called in workspace queue order.
   * @returns an idempotent function that removes the observer.
   */
  onEdit(listener: WorkspaceEditListener): () => void {
    this.#editListeners.add(listener);
    return () => this.#editListeners.delete(listener);
  }

  /** Resolves when every queued and in-flight operation has settled. */
  async settled(): Promise<void> {
    this.#assertNoTransaction("settle workspace edits");

    while (this.#busy > 0) {
      await this.#chain;
    }
  }

  /**
   * Flushes queued edits, then commits an awaited intent set as one operation.
   *
   * @param intents - Complete set of edits to commit together.
   * @param label - Optional human-readable name for the undo operation.
   * @returns The committed replacement state echoed by the workspace.
   * @throws {Error} when the workspace rejects or cannot persist this edit.
   */
  apply(intents: FontIntent[], label?: string): Promise<AppliedChange> {
    this.#assertNoTransaction("apply workspace edits");
    try {
      // As in `push`, readers of the shown layers queue behind this edit.
      return batch(() => {
        const changeSet = this.#applyEdit(intents);
        if (!changeSet) return Promise.resolve(UNCHANGED);
        const edit = this.#acceptEdit(changeSet, label, this.#mintPendingEditId());
        return this.#serialize(() => this.#commitEdit(edit));
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Takes back the latest edit in the window's engine, shows it, and persists
   * it like any other edit.
   *
   * @returns The workspace's receipt; null when there is nothing to undo.
   */
  undo(): Promise<AppliedChange | null> {
    this.#assertNoTransaction("undo");
    return this.#persistReplay(() => this.#engine.undo());
  }

  /**
   * Pulls replace-grade glyph snapshots by glyph id, serialized behind pending
   * writes. A glyph the window loads to show is one it may edit next, so the
   * engine loads what editing it reads while the window is idle.
   */
  async readGlyphSnapshots(
    requests: readonly WorkspaceGlyphSnapshotRequest[],
  ): Promise<GlyphSnapshot[]> {
    if (requests.length === 0) return [];
    const snapshots = await this.#withFlush(() => this.#session.glyphSnapshots(requests));
    this.#engine.preloadWhenIdle(requests.map((request) => request.glyphId));
    return snapshots;
  }

  /** Pulls reusable glyph projection models behind pending authored edits. */
  async readGlyphProjections(glyphIds: readonly GlyphId[]): Promise<GlyphProjection[]> {
    if (glyphIds.length === 0) return [];

    return this.#withFlush(() => this.#session.glyphProjections(glyphIds));
  }

  /** Reads exact authored layers behind pending authored edits. */
  async readLayers(layerIds: readonly LayerId[]): Promise<GlyphLayerSnapshot[]> {
    if (layerIds.length === 0) return [];

    return this.#withFlush(() => this.#session.readLayers(layerIds));
  }

  /** Reads exact authored layers with composited geometry behind pending authored edits. */
  async resolveLayers(layerIds: readonly LayerId[]): Promise<LayerRead[]> {
    if (layerIds.length === 0) return [];

    return this.#withFlush(() => this.#session.resolveLayers(layerIds));
  }

  /** Derives cross-layer entity matches behind pending authored edits. */
  matchLayers(referenceLayerId: LayerId, targetLayerId: LayerId): Promise<LayerMatch> {
    return this.#withFlush(() => this.#session.layerMatch(referenceLayerId, targetLayerId));
  }

  /** Pulls drawable previews at one internal location behind pending edits. */
  async readGlyphPreviews(
    glyphIds: readonly GlyphId[],
    location: Location,
  ): Promise<GlyphPreview[]> {
    if (glyphIds.length === 0) return [];

    return this.#withFlush(() => this.#session.glyphPreviews(glyphIds, location));
  }

  /** Builds one authored Slug generation behind every pending edit. */
  prepareSlugAtlas(alignment: number): Promise<SlugAtlas> {
    return this.#withFlush(() => this.#session.prepareSlugAtlas(alignment));
  }

  /** Opens or builds one deterministic root-glyph page behind every pending edit. */
  prepareSlugAtlasPage(request: WorkspaceSlugAtlasPageRequest): Promise<WorkspaceSlugAtlas> {
    return this.#withFlush(() => this.#session.prepareSlugAtlasPage(request));
  }

  /** Streams a prepared generation without constructing a contiguous JS atlas. */
  streamSlugAtlas(
    generation: number,
    maximumLength: number,
    write: (offset: number, bytes: Uint8Array<ArrayBuffer>) => void,
  ): Promise<number> {
    return this.#withFlush(() => this.#session.streamSlugAtlas(generation, maximumLength, write));
  }

  /** Streams one prepared page without constructing a contiguous JS atlas. */
  streamSlugAtlasPage(
    generation: number,
    origin: SlugAtlasOrigin,
    maximumLength: number,
    write: (offset: number, bytes: Uint8Array<ArrayBuffer>) => void,
  ): Promise<number> {
    return this.#withFlush(() =>
      this.#session.streamSlugAtlasPage(generation, origin, maximumLength, write),
    );
  }

  /** Releases native atlas residency after device/limit rejection. */
  discardSlugAtlas(generation: number): Promise<void> {
    return this.#withFlush(() => this.#session.discardSlugAtlas(generation));
  }

  /** Releases one rejected prepared page. */
  discardSlugAtlasPage(generation: number, origin: SlugAtlasOrigin): Promise<void> {
    return this.#withFlush(() => this.#session.discardSlugAtlasPage(generation, origin));
  }

  /**
   * Evaluates a location behind all pending axis and mapping edits.
   *
   * @param location - External location keyed by stable axis id.
   * @returns The mapped location after queued edits have settled.
   */
  mapLocation(location: Location): Promise<Location> {
    return this.#withFlush(() => this.#session.mapLocation(location));
  }

  /**
   * Shapes paragraphs behind pending edits, so new glyphs and Unicode values are seen.
   *
   * @returns Each paragraph's runs, in request order.
   */
  shapeParagraphs(paragraphs: readonly ParagraphRequest[]): Promise<ShapedRun[][]> {
    return this.#withFlush(() => this.#session.shapeParagraphs(paragraphs));
  }

  /**
   * Returns the shaper font behind pending edits, so new glyphs and feature
   * code are compiled in; null while `knownRevision` is still current.
   */
  shaperFont(knownRevision: number | null): Promise<ShaperFont | null> {
    return this.#withFlush(() => this.#session.shaperFont(knownRevision));
  }

  /** Makes the latest undone edit again, as {@link undo} takes one back. */
  redo(): Promise<AppliedChange | null> {
    this.#assertNoTransaction("redo");
    return this.#persistReplay(() => this.#engine.redo());
  }

  /** Forgets every undone edit, without changing the font. */
  discardRedo(): Promise<void> {
    this.#engine.discardRedo();
    return Promise.resolve();
  }

  /** Reads document state behind every queued and in-flight edit. */
  state(): Promise<WorkspaceDocumentState | null> {
    return this.#withFlush(() => this.#session.documentState());
  }

  /**
   * Issues a save behind every queued and in-flight committed op.
   *
   * @param path - target path for Save As, or null to save the current target.
   */
  save(path: string | null): Promise<WorkspaceDocumentState> {
    return this.#withFlush(async () => {
      const state = await (path === null ? this.#session.save() : this.#session.saveAs(path));
      this.#engine.markSaved();
      // Saving can move the store the engine reads, as when a working store becomes a document.
      await this.#engine.followStore();
      // Only once the engine reads the new store can the workspace delete the old one.
      if (path !== null) await this.#session.releaseRetiredStores();
      return state;
    });
  }

  /**
   * Closes the engine's reader behind every queued and in-flight edit, so the
   * workspace can delete the store's files as it closes. A later read reopens it.
   */
  releaseStore(): Promise<null> {
    return this.#withFlush(() => {
      this.#engine.releaseStore();
      return Promise.resolve(null);
    });
  }

  /**
   * Captures an export after pending edits, then releases the edit lane while compilation runs.
   *
   * @param path - destination selected by the user; must end in `.ttf`.
   * @returns the compiled output identity after its atomic write completes.
   * @throws {Error} when a transaction is open or compilation fails.
   */
  async export(path: string): Promise<WorkspaceExportResult> {
    const { completion } = await this.#withFlush(() => this.#session.startExport(path));
    return completion;
  }

  #withFlush<T>(job: () => Promise<T>): Promise<T> {
    this.#assertNoTransaction("run a serialized workspace operation");
    return this.#serialize(job);
  }

  /** Applies `intents` in the engine as one edit and closes it; its change set, if it changed anything. */
  #applyEdit(intents: readonly FontIntent[]): Uint8Array | undefined {
    this.#engine.beginEdit();
    try {
      this.#applyInEngine(intents, null);
    } catch (error) {
      this.#engine.cancelEdit();
      throw error;
    }
    return this.#engine.endEdit();
  }

  /** Shows an undo or redo the engine made and persists its change set. */
  #persistReplay(replay: () => EngineEdit | undefined): Promise<AppliedChange | null> {
    try {
      return batch(() => {
        const replayed = replay();
        if (!replayed?.changeSet) return Promise.resolve(null);
        this.#store.applyEngineEdit(replayed);
        // An undo or redo is not a new edit: persist it without announcing it.
        const id = this.#mintPendingEditId();
        const saveState = replayed.matchesSaved ? "matchesSaved" : "unsaved";
        const edit = this.#acceptEdit(replayed.changeSet, undefined, id, "replay", saveState);
        return this.#serialize(() => this.#commitEdit(edit));
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  #enqueuePersist(
    changeSet: Uint8Array | undefined,
    label: string | undefined,
    id: PendingEditId,
  ): void {
    if (!changeSet) return;

    const edit = this.#acceptEdit(changeSet, label, id);
    void this.#serialize(() => this.#commitQueuedEdit(edit));
  }

  #acceptEdit(
    changeSet: Uint8Array,
    label: string | undefined,
    id: PendingEditId,
    origin: WorkspaceEdit["origin"] = "edit",
    saveState: SaveState = "unsaved",
  ): WorkspaceEdit {
    const edit: WorkspaceEdit = {
      id,
      changeSet,
      origin,
      saveState,
      ...(label === undefined ? {} : { label }),
    };

    batch(() => {
      this.#settledCell.set(false);
      this.#advanceAuthoredRevision();
      if (this.#applyStatus.peek() === "idle") {
        this.#applyStatus.set("queued");
      }
    });
    if (origin === "edit") this.#notifyEdit({ kind: "accepted", id });
    return edit;
  }

  #mintPendingEditId(): PendingEditId {
    const id = this.#nextEditId as PendingEditId;
    this.#nextEditId += 1;
    return id;
  }

  async #commitQueuedEdit(edit: WorkspaceEdit): Promise<void> {
    try {
      await this.#commitEdit(edit);
    } catch (error) {
      console.error("workspace apply failed; resynced from truth", error);
    }
  }

  async #commitEdit(edit: WorkspaceEdit): Promise<AppliedChange> {
    let applied: AppliedChange;
    try {
      applied = await this.#sendEdit(edit);
    } catch (error) {
      try {
        await this.#resync();
        this.#advanceAuthoredRevision();
      } finally {
        if (edit.origin === "edit") this.#notifyEdit({ kind: "failed", id: edit.id, error });
      }
      throw error;
    }

    if (edit.origin === "edit") this.#notifyEdit({ kind: "committed", id: edit.id });
    return applied;
  }

  async #sendEdit(edit: WorkspaceEdit): Promise<AppliedChange> {
    this.#applyStatus.set("applying");
    const applied = await this.#session.persist(edit.changeSet, edit.saveState);
    await this.#confirm(applied);
    return applied;
  }

  #notifyEdit(event: WorkspaceEditEvent): void {
    for (const listener of this.#editListeners) {
      try {
        listener(event);
      } catch (error) {
        console.error("workspace edit listener failed", error);
      }
    }
  }

  #serialize<T>(job: () => Promise<T>): Promise<T> {
    this.#busy += 1;

    const run = this.#chain.then(job);
    this.#chain = run.then(
      () => this.#afterJob(),
      () => this.#afterJob(),
    );

    return run;
  }

  async #confirm(applied: AppliedChange): Promise<void> {
    const glyphIds = this.#store.confirmEdit(applied);
    if (glyphIds.length === 0) return;

    const projections = await this.#session.glyphProjections(glyphIds);
    this.#store.replaceGlyphProjections(glyphIds, projections);
  }

  /**
   * Applies `intents` in the engine and shows what they did: every layer they
   * touched and the font-level records they changed. With `before`, records
   * each layer's state before its first change, for a transaction to restore.
   */
  #applyInEngine(intents: readonly FontIntent[], before: Map<LayerId, GlyphState> | null): void {
    const previous = this.#store.applyEngineEdit(this.#engine.apply(intents));
    if (!before) return;
    for (const state of previous) {
      if (!before.has(state.layerId)) before.set(state.layerId, state);
    }
  }

  #afterJob(): void {
    this.#busy -= 1;
    if (this.#busy === 0) {
      this.#settledCell.set(true);
      this.#applyStatus.set("idle");
    }
  }

  #advanceAuthoredRevision(): void {
    const revision = this.#authoredRevisionCell.peek() + 1;
    if (!Number.isSafeInteger(revision)) throw new Error("authored revision overflow");
    this.#authoredRevisionCell.set(revision);
  }

  #assertNoTransaction(action: string): void {
    const transaction = this.#transaction;
    if (!transaction) return;

    throw new Error(`cannot ${action} while workspace transaction "${transaction.label}" is open`);
  }

  /** Recovery: discard loaded projections, reload the workspace summary, and reopen the engine. */
  async #resync(): Promise<void> {
    this.#store.replaceWorkspace(await this.#session.snapshot());
    await this.reopenEngine();
  }

  /**
   * Opens the window's engine over the workspace's store as it stands, with a
   * new history that starts saved when the document has no unsaved edits.
   */
  async reopenEngine(): Promise<void> {
    await this.#engine.reopen();
    const state = await this.#session.documentState();
    if (state && !state.dirty) this.#engine.markSaved();
  }
}
