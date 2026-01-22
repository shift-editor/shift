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

// Types
export type {
  TransformablePoint,
  ReflectAxis,
  TransformOptions,
  ScaleOptions,
  SelectionBounds,
} from "./types";

// Pure transform functions
export { Transform } from "./Transform";

// Commands for undo/redo
export {
  RotatePointsCommand,
  ScalePointsCommand,
  ReflectPointsCommand,
  TransformMatrixCommand,
} from "./TransformCommands";
