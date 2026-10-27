/**
 * Transform System
 *
 * Matrices about an origin, applied to points for rotate and scale previews.
 * Committed transforms run in shift-font (`TransformPoints`).
 *
 * @example
 * ```ts
 * import { Transform } from '.';
 *
 * const rotated = Transform.rotatePoints(points, Math.PI/2, center);
 * ```
 */

// Types (re-export from centralized types)
export type {
  ReflectAxis,
  TransformOptions,
  ScaleOptions,
  AlignmentType,
  DistributeType,
} from "./types";

// Pure transform functions
export { Transform } from "./Transform";

// Anchor utilities
export { anchorToPoint } from "./anchor";

// Zoom-from-wheel (viewport zoom sensitivity)
export { zoomMultiplierFromWheel, type ZoomFromWheelOptions } from "./zoomFromWheel";
