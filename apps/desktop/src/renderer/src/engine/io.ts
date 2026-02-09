export interface IO {
  loadFont(path: string): void;
  saveFontAsync(path: string): Promise<void>;
}

export class IOManager {
  #engine: IO;

  constructor(engine: IO) {
    this.#engine = engine;
  }

  loadFont(path: string): void {
    this.#engine.loadFont(path);
  }

  async saveFontAsync(path: string): Promise<void> {
    return this.#engine.saveFontAsync(path);
  }
}
