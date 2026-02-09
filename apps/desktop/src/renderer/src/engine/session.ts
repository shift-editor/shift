import type { GlyphSnapshot } from "@shift/types";

export interface Session {
  startEditSession(unicode: number): void;
  endEditSession(): void;
  hasEditSession(): boolean;
  getEditingUnicode(): number | null;
  getSnapshot(): GlyphSnapshot;
  emitGlyph(glyph: GlyphSnapshot | null): void;
}

export class SessionManager {
  #engine: Session;

  constructor(engine: Session) {
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
