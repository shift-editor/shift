/**
 * FontEngine - The primary interface to the Rust font editing system.
 *
 * Organized into domain-specific managers:
 * - editing: Point and contour mutations
 * - session: Edit session lifecycle
 * - info: Font metadata and metrics
 * - io: File operations
 *
 * Usage:
 * ```typescript
 * const engine = new FontEngine();
 *
 * // Use effect to react to glyph changes
 * effect(() => {
 *   const glyph = engine.$glyph.value;
 *   // Update rendering
 * });
 *
 * // Start editing a glyph
 * engine.session.start(65); // 'A'
 *
 * // Add points
 * const pointId = engine.editing.addPoint(100, 200, 'onCurve');
 *
 * // Current glyph data is always available via signal
 * const glyph = engine.$glyph.value;
 * ```
 */

import type { GlyphSnapshot, CommandResult } from "@shift/types";
import { signal, type WritableSignal, type Signal } from "@/lib/reactive/signal";
import { getNative, hasNative, type NativeFontEngine } from "./native";
import { EditingManager } from "./editing";
import { SessionManager } from "./session";
import { InfoManager } from "./info";
import { IOManager } from "./io";

export interface CommitContext {
  native: NativeFontEngine;
  hasSession: () => boolean;
  getGlyph: () => GlyphSnapshot | null;
  commit: <T>(extract: (result: CommandResult) => T, operation: () => string) => T;
  emitGlyph: (glyph: GlyphSnapshot | null) => void;
}

/**
 * FontEngine is the primary interface to the Rust font editing system.
 *
 * The `$glyph` property is a reactive signal. Use `effect()` to react to changes:
 * ```typescript
 * effect(() => {
 *   const glyph = fontEngine.$glyph.value;
 *   // This runs whenever glyph changes
 * });
 * ```
 */
export class FontEngine {
  readonly editing: EditingManager;
  readonly session: SessionManager;
  readonly info: InfoManager;
  readonly io: IOManager;

  readonly #$glyph: WritableSignal<GlyphSnapshot | null>;
  #native: NativeFontEngine;

  constructor(native?: NativeFontEngine) {
    this.#native = native ?? getNative();
    this.#$glyph = signal<GlyphSnapshot | null>(null);

    const ctx: CommitContext = {
      native: this.#native,
      hasSession: () => this.session.isActive(),
      getGlyph: () => this.#$glyph.value,
      commit: <T>(extract: (result: CommandResult) => T, operation: () => string): T => {
        const resultJson = operation();
        const result = this.#parseCommandResult(resultJson);
        if (result.snapshot) {
          this.#$glyph.set(result.snapshot);
        }
        return extract(result);
      },
      emitGlyph: (glyph: GlyphSnapshot | null) => {
        this.#$glyph.set(glyph);
      },
    };

    this.editing = new EditingManager(ctx);
    this.session = new SessionManager(ctx);
    this.info = new InfoManager(ctx);
    this.io = new IOManager(ctx);
  }

  get $glyph(): Signal<GlyphSnapshot | null> {
    return this.#$glyph;
  }

  getGlyph(): GlyphSnapshot | null {
    return this.#$glyph.value;
  }

  refreshGlyph(): void {
    const glyph = this.session.getGlyph();
    this.#$glyph.set(glyph);
  }

  #parseCommandResult(json: string): CommandResult {
    const raw = JSON.parse(json) as CommandResult;
    return {
      success: raw.success,
      snapshot: raw.snapshot ?? null,
      error: raw.error ?? null,
      affectedPointIds: raw.affectedPointIds ?? null,
      canUndo: raw.canUndo ?? false,
      canRedo: raw.canRedo ?? false,
    };
  }
}

export function createFontEngine(): FontEngine {
  if (hasNative()) {
    return new FontEngine();
  }

  console.warn("Native FontEngine not available, using mock implementation");
  throw new Error("MockFontEngine not yet implemented");
}
