/**
 * RustBridge - The single point of contact between TypeScript and Rust
 *
 * All glyph mutations go through this bridge. It:
 * 1. Sends commands to the Rust FontEngine
 * 2. Receives updated snapshots for rendering
 * 3. Provides query methods for current state
 */

import type { Command, PointTypeString } from '@/types/commands';
import type {
  CommandResult,
  FontMetadata,
  FontMetrics,
  GlyphSnapshot,
} from '@/types/snapshots';

// ═══════════════════════════════════════════════════════════
// INTERFACE
// ═══════════════════════════════════════════════════════════

export interface IRustBridge {
  /**
   * Send a command to mutate glyph state
   * Returns the result with updated snapshot
   */
  sendCommand(command: Command): CommandResult;

  /**
   * Get current glyph snapshot without mutation
   * Returns null if no edit session is active
   */
  getSnapshot(): GlyphSnapshot | null;

  /**
   * Load a font file
   */
  loadFont(path: string): void;

  /**
   * Get font metadata (family, style, version)
   */
  getMetadata(): FontMetadata;

  /**
   * Get font metrics (UPM, ascender, etc.)
   */
  getMetrics(): FontMetrics;

  /**
   * Get total number of glyphs in font
   */
  getGlyphCount(): number;

  /**
   * Start editing a specific glyph
   */
  startEditSession(unicode: number): void;

  /**
   * End current edit session
   */
  endEditSession(): void;

  /**
   * Check if undo is available
   */
  canUndo(): boolean;

  /**
   * Check if redo is available
   */
  canRedo(): boolean;
}

// ═══════════════════════════════════════════════════════════
// REAL IMPLEMENTATION (wraps window.shiftFont)
// ═══════════════════════════════════════════════════════════

/**
 * Real RustBridge that communicates with the Rust FontEngine via preload
 */
export class RustBridge implements IRustBridge {
  #cachedSnapshot: GlyphSnapshot | null = null;
  #canUndo = false;
  #canRedo = false;

  constructor() {
    // Verify the native module is available
    if (typeof window === 'undefined' || !window.shiftFont) {
      console.warn('RustBridge: window.shiftFont not available, using mock mode');
    }
  }

  private get native() {
    if (!window.shiftFont) {
      throw new Error('Rust FontEngine not available. Is the preload script loaded?');
    }
    return window.shiftFont;
  }

  sendCommand(command: Command): CommandResult {
    try {
      // TODO: Implement command dispatch to Rust
      // For now, delegate to specific methods based on command type
      switch (command.type) {
        case 'startEditSession':
          this.startEditSession(command.glyphUnicode);
          return this.#successResult();

        case 'endEditSession':
          this.endEditSession();
          return this.#successResult();

        case 'addContour':
          this.native.addEmptyContour();
          this.#invalidateCache();
          return this.#successResult();

        // TODO: Implement remaining commands as Rust API expands
        default:
          return {
            success: false,
            snapshot: null,
            error: `Command '${command.type}' not yet implemented`,
            canUndo: this.#canUndo,
            canRedo: this.#canRedo,
          };
      }
    } catch (e) {
      return {
        success: false,
        snapshot: null,
        error: e instanceof Error ? e.message : String(e),
        canUndo: this.#canUndo,
        canRedo: this.#canRedo,
      };
    }
  }

  getSnapshot(): GlyphSnapshot | null {
    // TODO: Implement when Rust getGlyphSnapshot is available
    return this.#cachedSnapshot;
  }

  loadFont(path: string): void {
    this.native.loadFont(path);
  }

  getMetadata(): FontMetadata {
    const meta = this.native.getMetadata();
    return {
      family: meta.family,
      styleName: meta.styleName,
      version: meta.version,
    };
  }

  getMetrics(): FontMetrics {
    const metrics = this.native.getMetrics();
    return {
      unitsPerEm: metrics.unitsPerEm,
      ascender: metrics.ascender,
      descender: metrics.descender,
      capHeight: metrics.capHeight,
      xHeight: metrics.xHeight,
    };
  }

  getGlyphCount(): number {
    return this.native.getGlyphCount();
  }

  startEditSession(unicode: number): void {
    this.native.startEditSession(unicode);
    // Initialize empty snapshot for new session
    this.#cachedSnapshot = {
      unicode,
      name: '',
      xAdvance: 500,
      contours: [],
      activeContourId: null,
    };
  }

  endEditSession(): void {
    this.native.endEditSession();
    this.#cachedSnapshot = null;
    this.#canUndo = false;
    this.#canRedo = false;
  }

  canUndo(): boolean {
    return this.#canUndo;
  }

  canRedo(): boolean {
    return this.#canRedo;
  }

  #invalidateCache(): void {
    // TODO: Fetch fresh snapshot from Rust
    // this.#cachedSnapshot = this.native.getGlyphSnapshot();
  }

  #successResult(): CommandResult {
    return {
      success: true,
      snapshot: this.#cachedSnapshot,
      canUndo: this.#canUndo,
      canRedo: this.#canRedo,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// MOCK IMPLEMENTATION (for testing without Rust)
// ═══════════════════════════════════════════════════════════

/**
 * Mock RustBridge for unit testing without the native module
 */
export class MockRustBridge implements IRustBridge {
  #snapshot: GlyphSnapshot | null = null;
  #undoStack: Command[] = [];
  #redoStack: Command[] = [];
  #nextId = 1;

  #generateId(): string {
    return String(this.#nextId++);
  }

  sendCommand(command: Command): CommandResult {
    try {
      switch (command.type) {
        case 'startEditSession':
          return this.#handleStartSession(command.glyphUnicode);

        case 'endEditSession':
          return this.#handleEndSession();

        case 'addContour':
          return this.#handleAddContour();

        case 'addPoint':
          return this.#handleAddPoint(command);

        case 'movePoints':
          return this.#handleMovePoints(command);

        case 'removePoints':
          return this.#handleRemovePoints(command);

        case 'closeContour':
          return this.#handleCloseContour(command);

        case 'undo':
          return this.#handleUndo();

        case 'redo':
          return this.#handleRedo();

        default:
          return {
            success: false,
            snapshot: null,
            error: `Unknown command: ${(command as Command).type}`,
            canUndo: this.canUndo(),
            canRedo: this.canRedo(),
          };
      }
    } catch (e) {
      return {
        success: false,
        snapshot: null,
        error: e instanceof Error ? e.message : String(e),
        canUndo: this.canUndo(),
        canRedo: this.canRedo(),
      };
    }
  }

  getSnapshot(): GlyphSnapshot | null {
    return this.#snapshot;
  }

  loadFont(_path: string): void {
    // Mock: No-op
  }

  getMetadata(): FontMetadata {
    return {
      family: 'Mock Font',
      styleName: 'Regular',
      version: 1,
    };
  }

  getMetrics(): FontMetrics {
    return {
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      capHeight: 700,
      xHeight: 500,
    };
  }

  getGlyphCount(): number {
    return 256;
  }

  startEditSession(unicode: number): void {
    this.#snapshot = {
      unicode,
      name: String.fromCodePoint(unicode),
      xAdvance: 500,
      contours: [],
      activeContourId: null,
    };
    this.#undoStack = [];
    this.#redoStack = [];
  }

  endEditSession(): void {
    this.#snapshot = null;
    this.#undoStack = [];
    this.#redoStack = [];
  }

  canUndo(): boolean {
    return this.#undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.#redoStack.length > 0;
  }

  // ─────────────────────────────────────────────────────────
  // Command Handlers
  // ─────────────────────────────────────────────────────────

  #handleStartSession(unicode: number): CommandResult {
    this.startEditSession(unicode);
    return this.#success();
  }

  #handleEndSession(): CommandResult {
    this.endEditSession();
    return this.#success();
  }

  #handleAddContour(): CommandResult {
    if (!this.#snapshot) {
      return this.#error('No active edit session');
    }

    const contourId = this.#generateId();
    this.#snapshot.contours.push({
      id: contourId,
      points: [],
      closed: false,
    });
    this.#snapshot.activeContourId = contourId;

    // Don't push to undo stack for now (would need inverse command)
    return this.#success([]);
  }

  #handleAddPoint(cmd: { contourId?: string; x: number; y: number; pointType: PointTypeString; smooth?: boolean }): CommandResult {
    if (!this.#snapshot) {
      return this.#error('No active edit session');
    }

    const contourId = cmd.contourId ?? this.#snapshot.activeContourId;
    if (!contourId) {
      return this.#error('No active contour');
    }

    const contour = this.#snapshot.contours.find((c) => c.id === contourId);
    if (!contour) {
      return this.#error(`Contour ${contourId} not found`);
    }

    const pointId = this.#generateId();
    contour.points.push({
      id: pointId,
      x: cmd.x,
      y: cmd.y,
      pointType: cmd.pointType,
      smooth: cmd.smooth ?? false,
    });

    return this.#success([pointId]);
  }

  #handleMovePoints(cmd: { pointIds: string[]; dx: number; dy: number; preview: boolean }): CommandResult {
    if (!this.#snapshot) {
      return this.#error('No active edit session');
    }

    const affected: string[] = [];

    for (const contour of this.#snapshot.contours) {
      for (const point of contour.points) {
        if (cmd.pointIds.includes(point.id)) {
          point.x += cmd.dx;
          point.y += cmd.dy;
          affected.push(point.id);
        }
      }
    }

    // Only push to undo if not preview
    if (!cmd.preview) {
      this.#undoStack.push(cmd as unknown as Command);
      this.#redoStack = [];
    }

    return this.#success(affected);
  }

  #handleRemovePoints(cmd: { pointIds: string[] }): CommandResult {
    if (!this.#snapshot) {
      return this.#error('No active edit session');
    }

    for (const contour of this.#snapshot.contours) {
      contour.points = contour.points.filter((p) => !cmd.pointIds.includes(p.id));
    }

    return this.#success(cmd.pointIds);
  }

  #handleCloseContour(cmd: { contourId: string }): CommandResult {
    if (!this.#snapshot) {
      return this.#error('No active edit session');
    }

    const contour = this.#snapshot.contours.find((c) => c.id === cmd.contourId);
    if (!contour) {
      return this.#error(`Contour ${cmd.contourId} not found`);
    }

    contour.closed = true;
    return this.#success();
  }

  #handleUndo(): CommandResult {
    // Simplified mock undo - real implementation would be more complex
    if (this.#undoStack.length === 0) {
      return this.#error('Nothing to undo');
    }

    const cmd = this.#undoStack.pop()!;
    this.#redoStack.push(cmd);

    return this.#success();
  }

  #handleRedo(): CommandResult {
    if (this.#redoStack.length === 0) {
      return this.#error('Nothing to redo');
    }

    const cmd = this.#redoStack.pop()!;
    this.#undoStack.push(cmd);

    return this.#success();
  }

  // ─────────────────────────────────────────────────────────
  // Result Helpers
  // ─────────────────────────────────────────────────────────

  #success(affectedPointIds: string[] = []): CommandResult {
    return {
      success: true,
      snapshot: this.#snapshot,
      affectedPointIds,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    };
  }

  #error(message: string): CommandResult {
    return {
      success: false,
      snapshot: null,
      error: message,
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
    };
  }
}

// ═══════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════

/**
 * Creates the appropriate RustBridge based on environment
 */
export function createRustBridge(): IRustBridge {
  if (typeof window !== 'undefined' && window.shiftFont) {
    return new RustBridge();
  }
  console.warn('Using MockRustBridge - Rust native module not available');
  return new MockRustBridge();
}
