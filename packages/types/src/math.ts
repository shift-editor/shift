/**
 * Core mathematical types used throughout Shift
 */

export type Point2D = { x: number; y: number };

export type Rect2D = {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** X scale factor of the transformation matrix */
export type A = number;

/** Y skew factor of the transformation matrix */
export type B = number;

/** X skew factor of the transformation matrix */
export type C = number;

/** Y scale factor of the transformation matrix */
export type D = number;

/** X translation of the transformation matrix */
export type E = number;

/** Y translation of the transformation matrix */
export type F = number;

/**
 * Represents a 2D transformation matrix in the form:
 * ```
 * | A C E |
 * | B D F |
 * | 0 0 1 |
 * ```
 * Where:
 * - A is x scale factor
 * - B is y skew factor
 * - C is x skew factor
 * - D is y scale factor
 * - E is x translation
 * - F is y translation
 */
export type TransformMatrix = [A, B, C, D, E, F];
