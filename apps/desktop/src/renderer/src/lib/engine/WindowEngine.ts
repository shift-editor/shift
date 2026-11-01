import type { LayerReaderHost } from "@shared/host/ShiftHost";
import { FontStoreLocation } from "@shared/workspace/lanes";
import { SessionEngine } from "@shift/editor/model";
import { storeReader } from "@shift/wasm/store-reader";
import { engineStoreRequest } from "./engineStoreRequest";

/**
 * The store an open session reads, and the reader it loads layers through,
 * which moves with the store. `reader` is null while released, and reopens on
 * the next read.
 */
interface HeldStore {
  reader: number | null;
  location: FontStoreLocation;
}

/** Where a {@link WindowEngine} opens from: the workspace serving this window. */
export interface EngineWorkspace {
  /** The workspace's store, for the window's layer reader; `null` for a preview. */
  storeLocation(): Promise<FontStoreLocation | null>;
  /** The font's directory as the engine opens it; `null` for a preview. */
  directory(): Promise<Uint8Array | null>;
}

/**
 * The window's editing engine: a {@link SessionEngine} over the workspace's
 * font store, reading layers synchronously through the window's read-only
 * reader.
 *
 * @remarks
 * The session, its reads, edits and history are the {@link SessionEngine}'s.
 * This adds where the store is: {@link reopen} starts over from the store,
 * dropping that history (only after a persist failed), {@link followStore}
 * moves the reader after the store moves, and {@link releaseStore} closes it
 * so the store's files can be deleted. The change sets {@link endEdit}
 * returns are what the native workspace persists.
 */
export class WindowEngine extends SessionEngine {
  readonly #layers: LayerReaderHost;
  readonly #workspace: EngineWorkspace;
  #store: HeldStore | null = null;

  constructor(layers: LayerReaderHost, workspace: EngineWorkspace) {
    super();
    this.#layers = layers;
    this.#workspace = workspace;
  }

  /**
   * Opens the engine over the workspace's store as it stands, replacing any
   * session already open.
   *
   * @throws When the workspace has no store to read, as in a preview.
   */
  async reopen(): Promise<void> {
    const [location, directory] = await Promise.all([
      this.#workspace.storeLocation(),
      this.#workspace.directory(),
    ]);
    if (!location || !directory) throw new Error("the workspace has no font store to edit");

    const store: HeldStore = { reader: this.#layers.open(location), location };
    try {
      // The document's scene, as the store holds it, unsaved edits included.
      const scene = storeReader((method, numbers, blobs) =>
        this.#layers.request(this.#readerOf(store), method, numbers, blobs),
      ).sceneNodes();
      // The session reads layers only while an edit runs, after this open, so
      // its source can follow the current reader.
      await this.replace({
        kind: "reader",
        directory,
        request: engineStoreRequest(this.#layers, () => this.#readerOf(store)),
        scene,
      });
      this.#store = store;
    } catch (error) {
      if (store.reader !== null) this.#layers.close(store.reader);
      throw error;
    }
  }

  /**
   * Reads from the workspace's store where it now lives, as after Save As. The
   * session and its history stay: the font is the same, only its file moved.
   */
  async followStore(): Promise<void> {
    const store = this.#store;
    const location = await this.#workspace.storeLocation();
    if (!store || !location || FontStoreLocation.equals(location, store.location)) return;

    const previous = store.reader;
    store.reader = this.#layers.open(location);
    store.location = location;
    if (previous !== null) this.#layers.close(previous);
  }

  /**
   * Closes the reader, keeping the session, so the workspace can delete the
   * store's files: Windows refuses while they are open. The next read reopens it.
   */
  releaseStore(): void {
    const store = this.#store;
    if (!store || store.reader === null) return;
    this.#layers.close(store.reader);
    store.reader = null;
  }

  protected override close(): void {
    super.close();
    this.releaseStore();
    this.#store = null;
  }

  /** The reader of `store`, reopened if it was released. */
  #readerOf(store: HeldStore): number {
    store.reader ??= this.#layers.open(store.location);
    return store.reader;
  }
}
