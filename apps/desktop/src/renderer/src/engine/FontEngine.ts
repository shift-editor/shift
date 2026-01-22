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
 * // Use effect to react to snapshot changes
 * effect(() => {
 *   const snapshot = engine.snapshot.value;
 *   // Update rendering
 * });
 *
 * // Start editing a glyph
 * engine.session.start(65); // 'A'
 *
 * // Add points
 * const pointId = engine.editing.addPoint(100, 200, 'onCurve');
 *
 * // Current snapshot is always available via signal
 * const snapshot = engine.snapshot.value;
 * ```
 */

import type { GlyphSnapshot } from "@shift/types";
import { signal, type WritableSignal } from "@/lib/reactive/signal";
import { getNative, hasNative, type NativeFontEngine } from "./native";
import { EditingManager } from "./editing";
import { SessionManager } from "./session";
import { InfoManager } from "./info";
import { IOManager } from "./io";

/**
 * FontEngine is the primary interface to the Rust font editing system.
 *
 * The `snapshot` property is a reactive signal. Use `effect()` to react to changes:
 * ```typescript
 * effect(() => {
 *   const snapshot = fontEngine.snapshot.value;
 *   // This runs whenever snapshot changes
 * });
 * ```
 */
export class FontEngine {
  readonly editing: EditingManager;
  readonly session: SessionManager;
  readonly info: InfoManager;
  readonly io: IOManager;

  /**
   * Reactive signal containing the current glyph snapshot.
   * Use `.value` to read, or access within an `effect()` to auto-track.
   */
  readonly snapshot: WritableSignal<GlyphSnapshot | null>;

  #native: NativeFontEngine;

  constructor(native?: NativeFontEngine) {
    this.#native = native ?? getNative();
    this.snapshot = signal<GlyphSnapshot | null>(null);

    // Shared context for managers
    const ctx = {
      native: this.#native,
      hasSession: () => this.session.isActive(),
      emitSnapshot: (snapshot: GlyphSnapshot | null) => {
        this.snapshot.set(snapshot);
      },
    };

    // Initialize managers
    this.editing = new EditingManager(ctx);
    this.session = new SessionManager(ctx);
    this.info = new InfoManager(ctx);
    this.io = new IOManager(ctx);
  }

  /**
   * Force a refresh of the snapshot from Rust.
   * Useful if the snapshot might be stale.
   */
  refreshSnapshot(): void {
    const snapshot = this.session.getSnapshot();
    this.snapshot.set(snapshot);
  }
}

/**
 * Create a FontEngine instance.
 * Returns a mock implementation if native is not available.
 */
export function createFontEngine(): FontEngine {
  if (hasNative()) {
    return new FontEngine();
  }

  console.warn("Native FontEngine not available, using mock implementation");
  // TODO: Return MockFontEngine when implemented
  throw new Error("MockFontEngine not yet implemented");
}
