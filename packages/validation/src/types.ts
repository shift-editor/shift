/**
 * Core types for the validation package.
 *
 * Validators return a {@link ValidationResult} discriminated union so callers
 * can branch on `valid` and access either the parsed value or a list of
 * structured {@link ValidationError}s.
 *
 * @module
 */
import type { PointType } from "@shift/types";

/** Machine-readable codes for every validation failure the package can report. */
export type ValidationErrorCode =
  | "EMPTY_SEQUENCE"
  | "MUST_START_WITH_ON_CURVE"
  | "MUST_END_WITH_ON_CURVE"
  | "TOO_MANY_CONSECUTIVE_OFF_CURVE"
  | "ORPHAN_OFF_CURVE"
  | "INCOMPLETE_SEGMENT"
  | "INVALID_SNAPSHOT_STRUCTURE"
  | "INVALID_CONTOUR_STRUCTURE"
  | "INVALID_POINT_STRUCTURE"
  | "INVALID_POINT_TYPE"
  | "INVALID_CLIPBOARD_CONTENT";

/**
 * A single validation failure. `code` identifies the rule that failed,
 * `message` is human-readable, and `context` carries optional structured
 * data (e.g. the offending index or value).
 */
export type ValidationError = {
  code: ValidationErrorCode;
  message: string;
  context?: Record<string, unknown>;
};

/**
 * Discriminated union returned by all validators.
 *
 * When `valid` is `true`, `value` holds the parsed/validated payload of
 * type `T`. When `false`, `errors` contains one or more failures.
 * Defaults to `void` for validators that only check correctness without
 * producing a transformed value.
 */
export type ValidationResult<T = void> =
  | { valid: true; value: T }
  | { valid: false; errors: ValidationError[] };

/**
 * Minimal shape required by point-sequence validators.
 * Accepts any object that carries a `pointType` -- full `Point` snapshots,
 * domain `Point` objects, and lightweight test stubs all qualify.
 */
export type PointLike = { pointType: PointType };
