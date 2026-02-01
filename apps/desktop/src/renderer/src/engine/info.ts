/**
 * InfoManager - Provides font metadata and metrics.
 *
 * Read-only operations that don't require an edit session.
 */

import type { FontMetadata, FontMetrics } from "@shift/types";
import type { NativeFontEngine } from "./native";

export interface InfoManagerContext {
  native: NativeFontEngine;
}

/**
 * InfoManager provides font metadata and metrics.
 */
export class InfoManager {
  #ctx: InfoManagerContext;

  constructor(ctx: InfoManagerContext) {
    this.#ctx = ctx;
  }

  getMetadata(): FontMetadata {
    return this.#ctx.native.getMetadata();
  }

  getMetrics(): FontMetrics {
    return this.#ctx.native.getMetrics();
  }

  getGlyphCount(): number {
    return this.#ctx.native.getGlyphCount();
  }
}
