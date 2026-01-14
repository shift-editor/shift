/**
 * Commands sent from TypeScript to Rust
 * These represent user intentions that mutate the glyph state
 */

import type { PointTypeString } from './generated';

// Re-export for convenience
export type { PointTypeString } from './generated';

// ═══════════════════════════════════════════════════════════
// POINT OPERATIONS
// ═══════════════════════════════════════════════════════════

export interface AddPointCommand {
  type: 'addPoint';
  /** If null, uses active contour */
  contourId?: string;
  x: number;
  y: number;
  pointType: PointTypeString;
  smooth?: boolean;
}

export interface MovePointsCommand {
  type: 'movePoints';
  pointIds: string[];
  dx: number;
  dy: number;
  /** If true, don't commit to undo stack (for drag preview) */
  preview: boolean;
}

export interface RemovePointsCommand {
  type: 'removePoints';
  pointIds: string[];
}

export interface SetPointPositionCommand {
  type: 'setPointPosition';
  pointId: string;
  x: number;
  y: number;
}

export interface TogglePointSmoothCommand {
  type: 'togglePointSmooth';
  pointId: string;
}

// ═══════════════════════════════════════════════════════════
// CONTOUR OPERATIONS
// ═══════════════════════════════════════════════════════════

export interface AddContourCommand {
  type: 'addContour';
}

export interface CloseContourCommand {
  type: 'closeContour';
  contourId: string;
}

export interface RemoveContourCommand {
  type: 'removeContour';
  contourId: string;
}

export interface SetActiveContourCommand {
  type: 'setActiveContour';
  contourId: string;
}

// ═══════════════════════════════════════════════════════════
// SEGMENT OPERATIONS
// ═══════════════════════════════════════════════════════════

export interface UpgradeLineSegmentCommand {
  type: 'upgradeLineSegment';
  /** The second anchor point of the line segment to upgrade */
  anchorPointId: string;
}

// ═══════════════════════════════════════════════════════════
// HISTORY OPERATIONS
// ═══════════════════════════════════════════════════════════

export interface UndoCommand {
  type: 'undo';
}

export interface RedoCommand {
  type: 'redo';
}

// ═══════════════════════════════════════════════════════════
// SESSION OPERATIONS
// ═══════════════════════════════════════════════════════════

export interface StartEditSessionCommand {
  type: 'startEditSession';
  glyphUnicode: number;
}

export interface EndEditSessionCommand {
  type: 'endEditSession';
}

// ═══════════════════════════════════════════════════════════
// UNION TYPE
// ═══════════════════════════════════════════════════════════

export type Command =
  | AddPointCommand
  | MovePointsCommand
  | RemovePointsCommand
  | SetPointPositionCommand
  | TogglePointSmoothCommand
  | AddContourCommand
  | CloseContourCommand
  | RemoveContourCommand
  | SetActiveContourCommand
  | UpgradeLineSegmentCommand
  | UndoCommand
  | RedoCommand
  | StartEditSessionCommand
  | EndEditSessionCommand;

// ═══════════════════════════════════════════════════════════
// TYPE GUARDS
// ═══════════════════════════════════════════════════════════

export function isPointCommand(cmd: Command): cmd is
  | AddPointCommand
  | MovePointsCommand
  | RemovePointsCommand
  | SetPointPositionCommand
  | TogglePointSmoothCommand {
  return ['addPoint', 'movePoints', 'removePoints', 'setPointPosition', 'togglePointSmooth'].includes(cmd.type);
}

export function isContourCommand(cmd: Command): cmd is
  | AddContourCommand
  | CloseContourCommand
  | RemoveContourCommand
  | SetActiveContourCommand {
  return ['addContour', 'closeContour', 'removeContour', 'setActiveContour'].includes(cmd.type);
}

export function isHistoryCommand(cmd: Command): cmd is UndoCommand | RedoCommand {
  return cmd.type === 'undo' || cmd.type === 'redo';
}
