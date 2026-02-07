import type { GlyphSnapshot } from "@shift/types";
import type { EngineCore } from "@/types/engine";

export class SessionManager {
  #engine: EngineCore;

  constructor(engine: EngineCore) {
    this.#engine = engine;
  }

  startEditSession(unicode: number): void {
    if (this.isActive()) {
      const currentUnicode = this.getEditingUnicode();
      if (currentUnicode === unicode) {
        return;
      }
      this.endEditSession();
    }

    this.#engine.startEditSession(unicode);

    const glyph = this.getGlyph();
    this.#engine.emitGlyph(glyph);
  }

  endEditSession(): void {
    this.#engine.endEditSession();
    this.#engine.emitGlyph(null);
  }

  isActive(): boolean {
    return this.#engine.hasEditSession();
  }

  getEditingUnicode(): number | null {
    return this.#engine.getEditingUnicode();
  }

  getGlyph(): GlyphSnapshot | null {
    if (!this.isActive()) {
      return null;
    }

    try {
      return this.#engine.getSnapshot();
    } catch {
      return null;
    }
  }
}
