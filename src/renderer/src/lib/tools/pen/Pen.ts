/**
 * Pen Tool - State Machine
 *
 * The state machine handles WHEN things happen (state transitions).
 * Commands handle HOW things happen (bezier geometry).
 *
 * States:
 * - idle: Tool not active
 * - ready: Tool active, waiting for input
 * - anchored: Mouse down, anchor placed, waiting for drag or release
 * - dragging: Dragging to create handles
 */

import { Editor } from '@/lib/editor/Editor';
import { effect, type Effect } from '@/lib/reactive/signal';
import { createStateMachine, type StateMachine } from '@/lib/tools/core';
import { IRenderer } from '@/types/graphics';
import { Tool, ToolName } from '@/types/tool';
import type { ContourSnapshot, PointSnapshot } from '@/types/generated';

import { DEFAULT_STYLES } from '../../styles/style';
import { PenCommands, distance, mirror } from './commands';
import {
  type ContourContext,
  type PenState,
  CLOSE_HIT_RADIUS,
  DRAG_THRESHOLD,
} from './states';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get the first point of a contour.
 */
function getFirstPoint(contour: ContourSnapshot): PointSnapshot | null {
  return contour.points.length > 0 ? contour.points[0] : null;
}

/**
 * Check if position is near a point.
 */
function isNearPoint(
  x: number,
  y: number,
  point: PointSnapshot,
  radius: number,
): boolean {
  const dx = x - point.x;
  const dy = y - point.y;
  return Math.sqrt(dx * dx + dy * dy) < radius;
}

// ============================================================================
// Pen Tool Class
// ============================================================================

export class Pen implements Tool {
  public readonly name: ToolName = 'pen';

  #editor: Editor;
  #sm: StateMachine<PenState>;
  #commands: PenCommands;
  #renderEffect: Effect;

  constructor(editor: Editor) {
    this.#editor = editor;
    this.#sm = createStateMachine<PenState>({ type: 'idle' });
    this.#commands = new PenCommands(editor);

    this.#renderEffect = effect(() => {
      if (this.#sm.isIn('dragging', 'ready')) {
        editor.requestRedraw();
      }
    });
  }

  // ==========================================================================
  // Tool Interface Methods
  // ==========================================================================

  setIdle(): void {
    this.#sm.transition({ type: 'idle' });
  }

  setReady(): void {
    this.#sm.transition({ type: 'ready' });
  }

  dispose(): void {
    this.#renderEffect.dispose();
  }

  // ==========================================================================
  // For Testing - State Access
  // ==========================================================================

  /** Get current state (for testing) */
  getState(): PenState {
    return this.#sm.current;
  }

  // ==========================================================================
  // Mouse Event Handlers
  // ==========================================================================

  onMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (e.button !== 0) return;
    if (!this.#sm.isIn('ready')) return;

    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const { x, y } = this.#editor.projectScreenToUpm(position.x, position.y);

    // Check for contour close action
    if (this.shouldCloseContour(x, y)) {
      this.#editor.commandHistory.beginBatch('Close Contour');
      this.#commands.closeContour();
      this.#editor.commandHistory.endBatch();
      return;
    }

    // Start a batch for this pen stroke
    this.#editor.commandHistory.beginBatch('Add Point');

    // Build contour context
    const context = this.buildContourContext();

    // Place anchor
    const result = this.#commands.placeAnchor({ x, y });

    // Transition to anchored state
    this.#sm.transition({
      type: 'anchored',
      anchor: {
        position: { x, y },
        pointId: result.pointId,
        context,
      },
    });

    this.#editor.emit('points:added', { pointIds: [result.pointId] });
  }

  onMouseUp(_e: React.MouseEvent<HTMLCanvasElement>): void {
    if (this.#sm.isIn('anchored', 'dragging')) {
      // End the batch for this pen stroke
      if (this.#editor.commandHistory.isBatching) {
        this.#editor.commandHistory.endBatch();
      }
      this.#sm.transition({ type: 'ready' });
    }
  }

  onMouseMove(e: React.MouseEvent<HTMLCanvasElement>): void {
    const position = this.#editor.getMousePosition(e.clientX, e.clientY);
    const mousePos = this.#editor.projectScreenToUpm(position.x, position.y);

    this.#sm.when('anchored', (state) => {
      const { anchor } = state;
      const dist = distance(anchor.position, mousePos);

      // Check if we've exceeded the drag threshold
      if (dist > DRAG_THRESHOLD) {
        // Create handles
        const result = this.#commands.createHandles(anchor, mousePos);

        // Transition to dragging state
        this.#sm.transition({
          type: 'dragging',
          anchor,
          handles: result.handles,
          mousePos,
        });
      }
    });

    this.#sm.when('dragging', (state) => {
      const { anchor, handles } = state;

      // Update handle positions
      this.#commands.updateHandles(anchor, handles, mousePos);

      // Update mouse position in state for rendering (triggers effect for UI preview)
      this.#sm.transition({
        ...state,
        mousePos,
      });
    });
  }

  // ==========================================================================
  // Context Building
  // ==========================================================================

  /**
   * Build the contour context from current snapshot.
   * This tells commands what situation they're dealing with.
   */
  private buildContourContext(): ContourContext {
    const snapshot = this.#editor.getSnapshot();
    if (!snapshot) {
      return {
        previousPointType: 'none',
        previousOnCurvePosition: null,
        isFirstPoint: true,
      };
    }

    const activeContourId = this.#editor.fontEngine.editing.getActiveContourId();
    const activeContour = snapshot.contours.find((c) => c.id === activeContourId);
    if (activeContour.points.length === 0) {
      return {
        previousPointType: 'none',
        previousOnCurvePosition: null,
        isFirstPoint: true,
      };
    }

    const points = activeContour.points;
    const lastPoint = points[points.length - 1];

    // Find the last on-curve point for 1/3 calculation
    let previousOnCurvePosition: { x: number; y: number } | null = null;
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].pointType === 'onCurve') {
        previousOnCurvePosition = { x: points[i].x, y: points[i].y };
        break;
      }
    }

    return {
      previousPointType: lastPoint.pointType === 'offCurve' ? 'offCurve' : 'onCurve',
      previousOnCurvePosition,
      isFirstPoint: false,
    };
  }

  /**
   * Check if clicking near the first point should close the contour.
   */
  private shouldCloseContour(x: number, y: number): boolean {
    const snapshot = this.#editor.getSnapshot();
    const activeContourId = this.#editor.fontEngine.editing.getActiveContourId();
    const activeContour = snapshot?.contours.find((c) => c.id === activeContourId);

    if (!activeContour || activeContour.closed || activeContour.points.length < 2) {
      return false;
    }

    const firstPoint = getFirstPoint(activeContour);
    return firstPoint !== null && isNearPoint(x, y, firstPoint, CLOSE_HIT_RADIUS);
  }

  // ==========================================================================
  // Visual Feedback
  // ==========================================================================

  /**
   * Draw interactive elements (ghost lines during drag).
   */
  drawInteractive(ctx: IRenderer): void {
    this.#sm.when('dragging', (state) => {
      const { anchor, mousePos } = state;

      ctx.setStyle({
        ...DEFAULT_STYLES,
      });

      const anchorX = anchor.position.x;
      const anchorY = anchor.position.y;
      const mouseX = mousePos.x;
      const mouseY = mousePos.y;

      // Calculate mirrored position
      const mirrorPos = mirror(mousePos, anchor.position);

      // Line 1: Mouse position to anchor
      ctx.beginPath();
      ctx.moveTo(mouseX, mouseY);
      ctx.lineTo(anchorX, anchorY);
      ctx.stroke();

      // Line 2: Anchor to mirrored position
      ctx.beginPath();
      ctx.moveTo(anchorX, anchorY);
      ctx.lineTo(mirrorPos.x, mirrorPos.y);
      ctx.stroke();

      // Draw handle indicators
      this.drawHandle(ctx, mouseX, mouseY);
      this.drawHandle(ctx, mirrorPos.x, mirrorPos.y);
    });
  }

  /**
   * Draw a handle indicator at the given position.
   */
  private drawHandle(ctx: IRenderer, x: number, y: number): void {
    this.#editor.paintHandle(ctx, x, y, 'control', 'idle');
  }
}
