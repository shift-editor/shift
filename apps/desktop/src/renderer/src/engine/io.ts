import type { EngineCore } from "@/types/engine";

export class IOManager {
  #engine: EngineCore;

  constructor(engine: EngineCore) {
    this.#engine = engine;
  }

  loadFont(path: string): void {
    this.#engine.native.loadFont(path);
  }

  async saveFontAsync(path: string): Promise<void> {
    return this.#engine.native.saveFontAsync(path);
  }
}
