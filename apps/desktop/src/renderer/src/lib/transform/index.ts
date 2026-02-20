/**
 * Transform System
 *
 * Provides geometry transformation operations for selected points:
 * - Rotate
 * - Scale
 * - Reflect (mirror/flip)
 * - Arbitrary matrix transforms
 *
 * @example
 * ```ts
 * import { Transform, RotatePointsCommand } from '@/lib/transform';
 *
 * // Pure function usage (for preview/calculations)
 * const rotated = Transform.rotatePoints(points, Math.PI/2, center);
 *
 * // Command usage (for undo/redo)
 * const cmd = new RotatePointsCommand(pointIds, Math.PI/2, center);
 * commandHistory.execute(cmd);
 * ```
 */

// Types (re-export from centralized types)
export type {
  TransformablePoint,
  ReflectAxis,
  TransformOptions,
  ScaleOptions,
  AlignmentType,
  DistributeType,
} from "./types";

// Pure transform functions
export { Transform } from "./Transform";

// Alignment utilities
export { Alignment } from "./Alignment";

// Anchor utilities
export { anchorToPoint } from "./anchor";

// Zoom-from-wheel (viewport zoom sensitivity)
export { zoomMultiplierFromWheel, type ZoomFromWheelOptions } from "./zoomFromWheel";

// Selection bounds utilities
export { getSegmentAwareBounds } from "./SelectionBounds";

// Commands for undo/redo (re-export from commands/transform)
export {
  RotatePointsCommand,
  ScalePointsCommand,
  ReflectPointsCommand,
  MoveSelectionToCommand,
  AlignPointsCommand,
  DistributePointsCommand,
} from "../commands/transform";
