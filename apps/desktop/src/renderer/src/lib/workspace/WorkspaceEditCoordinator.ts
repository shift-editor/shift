import type {
  AppliedChange,
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
import type { EngineLayer, FontStore, WorkspaceFold } from "@shift/editor/model";
import type { PendingEditId, WorkspaceEditEvent, WorkspaceEditListener } from "@shift/editor/types";
import type { WorkspaceApplyStatus, WorkspaceEdit } from "@/types/workspace";
import type { FontSessionClient } from "./FontSessionClient";
import type { WindowEngine } from "../engine/WindowEngine";

export type { WorkspaceApplyStatus } from "@/types/workspace";

/**
 * Applies the window's edits through its editing engine, then sends them to
 * the utility workspace to persist, in order.
 *
 * @remarks
 * Each edit applies in the window's engine first, in the frame it is made, and
 * the layers it touched are shown at once; an edit the engine rejects is never
 * sent. The workspace's echo then confirms it: a layer that matches what the
 * engine showed stays, and one that differs takes the echo while the engine
 * drops that glyph and reloads it on the next edit. Echoes the engine did not
 * make (undo, redo) are shown as they come, and the engine drops what they
 * touched.
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
  // non-reactive: the layers the engine showed for each edit awaiting its echo; read only when that echo folds
  readonly #shown = new Map<PendingEditId, Map<LayerId, EngineLayer>>();
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
    readonly intents: FontIntent[];
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
      this.#applyInEngine(transaction.id, [intent], transaction.before);
      transaction.intents.push(intent);
      return transaction.id;
    }

    // Readers of the shown layers run when the batch ends, so any read they
    // queue on the workspace lane follows this edit rather than overtaking it.
    return batch(() => {
      const id = this.#mintPendingEditId();
      this.#applyInEngine(id, [intent], null);
      return this.#enqueueApply([intent], undefined, id);
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
    this.#transaction = { id, label, intents: [], before };

    return batch(() => {
      try {
        const result = this.#runTransactionBody(label, body);
        const transaction = this.#transaction;
        if (!transaction) throw new Error("workspace transaction ended without an active edit");

        this.#transaction = null;
        this.#enqueueApply(transaction.intents, transaction.label, transaction.id);
        return result;
      } catch (error) {
        this.#transaction = null;
        this.#undoInEngine(id, before);
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
        const id = this.#mintPendingEditId();
        this.#applyInEngine(id, intents, null);
        const edit = this.#acceptEdit(intents, label, id);
        return this.#serialize(() => this.#commitEdit(edit));
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** Replays the latest undo entry after pending pushes flush. */
  undo(): Promise<AppliedChange | null> {
    return this.#withFlush(async () => {
      const applied = await this.#session.undo();
      if (applied) {
        await this.#applyChange(applied, null);
        this.#advanceAuthoredRevision();
      }
      return applied;
    });
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

  /** Replays the latest redo entry after pending pushes flush. */
  redo(): Promise<AppliedChange | null> {
    return this.#withFlush(async () => {
      const applied = await this.#session.redo();
      if (applied) {
        await this.#applyChange(applied, null);
        this.#advanceAuthoredRevision();
      }
      return applied;
    });
  }

  /** Permanently removes the current redo branch after pending operations settle. */
  discardRedo(): Promise<void> {
    return this.#withFlush(() => this.#session.discardRedo());
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
      // Saving can move the store the engine reads, as when a working store becomes a document.
      await this.#engine.followStore();
      return state;
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

  #enqueueApply(
    intents: FontIntent[],
    label?: string,
    id: PendingEditId = this.#mintPendingEditId(),
  ): PendingEditId {
    if (intents.length === 0) return id;

    const edit = this.#acceptEdit(intents, label, id);
    void this.#serialize(() => this.#commitQueuedEdit(edit));
    return edit.id;
  }

  #acceptEdit(
    intents: FontIntent[],
    label?: string,
    id = this.#mintPendingEditId(),
  ): WorkspaceEdit {
    const edit: WorkspaceEdit = {
      id,
      intents: [...intents],
      ...(label === undefined ? {} : { label }),
    };

    batch(() => {
      this.#settledCell.set(false);
      this.#advanceAuthoredRevision();
      if (this.#applyStatus.peek() === "idle") {
        this.#applyStatus.set("queued");
      }
    });
    this.#notifyEdit({ kind: "accepted", id });
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
      this.#takeShown(edit.id);
      try {
        await this.#resync();
        this.#advanceAuthoredRevision();
      } finally {
        this.#notifyEdit({ kind: "failed", id: edit.id, error });
      }
      throw error;
    }

    this.#notifyEdit({ kind: "committed", id: edit.id });
    return applied;
  }

  async #sendEdit(edit: WorkspaceEdit): Promise<AppliedChange> {
    this.#applyStatus.set("applying");
    const applied = await this.#session.apply(edit.intents, edit.label);
    await this.#applyChange(applied, edit.id);
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

  async #applyChange(applied: AppliedChange, editId: PendingEditId | null): Promise<void> {
    let fold: WorkspaceFold;
    if (editId !== null) {
      fold = this.#store.confirmEdit(editId, applied, this.#takeShown(editId));
      this.#engine.evict(fold.staleGlyphIds);
    } else {
      fold = this.#store.applyWorkspaceChange(applied);
      // Undo and redo can add or remove glyphs, sources and axes, which only a
      // fresh directory knows; otherwise dropping the touched glyphs is enough.
      if (applied.next?.glyphs || applied.next?.sources || applied.next?.axes) {
        await this.#engine.reopen();
      } else {
        this.#engine.evict(fold.staleGlyphIds);
      }
    }
    const glyphIds = fold.projectionGlyphIds;
    if (glyphIds.length === 0) return;

    const projections = await this.#session.glyphProjections(glyphIds);
    this.#store.replaceGlyphProjections(glyphIds, projections);
  }

  /**
   * Applies `intents` in the engine as part of edit `id`, shows every layer
   * they touched, and keeps what was shown for the echo to confirm. With
   * `before`, records each layer's state before its first change, for a
   * transaction to restore.
   */
  #applyInEngine(
    id: PendingEditId,
    intents: readonly FontIntent[],
    before: Map<LayerId, GlyphState> | null,
  ): void {
    const layers = this.#engine.apply(intents);
    if (layers.length === 0) return;

    const previous = this.#store.publishLayers(layers);
    if (before) {
      for (const state of previous) {
        if (!before.has(state.layerId)) before.set(state.layerId, state);
      }
    }
    let shown = this.#shown.get(id);
    if (!shown) {
      shown = new Map();
      this.#shown.set(id, shown);
    }
    for (const layer of layers) shown.set(layer.layerId, layer);
  }

  /**
   * Takes back a transaction the engine applied but the workspace never saw:
   * shows each layer as it was, and drops the touched glyphs from the engine
   * so it reloads them from the store.
   */
  #undoInEngine(id: PendingEditId, before: ReadonlyMap<LayerId, GlyphState>): void {
    const shown = this.#takeShown(id);
    this.#store.rollbackEdit(id);
    this.#store.publishLayers(before.values().toArray());

    const glyphIds = new Set<GlyphId>();
    for (const layerId of shown.keys()) {
      const glyphId = this.#store.glyphIdForLayer(layerId);
      if (glyphId) glyphIds.add(glyphId);
    }
    this.#engine.evict([...glyphIds]);
  }

  /** The layers the engine showed for edit `id`, forgotten as they are returned. */
  #takeShown(id: PendingEditId): ReadonlyMap<LayerId, EngineLayer> {
    const shown = this.#shown.get(id);
    this.#shown.delete(id);
    return shown ?? new Map();
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
    await this.#engine.reopen();
  }
}
