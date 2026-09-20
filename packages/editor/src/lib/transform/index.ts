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
 * import { Transform } from '.';
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
} from "@shift/editor/lib/transform/types";

// Pure transform functions
export { Transform } from "@shift/editor/lib/transform/Transform";

// Alignment utilities
export { Alignment } from "@shift/editor/lib/transform/Alignment";

// Anchor utilities
export { anchorToPoint } from "./anchor";

// Zoom-from-wheel (viewport zoom sensitivity)
export { zoomMultiplierFromWheel, type ZoomFromWheelOptions } from "./zoomFromWheel";
