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
 * import { Transform } from '@/lib/transform';
 *
 * // Pure function usage (for preview/calculations)
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

// Alignment utilities
export { Alignment } from "./Alignment";

// Anchor utilities
export { anchorToPoint } from "./anchor";

// Zoom-from-wheel (viewport zoom sensitivity)
export { zoomMultiplierFromWheel, type ZoomFromWheelOptions } from "./zoomFromWheel";
