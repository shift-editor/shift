import type { LayerReaderHost } from "@shared/host/ShiftHost";
import { FontStoreLocation } from "@shared/workspace/protocol";
import type { FontIntent, GlyphId } from "@shift/types";
import {
  loadEngine,
  type EngineEdit,
  type EngineLayer,
  type EngineSession,
} from "@shift/editor/model";
import { engineLayerSource } from "./engineLayerSource";

/**
 * The open session and the reader it loads layers through, which moves with
 * the store. `reader` is null while released, and reopens on the next read.
 */
interface Opened {
  readonly session: EngineSession;
  reader: number | null;
  location: FontStoreLocation;
}

/**
 * The window's editing engine: shift-engine over the workspace's font store,
 * reading layers synchronously through the window's read-only reader.
 *
 * @remarks
 * Every edit the window makes applies here, in the frame it is made, and the
 * engine's layers are what the window shows. An edit opens with
 * {@link beginEdit} and closes with {@link endEdit}, which returns the change
 * set the native workspace persists. Undo and redo run here too, on the
 * engine's own history. {@link reopen} starts over from the store, dropping
 * that history: only after a persist failed.
 */
export class WindowEngine {
  readonly #layers: LayerReaderHost;
  readonly #storeLocation: () => Promise<FontStoreLocation | null>;
  #opened: Opened | null = null;

  constructor(layers: LayerReaderHost, storeLocation: () => Promise<FontStoreLocation | null>) {
    this.#layers = layers;
    this.#storeLocation = storeLocation;
  }

  get isOpen(): boolean {
    return this.#opened !== null;
  }

  /**
   * Opens the engine over the workspace's store as it stands, replacing any
   * session already open.
   *
   * @throws When the workspace has no store to read, as in a preview.
   */
  async reopen(): Promise<void> {
    const location = await this.#storeLocation();
    if (!location) throw new Error("the workspace has no font store to edit");
    const { EngineSession } = await loadEngine();

    const reader = this.#layers.open(location);
    try {
      // The session reads layers only while an edit runs, after this open, so
      // its source can follow the current reader.
      const session = EngineSession.open(
        this.#layers.directory(reader),
        engineLayerSource(this.#layers, () => this.#reader()),
      );
      this.#close();
      this.#opened = { session, reader, location };
    } catch (error) {
      this.#layers.close(reader);
      throw error;
    }
  }

  /**
   * Reads from the workspace's store where it now lives, as after Save As. The
   * session and its history stay: the font is the same, only its file moved.
   */
  async followStore(): Promise<void> {
    const opened = this.#opened;
    const location = await this.#storeLocation();
    if (!opened || !location || FontStoreLocation.equals(location, opened.location)) return;

    const previous = opened.reader;
    opened.reader = this.#layers.open(location);
    opened.location = location;
    if (previous !== null) this.#layers.close(previous);
  }

  /**
   * Closes the reader, keeping the session, so the workspace can delete the
   * store's files: Windows refuses while they are open. The next read reopens it.
   */
  releaseStore(): void {
    const opened = this.#opened;
    if (!opened || opened.reader === null) return;
    this.#layers.close(opened.reader);
    opened.reader = null;
  }

  /** Opens an edit: the applies until {@link endEdit} become one undo step and one change set. */
  beginEdit(): void {
    this.#require().beginEdit();
  }

  /**
   * Applies `intents` within the open edit and returns every layer they
   * touched and the font-level records they changed.
   *
   * @throws When the engine is not open, no edit is open, an intent is
   * invalid, or a read fails.
   */
  apply(intents: readonly FontIntent[]): EngineEdit {
    const session = this.#require();
    performance.mark("engine.apply.start");
    try {
      return session.apply(intents);
    } finally {
      performance.measure("engine.apply", "engine.apply.start");
    }
  }

  /**
   * Every layer applying `intents` would touch, as it would be, without
   * keeping the edit: a gesture's preview, one call per changed frame.
   *
   * @throws As {@link apply}.
   */
  preview(intents: readonly FontIntent[]): EngineLayer[] {
    const session = this.#require();
    performance.mark("engine.preview.start");
    try {
      return session.preview(intents);
    } finally {
      performance.measure("engine.preview", "engine.preview.start");
    }
  }

  /**
   * Closes the open edit as one undo step.
   *
   * @returns Its change set, as named MessagePack, to persist; `undefined`
   * when it changed nothing.
   */
  endEdit(): Uint8Array | undefined {
    return this.#require().endEdit();
  }

  /** Drops the open edit; the engine goes back to where it began. */
  cancelEdit(): void {
    this.#require().cancelEdit();
  }

  /**
   * Takes back the latest edit.
   *
   * @returns What it did, with its change set to persist; `undefined` when
   * there is nothing to undo.
   */
  undo(): EngineEdit | undefined {
    return this.#require().undo();
  }

  /** Makes the latest undone edit again; `undefined` when there is nothing to redo. */
  redo(): EngineEdit | undefined {
    return this.#require().redo();
  }

  /** Forgets every undone edit. */
  discardRedo(): void {
    this.#require().discardRedo();
  }

  /** Records that the font, where the history now stands, is the saved document. */
  markSaved(): void {
    this.#require().markSaved();
  }

  /**
   * Loads what editing `glyphIds` reads when the window is idle, so the first
   * edit loads nothing. A failure is only logged: the edit loads it again.
   */
  preloadWhenIdle(glyphIds: readonly GlyphId[]): void {
    if (glyphIds.length === 0) return;
    const preload = () => {
      const session = this.#opened?.session;
      if (!session) return;
      performance.mark("engine.preload.start");
      try {
        session.preload(glyphIds);
      } catch (error) {
        console.warn("engine preload failed", error);
      } finally {
        performance.measure("engine.preload", "engine.preload.start");
      }
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(preload);
    else setTimeout(preload, 0);
  }

  dispose(): void {
    this.#close();
  }

  #require(): EngineSession {
    return this.#requireOpened().session;
  }

  #requireOpened(): Opened {
    if (!this.#opened) throw new Error("the window's editing engine is not open");
    return this.#opened;
  }

  #reader(): number {
    const opened = this.#requireOpened();
    opened.reader ??= this.#layers.open(opened.location);
    return opened.reader;
  }

  #close(): void {
    if (!this.#opened) return;
    this.#opened.session.dispose();
    this.releaseStore();
    this.#opened = null;
  }
}
