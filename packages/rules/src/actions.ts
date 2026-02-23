/**
 * Rule Actions - Apply matched rules to compute point positions
 */

import { Glyphs } from "@shift/font";
import { Vec2 } from "@shift/geo";
import type { Point, PointId, GlyphSnapshot, Point2D } from "@shift/types";
import type {
  DragPatch,
  MatchedRule,
  MatchedRuleById,
  PointMove,
  RuleAffectedRole,
  RuleId,
} from "./types";
import { pickRule } from "./matcher";
import { maintainCollinearity, maintainTangency } from "./constraints";

function findPointById(glyph: GlyphSnapshot, pointId: PointId | undefined): Point | null {
  if (!pointId) return null;
  const found = Glyphs.findPoint(glyph, pointId);
  if (!found) return null;
  return found.point;
}

function findAffectedPointByRole<Id extends RuleId, Role extends RuleAffectedRole<Id>>(
  glyph: GlyphSnapshot,
  rule: MatchedRuleById<Id>,
  role: Role,
): Point | null {
  return findPointById(glyph, rule.affected[role]);
}

function findAffectedPointsByRole<
  Id extends RuleId,
  const Roles extends readonly RuleAffectedRole<Id>[],
>(
  glyph: GlyphSnapshot,
  rule: MatchedRuleById<Id>,
  ...roles: Roles
): { [K in keyof Roles]: Point | null } {
  return roles.map((role) => findAffectedPointByRole(glyph, rule, role)) as {
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

/**
 * Apply a matched rule and compute the resulting point moves
 */
function applyRule(glyph: GlyphSnapshot, rule: MatchedRule, mousePos: Point2D): PointMove[] {
  const moves: PointMove[] = [];

  switch (rule.ruleId) {
    case "moveRightHandle": {
      const rightHandle = findAffectedPointByRole(glyph, rule, "rightHandle");
      pushTranslatedMove(moves, rightHandle, mousePos);
      break;
    }
    case "moveLeftHandle": {
      const leftHandle = findAffectedPointByRole(glyph, rule, "leftHandle");
      pushTranslatedMove(moves, leftHandle, mousePos);
      break;
    }
    case "moveBothHandles": {
      const leftHandle = findAffectedPointByRole(glyph, rule, "leftHandle");
      const rightHandle = findAffectedPointByRole(glyph, rule, "rightHandle");
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
      const selectedHandle = findPointById(glyph, rule.pointId);
      const [smooth, oppositeHandle] = findAffectedPointsByRole(
        glyph,
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
      const selected = findPointById(glyph, rule.pointId);
      if (!selected) break;

      const [target, reference] = findAffectedPointsByRole(glyph, rule, "target", "reference");
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
        glyph,
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
        glyph,
        rule,
        "otherSmooth",
        "otherHandle",
        "associatedHandle",
      );
      const selectedSmooth = findPointById(glyph, rule.pointId);
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
      const handlePos = findPointById(glyph, rule.pointId);
      const [smoothPos, endPos] = findAffectedPointsByRole(glyph, rule, "smooth", "end");
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

export function constrainDrag(input: ConstrainDragInput): DragPatch {
  const { glyph, selectedIds, mousePosition } = input;

  const selectedMoves = new Map<PointId, PointMove>();
  const matched: MatchedRule[] = [];

  for (const pointId of selectedIds) {
    const found = Glyphs.findPoint(glyph, pointId);
    if (!found) continue;

    const { point, contour } = found;

    const delta = Vec2.add(point, mousePosition);
    selectedMoves.set(pointId, {
      id: pointId,
      ...delta,
    });

    const rule = pickRule(contour, pointId, selectedIds);
    if (rule) matched.push(rule);
  }

  // Apply rules — rule moves override selected moves, and add non-selected moves
  const pointMoves = new Map(selectedMoves);
  for (const rule of matched) {
    for (const move of applyRule(glyph, rule, mousePosition)) {
      pointMoves.set(move.id, move);
    }
  }

  return {
    pointUpdates: Array.from(pointMoves.values()),
    matched,
  };
}
