import type { LayerReaderHost } from "@shared/host/ShiftHost";
import { sameFontStoreLocation, type FontStoreLocation } from "@shared/workspace/protocol";
import type { FontIntent, GlyphId } from "@shift/types";
import { loadEngine, type EngineLayer, type EngineSession } from "@shift/editor/model";
import { engineLayerSource } from "./engineLayerSource";

/** The open session and the reader it loads layers through. */
interface Opened {
  readonly session: EngineSession;
  readonly reader: number;
  readonly location: FontStoreLocation;
}

/**
 * The window's editing engine: shift-engine over the workspace's font store,
 * reading layers synchronously through the window's read-only reader.
 *
 * @remarks
 * Every edit the window makes applies here first, in the frame it is made, and
 * the engine's layers are what the window shows. The native workspace still
 * persists each edit and echoes it. {@link reopen} starts over from the store,
 * for changes the engine did not make, such as undo, or a new store location
 * after Save As.
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
      const session = EngineSession.open(
        this.#layers.directory(reader),
        engineLayerSource(this.#layers, reader),
      );
      this.#close();
      this.#opened = { session, reader, location };
    } catch (error) {
      this.#layers.close(reader);
      throw error;
    }
  }

  /** Reopens when the workspace's store has moved, as after Save As. */
  async followStore(): Promise<void> {
    const location = await this.#storeLocation();
    if (location && !sameFontStoreLocation(location, this.#opened?.location ?? null)) {
      await this.reopen();
    }
  }

  /**
   * Applies `intents` as one edit and returns every layer it touched.
   *
   * @throws When the engine is not open, an intent is invalid, or a read fails.
   */
  apply(intents: readonly FontIntent[]): EngineLayer[] {
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

  /** Drops `glyphIds`' loaded layers, so the next edit reads them from the store. */
  evict(glyphIds: readonly GlyphId[]): void {
    if (glyphIds.length === 0) return;
    this.#opened?.session.evict(glyphIds);
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
    if (!this.#opened) throw new Error("the window's editing engine is not open");
    return this.#opened.session;
  }

  #close(): void {
    if (!this.#opened) return;
    this.#opened.session.dispose();
    this.#layers.close(this.#opened.reader);
    this.#opened = null;
  }
}
