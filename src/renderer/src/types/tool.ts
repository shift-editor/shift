import type { IRenderer } from "./graphics";
import type { GlyphSnapshot } from "./generated";
import type { PointId } from "./ids";
import type { FontEngine } from "@/engine";
import type { Viewport } from "@/lib/editor/Viewport";
import type { CommandHistory } from "@/lib/commands";

export type ToolName = "select" | "pen" | "hand" | "shape" | "disabled";

/**
 * Context passed to tools for accessing editor state and performing actions.
 *
 * Tools receive this context instead of reaching into Editor directly.
 */
export interface ToolContext {
  // ═══════════════════════════════════════════════════════════
  // READ-ONLY STATE
  // ═══════════════════════════════════════════════════════════

  /** Current glyph snapshot (null if no edit session). */
  readonly snapshot: GlyphSnapshot | null;

  /** Currently selected point IDs. */
  readonly selectedPoints: ReadonlySet<PointId>;

  /** Currently hovered point ID (null if none). */
  readonly hoveredPoint: PointId | null;

  /** Viewport for coordinate transforms. */
  readonly viewport: Viewport;

  /** Mouse position in UPM coordinates. */
  readonly mousePosition: { x: number; y: number };

  // ═══════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════

  /** Font engine for mutations. */
  readonly fontEngine: FontEngine;

  /** Command history for undo/redo. */
  readonly commands: CommandHistory;

  /** Set the selected points. */
  setSelectedPoints(ids: Set<PointId>): void;

  /** Add a point to selection. */
  addToSelection(id: PointId): void;

  /** Clear selection. */
  clearSelection(): void;

  /** Set the hovered point. */
  setHoveredPoint(id: PointId | null): void;

  /** Request a redraw of the canvas. */
  requestRedraw(): void;
}

/**
 * Tool interface - implements mouse/keyboard handlers and optional rendering.
 */
export interface Tool {
  name: ToolName;

  setIdle(): void;
  setReady(): void;

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void;
  onMouseUp(e: React.MouseEvent<HTMLCanvasElement>): void;
  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void;

  keyDownHandler?(e: KeyboardEvent): void;
  keyUpHandler?(e: KeyboardEvent): void;
  onDoubleClick?(e: React.MouseEvent<HTMLCanvasElement>): void;

  drawInteractive?(ctx: IRenderer): void;

  /** Optional cleanup when tool is disposed (e.g., for signal effects). */
  dispose?(): void;
}
