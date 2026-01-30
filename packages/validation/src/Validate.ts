import type { ValidationResult, ValidationError, ValidationErrorCode, PointLike } from "./types";

export const Validate = {
  ok<T>(value?: T): ValidationResult<T> {
    return { valid: true, value: value as T };
  },

  fail(error: ValidationError): ValidationResult<never> {
    return { valid: false, errors: [error] };
  },

  error(
    code: ValidationErrorCode,
    message: string,
    context?: ValidationError["context"],
  ): ValidationError {
    return context ? { code, message, context } : { code, message };
  },

  isOnCurve(point: PointLike): boolean {
    return point.pointType === "onCurve";
  },

  isOffCurve(point: PointLike): boolean {
    return point.pointType === "offCurve";
  },

  countConsecutiveOffCurve(points: readonly PointLike[], startIndex: number): number {
    let count = 0;
    for (let i = startIndex; i < points.length; i++) {
      if (points[i].pointType === "offCurve") {
        count++;
      } else {
        break;
      }
    }
    return count;
  },

  findNextOnCurve(points: readonly PointLike[], startIndex: number): number | null {
    for (let i = startIndex; i < points.length; i++) {
      if (points[i].pointType === "onCurve") {
        return i;
      }
    }
    return null;
  },

  matchesLinePattern(points: readonly PointLike[]): boolean {
    return (
      points.length === 2 && points[0].pointType === "onCurve" && points[1].pointType === "onCurve"
    );
  },

  matchesQuadPattern(points: readonly PointLike[]): boolean {
    return (
      points.length === 3 &&
      points[0].pointType === "onCurve" &&
      points[1].pointType === "offCurve" &&
      points[2].pointType === "onCurve"
    );
  },

  matchesCubicPattern(points: readonly PointLike[]): boolean {
    return (
      points.length === 4 &&
      points[0].pointType === "onCurve" &&
      points[1].pointType === "offCurve" &&
      points[2].pointType === "offCurve" &&
      points[3].pointType === "onCurve"
    );
  },

  sequence(points: readonly PointLike[]): ValidationResult {
    if (points.length === 0) {
      return Validate.fail(Validate.error("EMPTY_SEQUENCE", "Point sequence cannot be empty"));
    }

    if (points[0].pointType !== "onCurve") {
      return Validate.fail(
        Validate.error(
          "MUST_START_WITH_ON_CURVE",
          "Point sequence must start with an onCurve point",
          { index: 0, pointType: points[0].pointType },
        ),
      );
    }

    if (points[points.length - 1].pointType !== "onCurve") {
      return Validate.fail(
        Validate.error("MUST_END_WITH_ON_CURVE", "Point sequence must end with an onCurve point", {
          index: points.length - 1,
          pointType: points[points.length - 1].pointType,
        }),
      );
    }

    for (let i = 0; i < points.length; i++) {
      if (points[i].pointType === "offCurve") {
        const consecutiveCount = Validate.countConsecutiveOffCurve(points, i);
        if (consecutiveCount > 2) {
          return Validate.fail(
            Validate.error(
              "TOO_MANY_CONSECUTIVE_OFF_CURVE",
              `Found ${consecutiveCount} consecutive offCurve points (max 2 for cubic)`,
              { index: i },
            ),
          );
        }
        i += consecutiveCount - 1;
      }
    }

    return Validate.ok();
  },

  canFormSegments(points: readonly PointLike[]): ValidationResult {
    const seqResult = Validate.sequence(points);
    if (!seqResult.valid) {
      return seqResult;
    }

    if (points.length < 2) {
      return Validate.fail(
        Validate.error("INCOMPLETE_SEGMENT", "Need at least 2 points to form a segment"),
      );
    }

    let i = 0;
    while (i < points.length - 1) {
      const current = points[i];

      if (current.pointType !== "onCurve") {
        return Validate.fail(
          Validate.error("ORPHAN_OFF_CURVE", "offCurve point without preceding onCurve anchor", {
            index: i,
            pointType: current.pointType,
          }),
        );
      }

      const next = points[i + 1];

      if (next.pointType === "onCurve") {
        i += 1;
        continue;
      }

      const offCurveCount = Validate.countConsecutiveOffCurve(points, i + 1);
      const nextOnCurveIdx = i + 1 + offCurveCount;

      if (nextOnCurveIdx >= points.length) {
        return Validate.fail(
          Validate.error("INCOMPLETE_SEGMENT", "offCurve points without following onCurve anchor", {
            index: i + 1,
          }),
        );
      }

      i = nextOnCurveIdx;
    }

    return Validate.ok();
  },

  isValidSequence(points: readonly PointLike[]): boolean {
    if (points.length === 0) return false;
    if (points[0].pointType !== "onCurve") return false;
    if (points[points.length - 1].pointType !== "onCurve") return false;

    for (let i = 0; i < points.length; i++) {
      if (points[i].pointType === "offCurve") {
        const count = Validate.countConsecutiveOffCurve(points, i);
        if (count > 2) return false;
        i += count - 1;
      }
    }

    return true;
  },

  canFormValidSegments(points: readonly PointLike[]): boolean {
    if (points.length < 2) return false;
    if (!Validate.isValidSequence(points)) return false;

    let i = 0;
    while (i < points.length - 1) {
      if (points[i].pointType !== "onCurve") return false;

      const next = points[i + 1];
      if (next.pointType === "onCurve") {
        i += 1;
        continue;
      }

      const offCurveCount = Validate.countConsecutiveOffCurve(points, i + 1);
      const nextOnCurveIdx = i + 1 + offCurveCount;

      if (nextOnCurveIdx >= points.length) return false;

      i = nextOnCurveIdx;
    }

    return true;
  },

  hasAnchor(points: readonly PointLike[]): ValidationResult {
    if (points.length === 0) {
      return Validate.fail(Validate.error("EMPTY_SEQUENCE", "Point sequence cannot be empty"));
    }

    const hasOnCurve = points.some((p) => p.pointType === "onCurve");
    if (!hasOnCurve) {
      return Validate.fail(
        Validate.error(
          "ORPHAN_OFF_CURVE",
          "Point sequence must contain at least one onCurve anchor point",
        ),
      );
    }

    return Validate.ok();
  },

  hasValidAnchor(points: readonly PointLike[]): boolean {
    if (points.length === 0) return false;
    return points.some((p) => p.pointType === "onCurve");
  },
} as const;
