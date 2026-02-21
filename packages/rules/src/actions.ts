/**
 * Rule Actions - Apply matched rules to compute point positions
 */

import { Glyphs } from "@shift/font";
import { Vec2 } from "@shift/geo";
import type { PointId, GlyphSnapshot, Point2D } from "@shift/types";
import type { MatchedRule, PointMove, RulesResult } from "./types";
import { matchRule } from "./matcher";

const EPSILON = 1e-10;

/**
 * Maintain tangency by rotating the opposite handle
 *
 * When a handle is moved, the opposite handle rotates to maintain
 * a straight line through the anchor point, preserving its magnitude.
 */
function maintainTangency(
  glyph: GlyphSnapshot,
  anchorId: PointId,
  oppositeHandleId: PointId,
  newMovedPos: Point2D,
): PointMove | null {
  const anchor = Glyphs.findPoint(glyph, anchorId)?.point;
  const opposite = Glyphs.findPoint(glyph, oppositeHandleId)?.point;

  if (!anchor || !opposite) {
    return null;
  }

  // Calculate the magnitude of the opposite handle from anchor
  const oppositeVec = Vec2.sub(opposite, anchor);
  const oppositeMagnitude = Vec2.len(oppositeVec);

  // Get direction from anchor to moved handle (new position)
  const movedVec = Vec2.sub(newMovedPos, anchor);
  const movedLen = Vec2.len(movedVec);

  // If moved handle is at anchor, preserve opposite position
  if (movedLen < EPSILON) {
    return null;
  }

  // Normalize and flip direction for opposite handle
  const normalized = Vec2.normalize(movedVec);
  const newOppositePos = Vec2.add(anchor, Vec2.scale(normalized, -oppositeMagnitude));

  return {
    id: oppositeHandleId,
    x: newOppositePos.x,
    y: newOppositePos.y,
  };
}

/**
 * Apply a matched rule and compute the resulting point moves
 */
function applyRule(
  glyph: GlyphSnapshot,
  rule: MatchedRule,
  selectedMoves: Map<PointId, PointMove>,
  dx: number,
  dy: number,
): PointMove[] {
  const moves: PointMove[] = [];

  switch (rule.ruleId) {
    case "moveRightHandle":
    case "moveLeftHandle":
    case "moveBothHandles": {
      // Move handles by the same delta as the anchor
      for (const handleId of rule.affectedPointIds) {
        const handle = Glyphs.findPoint(glyph, handleId)?.point;
        if (handle) {
          moves.push({
            id: handleId,
            x: handle.x + dx,
            y: handle.y + dy,
          });
        }
      }
      break;
    }

    case "maintainTangencyRight": {
      // affectedPointIds: [anchorId, oppositeHandleId]
      if (rule.affectedPointIds.length >= 2) {
        const anchorId = rule.affectedPointIds[0];
        const oppositeHandleId = rule.affectedPointIds[1];
        if (!anchorId || !oppositeHandleId) {
          break;
        }

        // Get the new position of the moved handle
        const movedHandle = Glyphs.findPoint(glyph, rule.pointId)?.point;
        if (movedHandle) {
          const newMovedPos = selectedMoves.get(rule.pointId) ?? {
            x: movedHandle.x + dx,
            y: movedHandle.y + dy,
          };

          const tangencyMove = maintainTangency(glyph, anchorId, oppositeHandleId, newMovedPos);

          if (tangencyMove) {
            moves.push(tangencyMove);
          }
        }
      }
      break;
    }

    case "maintainTangencyLeft": {
      // affectedPointIds: [anchorId, oppositeHandleId]
      if (rule.affectedPointIds.length >= 2) {
        const anchorId = rule.affectedPointIds[0];
        const oppositeHandleId = rule.affectedPointIds[1];
        if (!anchorId || !oppositeHandleId) {
          break;
        }

        // Get the new position of the moved handle
        const movedHandle = Glyphs.findPoint(glyph, rule.pointId)?.point;
        if (movedHandle) {
          const newMovedPos = selectedMoves.get(rule.pointId) ?? {
            x: movedHandle.x + dx,
            y: movedHandle.y + dy,
          };

          const tangencyMove = maintainTangency(glyph, anchorId, oppositeHandleId, newMovedPos);

          if (tangencyMove) {
            moves.push(tangencyMove);
          }
        }
      }
      break;
    }
    case "maintainCollinearity": {
      break;
    }
  }

  return moves;
}

/**
 * Apply rules to a selection and compute all point moves
 *
 * @param glyph - Current glyph snapshot
 * @param selectedIds - Set of selected point IDs
 * @param dx - Delta X to move
 * @param dy - Delta Y to move
 * @returns All point moves to apply and matched rules
 */
export function applyRules(
  glyph: GlyphSnapshot,
  selectedIds: ReadonlySet<PointId>,
  dx: number,
  dy: number,
): RulesResult {
  const matchedRules: MatchedRule[] = [];
  const allMoves = new Map<PointId, PointMove>();

  // First: compute moves for all selected points
  for (const pointId of selectedIds) {
    const found = Glyphs.findPoint(glyph, pointId);
    if (found) {
      const { point } = found;
      allMoves.set(pointId, {
        id: pointId,
        x: point.x + dx,
        y: point.y + dy,
      });
    }
  }

  // Second: match rules for each selected point
  for (const pointId of selectedIds) {
    const pointInContour = Glyphs.findPoint(glyph, pointId);
    if (!pointInContour) continue;

    const rule = matchRule(pointInContour.contour, pointId, selectedIds);
    if (rule) {
      matchedRules.push(rule);
    }
  }

  // Third: apply rules to compute additional moves
  for (const rule of matchedRules) {
    const ruleMoves = applyRule(glyph, rule, allMoves, dx, dy);
    for (const move of ruleMoves) {
      // Don't override selected point moves
      if (!selectedIds.has(move.id)) {
        allMoves.set(move.id, move);
      }
    }
  }

  return {
    moves: Array.from(allMoves.values()),
    matchedRules,
  };
}
