/**
 * @shift/validation - point-type predicates and clipboard payload checks.
 *
 * @example
 * ```ts
 * import { Validate, ValidateClipboard } from '@shift/validation';
 *
 * if (Validate.hasValidAnchor(points)) {
 *   // Safe to copy
 * }
 * ```
 */

export { Validate } from "./Validate";
export { ValidateClipboard } from "./ValidateClipboard";

export type { PointLike } from "./types";
