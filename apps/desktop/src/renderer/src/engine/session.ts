/**
 * SessionManager - Handles edit session lifecycle.
 *
 * An edit session must be active to perform any editing operations.
 * Only one glyph can be edited at a time.
 */

import type { GlyphSnapshot } from "@/types/generated";
import type { NativeFontEngine, NativeGlyphSnapshot } from "./native";

export interface SessionManagerContext {
  native: NativeFontEngine;
  emitSnapshot: (snapshot: GlyphSnapshot | null) => void;
}

/**
 * Convert native snapshot format to GlyphSnapshot.
 */
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

/**
 * SessionManager handles edit session lifecycle.
 */
export class SessionManager {
  #ctx: SessionManagerContext;

  constructor(ctx: SessionManagerContext) {
    this.#ctx = ctx;
  }

  /**
   * Start editing a glyph by unicode codepoint.
   * If a session is already active for a different glyph, it will be ended first.
   * If already editing the same glyph, this is a no-op.
   */
  startEditSession(unicode: number): void {
    if (this.isActive()) {
      const currentUnicode = this.getEditingUnicode();
      if (currentUnicode === unicode) {
        return;
      }
      this.endEditSession();
    }

    this.#ctx.native.startEditSession(unicode);

    // Emit the initial snapshot
    const snapshot = this.getSnapshot();
    this.#ctx.emitSnapshot(snapshot);
  }

  /**
   * End the current edit session.
   * Changes are persisted back to the font.
   */
  endEditSession(): void {
    this.#ctx.native.endEditSession();
    this.#ctx.emitSnapshot(null);
  }

  /**
   * Check if an edit session is currently active.
   */
  isActive(): boolean {
    return this.#ctx.native.hasEditSession();
  }

  /**
   * Get the unicode codepoint of the glyph being edited, or null if no session.
   */
  getEditingUnicode(): number | null {
    return this.#ctx.native.getEditingUnicode();
  }

  /**
   * Get the current glyph snapshot.
   * Returns null if no edit session is active.
   */
  getSnapshot(): GlyphSnapshot | null {
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
