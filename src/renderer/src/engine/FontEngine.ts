/**
 * FontEngine - The primary interface to the Rust font editing system.
 *
 * Organized into domain-specific managers:
 * - editing: Point and contour mutations
 * - session: Edit session lifecycle
 * - info: Font metadata and metrics
 * - history: Undo/redo operations
 * - io: File operations
 *
 * Usage:
 * ```typescript
 * const engine = new FontEngine();
 *
 * // Subscribe to snapshot changes
 * engine.onChange(snapshot => {
 *   // Update rendering
 * });
 *
 * // Start editing a glyph
 * engine.session.start(65); // 'A'
 *
 * // Add points
 * const pointId = engine.editing.addPoint(100, 200, 'onCurve');
 *
 * // Current snapshot is always available
 * const snapshot = engine.snapshot;
 * ```
 */

import type { GlyphSnapshot } from "@/types/generated";
import { getNative, hasNative, type NativeFontEngine } from "./native";
import { EditingManager } from "./editing";
import { SessionManager } from "./session";
import { InfoManager } from "./info";
import { HistoryManager } from "./history";
import { IOManager } from "./io";

type SnapshotListener = (snapshot: GlyphSnapshot | null) => void;

/**
 * FontEngine is the primary interface to the Rust font editing system.
 */
export class FontEngine {
  readonly editing: EditingManager;
  readonly session: SessionManager;
  readonly info: InfoManager;
  readonly history: HistoryManager;
  readonly io: IOManager;

  #native: NativeFontEngine;
  #snapshot: GlyphSnapshot | null = null;
  #listeners: Set<SnapshotListener> = new Set();

  constructor(native?: NativeFontEngine) {
    this.#native = native ?? getNative();

    // Shared context for managers
    const ctx = {
      native: this.#native,
      hasSession: () => this.session.isActive(),
      emitSnapshot: (snapshot: GlyphSnapshot | null) => {
        this.#setSnapshot(snapshot);
      },
    };

    // Initialize managers
    this.editing = new EditingManager(ctx);
    this.session = new SessionManager(ctx);
    this.info = new InfoManager(ctx);
    this.history = new HistoryManager(ctx);
    this.io = new IOManager(ctx);
  }

  /**
   * Get the current glyph snapshot.
   * Returns null if no edit session is active.
   */
  get snapshot(): GlyphSnapshot | null {
    return this.#snapshot;
  }

  /**
   * Subscribe to snapshot changes.
   * Called whenever the glyph data changes.
   * @returns Unsubscribe function.
   */
  onChange(listener: SnapshotListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Force a refresh of the snapshot from Rust.
   * Useful if the snapshot might be stale.
   */
  refreshSnapshot(): void {
    const snapshot = this.session.getSnapshot();
    this.#setSnapshot(snapshot);
  }

  #setSnapshot(snapshot: GlyphSnapshot | null): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) {
      listener(snapshot);
    }
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
