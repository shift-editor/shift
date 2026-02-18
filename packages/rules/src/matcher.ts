/**
 * Pattern Matcher - Matches point patterns against rules
 */

import { Contours } from "@shift/font";
import type { PointId, PointSnapshot } from "@shift/types";
import type { MatchedRule, RuleId } from "./types";
import { TOKEN_NO_POINT, TOKEN_CORNER, TOKEN_HANDLE, TOKEN_SMOOTH, TOKEN_SELECTED } from "./parser";
import { getRuleTable } from "./rules";

const WINDOW_SIZES = [3, 5] as const;

/**
 * Get point token for pattern matching
 */
function getPointToken(
  point: PointSnapshot | undefined,
  selectedIds: ReadonlySet<PointId>,
  isCentral: boolean,
): string {
  if (!point) {
    return TOKEN_NO_POINT;
  }

  // Selected marker (but not for central point - that's the one we're matching)
  if (selectedIds.has(point.id) && !isCentral) {
    return TOKEN_SELECTED;
  }

  // Point type token
  if (point.pointType === "offCurve") {
    return TOKEN_HANDLE;
  }

  // On-curve: smooth or corner
  return point.smooth ? TOKEN_SMOOTH : TOKEN_CORNER;
}

/**
 * Build a pattern string for points around a given index
 */
function buildPattern(
  points: readonly PointSnapshot[],
  centerIndex: number,
  selectedIds: ReadonlySet<PointId>,
  windowSize: number,
): string {
  const halfWindow = Math.floor(windowSize / 2);
  let pattern = "";

  for (let offset = -halfWindow; offset <= halfWindow; offset++) {
    const index = centerIndex + offset;
    const point = index >= 0 && index < points.length ? points[index] : undefined;
    const isCentral = offset === 0;
    pattern += getPointToken(point, selectedIds, isCentral);
  }

  return pattern;
}

/**
 * Compute affected point IDs based on rule type
 */
function computeAffectedPoints(
  points: readonly PointSnapshot[],
  pointIndex: number,
  ruleId: RuleId,
): PointId[] {
  const affected: PointId[] = [];

  switch (ruleId) {
    case "moveRightHandle":
      if (pointIndex + 1 < points.length) {
        affected.push(points[pointIndex + 1].id);
      }
      break;

    case "moveLeftHandle":
      if (pointIndex > 0) {
        affected.push(points[pointIndex - 1].id);
      }
      break;

    case "moveBothHandles":
      if (pointIndex > 0) {
        affected.push(points[pointIndex - 1].id);
      }
      if (pointIndex + 1 < points.length) {
        affected.push(points[pointIndex + 1].id);
      }
      break;

    case "maintainTangencyRight":
      // Affected: anchor (index-1) and opposite handle (index-2)
      if (pointIndex > 0) {
        affected.push(points[pointIndex - 1].id); // anchor
        if (pointIndex > 1) {
          affected.push(points[pointIndex - 2].id); // opposite handle
        }
      }
      break;

    case "maintainTangencyLeft":
      // Affected: anchor (index+1) and opposite handle (index+2)
      if (pointIndex + 1 < points.length) {
        affected.push(points[pointIndex + 1].id); // anchor
        if (pointIndex + 2 < points.length) {
          affected.push(points[pointIndex + 2].id); // opposite handle
        }
      }

    case "maintainCollinearity":
      {
        // TODO: Implement maintain collinearity
      }
      break;
  }

  return affected;
}

type ContourMatchInput = {
  readonly points: readonly PointSnapshot[];
};

/**
 * Match a rule for a selected point in a contour
 */
export function matchRule(
  contour: ContourMatchInput,
  pointId: PointId,
  selectedIds: ReadonlySet<PointId>,
): MatchedRule | null {
  const pointIndex = Contours.findPointIndex(contour, pointId);
  if (pointIndex === -1) {
    return null;
  }

  const ruleTable = getRuleTable();
  const points = contour.points;

  // Try each window size
  for (const windowSize of WINDOW_SIZES) {
    const pattern = buildPattern(points, pointIndex, selectedIds, windowSize);
    const rule = ruleTable.get(pattern);

    if (rule) {
      const affectedPointIds = computeAffectedPoints(points, pointIndex, rule.id);

      return {
        pointId,
        ruleId: rule.id,
        description: rule.description,
        pattern,
        affectedPointIds,
      };
    }
  }

  return null;
}
