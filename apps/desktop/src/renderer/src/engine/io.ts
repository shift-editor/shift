/** Font file I/O primitives that {@link IOManager} wraps. */
export interface IO {
  loadFont(path: string): void;
  saveFontAsync(path: string): Promise<void>;
}

/** Loading is synchronous (blocks until parsed). Saving is async to avoid blocking the renderer. */
export class IOManager {
  #engine: IO;

  constructor(engine: IO) {
    this.#engine = engine;
  }

  /** Replaces any previously loaded font. Resets all engine state. */
  loadFont(path: string): void {
    this.#engine.loadFont(path);
  }

  async saveFontAsync(path: string): Promise<void> {
    return this.#engine.saveFontAsync(path);
  }
}
