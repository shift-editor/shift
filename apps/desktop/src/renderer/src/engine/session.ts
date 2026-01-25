/**
 * SessionManager - Handles edit session lifecycle.
 *
 * An edit session must be active to perform any editing operations.
 * Only one glyph can be edited at a time.
 */

import type { GlyphSnapshot } from "@shift/types";
import type { NativeGlyphSnapshot } from "./native";
import type { CommitContext } from "./FontEngine";

export type SessionManagerContext = CommitContext;

function convertNativeSnapshot(native: NativeGlyphSnapshot): GlyphSnapshot {
  return {
    unicode: native.unicode,
    name: native.name,
    xAdvance: native.xAdvance,
    contours: native.contours.map((c) => ({
      id: c.id,
      points: c.points.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        pointType: p.pointType as "onCurve" | "offCurve",
        smooth: p.smooth,
      })),
      closed: c.closed,
    })),
    activeContourId: native.activeContourId,
  };
}

export class SessionManager {
  #ctx: SessionManagerContext;

  constructor(ctx: SessionManagerContext) {
    this.#ctx = ctx;
  }

  startEditSession(unicode: number): void {
    if (this.isActive()) {
      const currentUnicode = this.getEditingUnicode();
      if (currentUnicode === unicode) {
        return;
      }
      this.endEditSession();
    }

    this.#ctx.native.startEditSession(unicode);

    const glyph = this.getGlyph();
    this.#ctx.emitGlyph(glyph);
  }

  endEditSession(): void {
    this.#ctx.native.endEditSession();
    this.#ctx.emitGlyph(null);
  }

  isActive(): boolean {
    return this.#ctx.native.hasEditSession();
  }

  getEditingUnicode(): number | null {
    return this.#ctx.native.getEditingUnicode();
  }

  getGlyph(): GlyphSnapshot | null {
    if (!this.isActive()) {
      return null;
    }

    try {
      const nativeSnapshot = this.#ctx.native.getSnapshotData();
      return convertNativeSnapshot(nativeSnapshot);
    } catch {
      return null;
    }
  }
}
