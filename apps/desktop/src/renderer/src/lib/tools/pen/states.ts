/**
 * Pen Tool State Types
 *
 * Defines the state machine states and associated data structures.
 * The state machine knows WHEN to do things, commands know HOW.
 */

import type { Point2D } from "@/types/math";
import type { PointId } from "@/types/ids";

// ============================================================================
// State Machine States
// ============================================================================

export type PenState =
  | { type: "idle" }
  | { type: "ready"; mousePos: Point2D }
  | { type: "anchored"; anchor: AnchorData }
  | {
      type: "dragging";
      anchor: AnchorData;
      handles: HandleData;
      mousePos: Point2D;
    };

// ============================================================================
// State Data Structures
// ============================================================================

/**
 * Data about the anchor point being placed/manipulated.
 */
export interface AnchorData {
  /** Position of the anchor in UPM coordinates */
  position: Point2D;
  /** PointId from the Rust backend */
  pointId: PointId;
  /** Context about what came before this anchor */
  context: ContourContext;
}

/**
 * Data about control points (handles) associated with an anchor.
 *
 * Terminology:
 * - cpIn: Control point ARRIVING at anchor (before in sequence)
 * - cpOut: Control point LEAVING anchor (after in sequence)
 *
 * Example cubic: [anchor_A, cp1, cpIn, anchor_B, cpOut]
 *                           ↑    ↑              ↑
 *                     A's cpOut  B's cpIn    B's cpOut
 */
export interface HandleData {
  /** Control point arriving at anchor (inserted before anchor in sequence) */
  cpIn?: PointId;
  /** Control point leaving anchor (added after anchor in sequence) */
  cpOut?: PointId;
}

/**
 * Context about the contour state when placing an anchor.
 * This tells commands what situation they're dealing with.
 */
export interface ContourContext {
  /** Type of the previous point in the contour */
  previousPointType: "none" | "onCurve" | "offCurve";
  /** Position of the previous on-curve point (needed for 1/3 calculation) */
  previousOnCurvePosition: Point2D | null;
  /** True if this is the first point in the contour */
  isFirstPoint: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Drag threshold in UPM units - handles aren't created until drag exceeds this */
export const DRAG_THRESHOLD = 3;
