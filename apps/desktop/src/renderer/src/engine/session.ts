import type { GlyphSnapshot, ContourId } from "@shift/types";
import type { EngineCore } from "@/types/engine";

function convertNativeSnapshot(native: GlyphSnapshot): GlyphSnapshot {
  return {
    unicode: native.unicode,
    name: native.name,
    xAdvance: native.xAdvance,
    contours: native.contours.map((c) => ({
      id: c.id as ContourId,
      points: c.points.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        pointType: p.pointType,
        smooth: p.smooth,
      })),
      closed: c.closed,
    })),
    activeContourId: native.activeContourId,
  };
}

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

    this.#engine.native.startEditSession(unicode);

    const glyph = this.getGlyph();
    this.#engine.emitGlyph(glyph);
  }

  endEditSession(): void {
    this.#engine.native.endEditSession();
    this.#engine.emitGlyph(null);
  }

  isActive(): boolean {
    return this.#engine.native.hasEditSession();
  }

  getEditingUnicode(): number | null {
    return this.#engine.native.getEditingUnicode();
  }

  getGlyph(): GlyphSnapshot | null {
    if (!this.isActive()) {
      return null;
    }

    try {
      const nativeSnapshot = this.#engine.native.getSnapshotData();
      return convertNativeSnapshot(nativeSnapshot);
    } catch {
      return null;
    }
  }
}
