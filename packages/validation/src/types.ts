import type { PointType } from "@shift/types";

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

export type ValidationError = {
  code: ValidationErrorCode;
  message: string;
  context?: Record<string, unknown>;
};

export type ValidationResult<T = void> =
  | { valid: true; value: T }
  | { valid: false; errors: ValidationError[] };

export type PointLike = { pointType: PointType };
