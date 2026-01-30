import type { PointType } from "@shift/types";

export type ValidationErrorCode =
  | "EMPTY_SEQUENCE"
  | "MUST_START_WITH_ON_CURVE"
  | "MUST_END_WITH_ON_CURVE"
  | "TOO_MANY_CONSECUTIVE_OFF_CURVE"
  | "ORPHAN_OFF_CURVE"
  | "INCOMPLETE_SEGMENT";

export type ValidationError = {
  code: ValidationErrorCode;
  message: string;
  context?: { index?: number; pointType?: PointType };
};

export type ValidationResult<T = void> =
  | { valid: true; value: T }
  | { valid: false; errors: ValidationError[] };

export type PointLike = { pointType: PointType };
