import type { GlyphSnapshot } from "@shift/types";
import type { GlyphRef } from "@/lib/tools/text/layout";

/** Low-level session lifecycle primitives that {@link SessionManager} orchestrates. */
export interface Session {
  startEditSession(glyph: GlyphRef): void;
  endEditSession(): void;
  hasEditSession(): boolean;
  getEditingUnicode(): number | null;
  getEditingGlyphName(): string | null;
  getSnapshot(): GlyphSnapshot;
  emitGlyph(glyph: GlyphSnapshot | null): void;
}

/**
 * One glyph at a time: a session binds the native engine to a single glyph.
 * Starting a new session automatically ends the previous one; ending clears the glyph signal.
 */
export class SessionManager {
  #engine: Session;

  constructor(engine: Session) {
    this.#engine = engine;
  }

  /** No-op if the same glyph is already active; ends the previous session if a different glyph is active. */
  startEditSession(target: GlyphRef): void {
    if (this.isActive()) {
      const currentName = this.getEditingGlyphName();
      if (currentName === target.glyphName) {
        return;
      }
      this.endEditSession();
    }

    this.#engine.startEditSession(target);
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

  getEditingGlyphName(): string | null {
    return this.#engine.getEditingGlyphName();
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
