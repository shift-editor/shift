/**
 * Rule Actions - Apply matched rules to compute point positions
 */

import { Vec2 } from "@shift/geo";
import type { ContourSnapshot, Point, PointId, GlyphSnapshot, Point2D } from "@shift/types";
import type {
  DragPatch,
  MatchedRule,
  MatchedRuleById,
  PointMove,
  RuleAffectedRole,
  RuleId,
} from "./types";
import { pickRuleAtIndex } from "./matcher";
import { maintainCollinearity, maintainTangency } from "./constraints";

type IndexedPoint = {
  point: Point;
  contour: ContourSnapshot;
  index: number;
};

type PointIndex = Map<PointId, IndexedPoint>;

export interface PreparedConstrainDrag {
  selectedIds: ReadonlySet<PointId>;
  pointIndex: PointIndex;
  selectedPoints: readonly Point[];
  matchedRules: readonly MatchedRule[];
}

function getPointAtContourOffset(
  contour: ContourSnapshot,
  centerIndex: number,
  offset: number,
): Point | undefined {
  const nextIndex = centerIndex + offset;
  if (contour.closed) {
    const total = contour.points.length;
    if (total === 0) return undefined;
    const wrapped = ((nextIndex % total) + total) % total;
    return contour.points[wrapped];
  }
  return contour.points[nextIndex];
}

function buildPointIndex(glyph: GlyphSnapshot): PointIndex {
  const index = new Map<PointId, IndexedPoint>();

  for (const contour of glyph.contours) {
    for (let pointIndex = 0; pointIndex < contour.points.length; pointIndex += 1) {
      const point = contour.points[pointIndex];
      if (!point) continue;
      index.set(point.id, {
        point,
        contour,
        index: pointIndex,
      });
    }
  }

  return index;
}

function findPointById(pointIndex: PointIndex, pointId: PointId | undefined): Point | null {
  if (!pointId) return null;
  const found = pointIndex.get(pointId);
  if (!found) return null;
  return found.point;
}

function findAffectedPointByRole<Id extends RuleId, Role extends RuleAffectedRole<Id>>(
  pointIndex: PointIndex,
  rule: MatchedRuleById<Id>,
  role: Role,
): Point | null {
  return findPointById(pointIndex, rule.affected[role]);
}

function findAffectedPointsByRole<
  Id extends RuleId,
  const Roles extends readonly RuleAffectedRole<Id>[],
>(
  pointIndex: PointIndex,
  rule: MatchedRuleById<Id>,
  ...roles: Roles
): { [K in keyof Roles]: Point | null } {
  return roles.map((role) => findAffectedPointByRole(pointIndex, rule, role)) as {
    [K in keyof Roles]: Point | null;
  };
}

function pushTranslatedMove(moves: PointMove[], point: Point | null, mousePos: Point2D): void {
  if (!point) return;
  moves.push({
    id: point.id,
    ...Vec2.add(point, mousePos),
  });
}

function selectionNeedsRuleResolution(
  pointIndex: PointIndex,
  selectedIds: ReadonlySet<PointId>,
): boolean {
  for (const pointId of selectedIds) {
    const found = pointIndex.get(pointId);
    if (!found) continue;

    const { point, contour, index } = found;
    if (point.pointType === "offCurve" || point.smooth) {
      return true;
    }

    const prev = getPointAtContourOffset(contour, index, -1);
    const next = getPointAtContourOffset(contour, index, 1);
    if (
      prev?.pointType === "offCurve" ||
      next?.pointType === "offCurve" ||
      prev?.smooth ||
      next?.smooth
    ) {
      return true;
    }
  }

  return false;
}

export function prepareConstrainDrag(
  glyph: GlyphSnapshot,
  selectedIds: ReadonlySet<PointId>,
): PreparedConstrainDrag {
  const pointIndex = buildPointIndex(glyph);
  const selectedPoints: Point[] = [];
  const matchedRules: MatchedRule[] = [];
  const needsRuleResolution = selectionNeedsRuleResolution(pointIndex, selectedIds);

  for (const pointId of selectedIds) {
    const found = pointIndex.get(pointId);
    if (!found) continue;

    selectedPoints.push(found.point);

    if (!needsRuleResolution) {
      continue;
    }

    const rule = pickRuleAtIndex(found.contour, pointId, found.index, selectedIds);
    if (rule) {
      matchedRules.push(rule);
    }
  }

  return {
    selectedIds,
    pointIndex,
    selectedPoints,
    matchedRules,
  };
}

/**
 * Apply a matched rule and compute the resulting point moves
 */
function applyRule(pointIndex: PointIndex, rule: MatchedRule, mousePos: Point2D): PointMove[] {
  const moves: PointMove[] = [];

  switch (rule.ruleId) {
    case "moveRightHandle": {
      const rightHandle = findAffectedPointByRole(pointIndex, rule, "rightHandle");
      pushTranslatedMove(moves, rightHandle, mousePos);
      break;
    }
    case "moveLeftHandle": {
      const leftHandle = findAffectedPointByRole(pointIndex, rule, "leftHandle");
      pushTranslatedMove(moves, leftHandle, mousePos);
      break;
    }
    case "moveBothHandles": {
      const leftHandle = findAffectedPointByRole(pointIndex, rule, "leftHandle");
      const rightHandle = findAffectedPointByRole(pointIndex, rule, "rightHandle");
      const seen = new Set<PointId>();
      for (const handle of [leftHandle, rightHandle]) {
        if (!handle || seen.has(handle.id)) continue;
        seen.add(handle.id);
        pushTranslatedMove(moves, handle, mousePos);
      }
      break;
    }

    case "maintainTangencyRight":
    case "maintainTangencyLeft": {
      const selectedHandle = findPointById(pointIndex, rule.pointId);
      const [smooth, oppositeHandle] = findAffectedPointsByRole(
        pointIndex,
        rule,
        "smooth",
        "oppositeHandle",
      );
      if (!selectedHandle || !smooth || !oppositeHandle) break;

      const newOppositePos = maintainTangency(selectedHandle, smooth, oppositeHandle, mousePos);
      moves.push({
        id: oppositeHandle.id,
        ...newOppositePos,
      });

      break;
    }
    case "maintainTangencyBoth": {
      const selected = findPointById(pointIndex, rule.pointId);
      if (!selected) break;

      const [target, reference] = findAffectedPointsByRole(pointIndex, rule, "target", "reference");
      if (target && reference) {
        const newSmooth = Vec2.add(selected, mousePos);
        const newDirection = Vec2.sub(reference, newSmooth);
        const oppositeLen = Vec2.len(Vec2.sub(target, selected));

        const newArmDir = Vec2.normalize(newDirection);
        const newPos = Vec2.add(newSmooth, Vec2.scale(newArmDir, -oppositeLen));

        moves.push({
          id: target.id,
          ...newPos,
        });

        break;
      }

      const [leftHandle, leftSmooth, rightSmooth, rightHandle] = findAffectedPointsByRole(
        pointIndex,
        rule,
        "leftHandle",
        "leftSmooth",
        "rightSmooth",
        "rightHandle",
      );
      if (leftHandle && leftSmooth && rightSmooth && rightHandle) {
        const tangentLeft = maintainTangency(selected, leftSmooth, leftHandle, mousePos);
        const tangentRight = maintainTangency(selected, rightSmooth, rightHandle, mousePos);

        moves.push({
          id: leftHandle.id,
          ...tangentLeft,
        });
        moves.push({
          id: rightHandle.id,
          ...tangentRight,
        });

        break;
      }

      const [otherSmooth, otherHandle, associatedHandle] = findAffectedPointsByRole(
        pointIndex,
        rule,
        "otherSmooth",
        "otherHandle",
        "associatedHandle",
      );
      const selectedSmooth = findPointById(pointIndex, rule.pointId);
      if (otherHandle && otherSmooth && associatedHandle && selectedSmooth) {
        const newSmooth = Vec2.add(selectedSmooth, mousePos);
        const newDirection = Vec2.sub(otherSmooth, newSmooth);
        const newArmDir = Vec2.normalize(newDirection);

        const assocatedHandleLen = Vec2.len(Vec2.sub(selectedSmooth, associatedHandle));
        const otherHandleLen = Vec2.len(Vec2.sub(otherSmooth, otherHandle));

        const newAssociatedHandlePos = Vec2.add(
          newSmooth,
          Vec2.scale(newArmDir, -assocatedHandleLen),
        );
        const newOtherHandlePos = Vec2.add(otherSmooth, Vec2.scale(newArmDir, otherHandleLen));

        moves.push({
          id: associatedHandle.id,
          ...newAssociatedHandlePos,
        });
        moves.push({
          id: otherHandle.id,
          ...newOtherHandlePos,
        });
      }

      break;
    }
    case "maintainCollinearity": {
      const handlePos = findPointById(pointIndex, rule.pointId);
      const [smoothPos, endPos] = findAffectedPointsByRole(pointIndex, rule, "smooth", "end");
      if (!handlePos || !smoothPos || !endPos) {
        break;
      }

      const newPos = maintainCollinearity(smoothPos, endPos, handlePos, mousePos);
      if (!newPos) break;

      moves.push({
        id: rule.pointId,
        ...newPos,
      });

      break;
    }
  }

  return moves;
}

/**
 * Constrain a drag frame and compute absolute point positions.
 *
 * `glyph` is the **base** glyph (unchanged). The delta is applied internally.
 */
export interface ConstrainDragInput {
  glyph: GlyphSnapshot;
  selectedIds: ReadonlySet<PointId>;
  mousePosition: Point2D;
}

export interface ConstrainDragOptions {
  includeMatchedRules?: boolean;
}

export function constrainDrag(
  input: ConstrainDragInput,
  options?: ConstrainDragOptions,
): DragPatch {
  const { glyph, selectedIds, mousePosition } = input;
  return constrainPreparedDrag(prepareConstrainDrag(glyph, selectedIds), mousePosition, options);
}

export function constrainPreparedDrag(
  prepared: PreparedConstrainDrag,
  mousePosition: Point2D,
  options?: ConstrainDragOptions,
): DragPatch {
  const { pointIndex, selectedPoints, matchedRules } = prepared;
  const includeMatchedRules = options?.includeMatchedRules ?? true;
  const selectedMoves = new Map<PointId, PointMove>();

  for (const point of selectedPoints) {
    selectedMoves.set(point.id, {
      id: point.id,
      ...Vec2.add(point, mousePosition),
    });
  }

  if (matchedRules.length === 0) {
    return {
      pointUpdates: Array.from(selectedMoves.values()),
      matched: [],
    };
  }

  // Apply rules — rule moves override selected moves, and add non-selected moves
  const pointMoves = new Map(selectedMoves);
  for (const rule of matchedRules) {
    for (const move of applyRule(pointIndex, rule, mousePosition)) {
      pointMoves.set(move.id, move);
    }
  }

  return {
    pointUpdates: Array.from(pointMoves.values()),
    matched: includeMatchedRules ? [...matchedRules] : [],
  };
}
