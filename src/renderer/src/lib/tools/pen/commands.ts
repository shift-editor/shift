/**
 * Pen Tool Commands
 *
 * Commands handle the HOW - the actual bezier geometry and point operations.
 * Each command is a pure operation that can be tested in isolation.
 */

import type { Editor } from '@/lib/editor/Editor';
import type { Point2D } from '@/types/math';
import type { PointId } from '@/types/ids';
import type { AnchorData, HandleData } from './states';

// ============================================================================
// Geometry Helpers
// ============================================================================

/**
 * Mirror a point across an anchor.
 * Used to create symmetric handles during drag.
 */
export function mirror(point: Point2D, anchor: Point2D): Point2D {
  return {
    x: 2 * anchor.x - point.x,
    y: 2 * anchor.y - point.y,
  };
}

/**
 * Calculate a point at a fraction of the distance between two points.
 * Used to place cp1 at 1/3 of the segment.
 */
export function calculateFraction(from: Point2D, to: Point2D, fraction: number): Point2D {
  return {
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction,
  };
}

/**
 * Calculate distance between two points.
 */
export function distance(p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ============================================================================
// Command Results
// ============================================================================

export interface PlaceAnchorResult {
  pointId: PointId;
}

export interface CreateHandlesResult {
  handles: HandleData;
}

// ============================================================================
// Pen Commands Class
// ============================================================================

/**
 * Collection of commands for the Pen tool.
 *
 * Each command encapsulates a semantic operation:
 * - placeAnchor: Add an on-curve point
 * - createHandles: Create control points when dragging starts
 * - updateHandles: Update control point positions during drag
 * - closeContour: Close the current contour
 */
export class PenCommands {
  #editor: Editor;

  constructor(editor: Editor) {
    this.#editor = editor;
  }

  // ==========================================================================
  // Place Anchor Command
  // ==========================================================================

  /**
   * Place an anchor (on-curve) point at the given position.
   */
  placeAnchor(pos: Point2D): PlaceAnchorResult {
    const pointId = this.#editor.addPoint(pos.x, pos.y, 'onCurve');
    return { pointId };
  }

  // ==========================================================================
  // Create Handles Command
  // ==========================================================================

  /**
   * Create control points when user starts dragging after placing an anchor.
   *
   * The behavior depends on the contour context:
   *
   * 1. First point (isFirstPoint = true):
   *    - Just create cpOut (follows mouse)
   *    - Sequence: [anchor, cpOut]
   *
   * 2. Previous was on-curve (no trailing cpOut):
   *    - Create full cubic with cp1 and cpIn
   *    - Sequence: [prevAnchor, cp1, cpIn, anchor]
   *    - cp1 = 1/3 from prev toward anchor (fixed)
   *    - cpIn = mirrored from mouse
   *
   * 3. Previous was off-curve (trailing cpOut exists):
   *    - Create cpIn (mirrored) + cpOut (follows mouse)
   *    - Sequence: [..., prevCpOut, cpIn, anchor, cpOut]
   */
  createHandles(
    anchor: AnchorData,
    mousePos: Point2D,
  ): CreateHandlesResult {
    const { context, pointId, position } = anchor;

    // Case 1: First point - just create outgoing handle
    if (context.isFirstPoint) {
      const cpOutId = this.#editor.addPoint(mousePos.x, mousePos.y, 'offCurve');
      return {
        handles: { cpOut: cpOutId },
      };
    }

    // Case 2: Previous was on-curve - create cubic [prevAnchor, cp1, cpIn, anchor]
    if (context.previousPointType === 'onCurve') {
      // cp1 = 1/3 from previous on-curve toward current anchor (fixed position)
      if (context.previousOnCurvePosition) {
        const cp1Pos = calculateFraction(context.previousOnCurvePosition, position, 1 / 3);
        this.#editor.fontEngine.editing.insertPointBefore(
          pointId,
          cp1Pos.x,
          cp1Pos.y,
          'offCurve',
          false,
        );
      }

      // cpIn = mirrored from mouse position
      const cpInPos = mirror(mousePos, position);
      const cpInId = this.#editor.fontEngine.editing.insertPointBefore(
        pointId,
        cpInPos.x,
        cpInPos.y,
        'offCurve',
        false,
      );

      return {
        handles: { cpIn: cpInId },
      };
    }

    // Case 3: Previous was off-curve - create [..., prevCpOut, cpIn, anchor, cpOut]
    if (context.previousPointType === 'offCurve') {
      // cpIn = mirrored from mouse (inserted before anchor)
      const cpInPos = mirror(mousePos, position);
      const cpInId = this.#editor.fontEngine.editing.insertPointBefore(
        pointId,
        cpInPos.x,
        cpInPos.y,
        'offCurve',
        false,
      );

      // cpOut = follows mouse (added after anchor)
      const cpOutId = this.#editor.addPoint(mousePos.x, mousePos.y, 'offCurve');

      return {
        handles: { cpIn: cpInId, cpOut: cpOutId },
      };
    }

    // Fallback (shouldn't reach here with valid context)
    return { handles: {} };
  }

  // ==========================================================================
  // Update Handles Command
  // ==========================================================================

  /**
   * Update control point positions during drag.
   *
   * - cpOut (if exists): follows mouse directly
   * - cpIn (if exists): mirrors mouse across anchor
   */
  updateHandles(
    anchor: AnchorData,
    handles: HandleData,
    mousePos: Point2D,
  ): void {
    const { position } = anchor;

    // cpOut follows mouse directly
    if (handles.cpOut) {
      this.#editor.fontEngine.editing.movePointTo(handles.cpOut, mousePos.x, mousePos.y);
    }

    // cpIn is mirrored across anchor
    if (handles.cpIn) {
      const mirroredPos = mirror(mousePos, position);
      this.#editor.fontEngine.editing.movePointTo(handles.cpIn, mirroredPos.x, mirroredPos.y);
    }
  }

  // ==========================================================================
  // Close Contour Command
  // ==========================================================================

  /**
   * Close the current contour and start a new one.
   */
  closeContour(): void {
    this.#editor.closeContour();
    this.#editor.fontEngine.editing.addContour();
  }
}
