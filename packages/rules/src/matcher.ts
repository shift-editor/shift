/**
 * Pattern Matcher - Matches point patterns against rules
 */

import { Contours, Glyphs } from "@shift/font";
import type { PointId, Point, Contour, Glyph } from "@shift/types";
import type {
  MatchedRule,
  MatchedRuleAffected,
  MatchedRuleById,
  PatternProbe,
  PointRuleDiagnostics,
  RuleId,
  SelectionRuleDiagnostics,
} from "./types";
import { TOKEN_NO_POINT, TOKEN_CORNER, TOKEN_HANDLE, TOKEN_SMOOTH, TOKEN_SELECTED } from "./parser";
import { getRuleTable } from "./rules";
import type { AffectedPointSpec, RuleMatch } from "./rules";

const WINDOW_SIZES = [5, 3] as const;

/**
 * Get point token for pattern matching
 */
function getPointToken(
  point: Point | undefined,
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

type ContourMatchInput = Contour;

function getPointAtOffset(
  contour: ContourMatchInput,
  centerIndex: number,
  offset: number,
): Point | undefined {
  return Contours.at(contour, centerIndex + offset, contour.closed) ?? undefined;
}

/**
 * Build a pattern string for points around a given index
 */
function buildPattern(
  contour: ContourMatchInput,
  centerIndex: number,
  selectedIds: ReadonlySet<PointId>,
  windowSize: number,
): string {
  const halfWindow = Math.floor(windowSize / 2);
  let pattern = "";

  for (let offset = -halfWindow; offset <= halfWindow; offset++) {
    const point = getPointAtOffset(contour, centerIndex, offset);
    const isCentral = offset === 0;
    pattern += getPointToken(point, selectedIds, isCentral);
  }

  return pattern;
}

/**
 * Resolve semantic affected point roles to concrete point ids.
 */
function computeAffectedPoints<Id extends RuleId>(
  contour: ContourMatchInput,
  pointIndex: number,
  refs: readonly AffectedPointSpec<Id>[],
): MatchedRuleAffected<Id> {
  const affected: MatchedRuleAffected<Id> = {};

  for (const ref of refs) {
    const point = getPointAtOffset(contour, pointIndex, ref.offset);
    if (point) {
      affected[ref.role] = point.id;
    }
  }

  return affected;
}

function createMatchedRule<Id extends RuleId>(
  pointId: PointId,
  pattern: string,
  match: RuleMatch<Id>,
  contour: ContourMatchInput,
  pointIndex: number,
): MatchedRuleById<Id> {
  const affected = computeAffectedPoints(contour, pointIndex, match.affected);
  const { id, description } = match.rule;
  return {
    pointId,
    ruleId: id,
    description,
    pattern,
    affected,
  };
}

type RuleEvaluation = {
  matchedRule: MatchedRule | null;
  probes: PatternProbe[];
};

function matchRuleAtIndex(
  contour: ContourMatchInput,
  pointId: PointId,
  pointIndex: number,
  selectedIds: ReadonlySet<PointId>,
): MatchedRule | null {
  const ruleTable = getRuleTable();
  let bestMatch: RuleMatch | null = null;
  let bestPattern = "";

  for (const windowSize of WINDOW_SIZES) {
    const pattern = buildPattern(contour, pointIndex, selectedIds, windowSize);
    const match = ruleTable.get(pattern);
    if (!match) continue;

    if (!bestMatch || match.precedenceScore > bestMatch.precedenceScore) {
      bestMatch = match;
      bestPattern = pattern;
      continue;
    }

    if (
      match.precedenceScore === bestMatch.precedenceScore &&
      match.rule.id !== bestMatch.rule.id
    ) {
      throw new Error(
        `Ambiguous rule precedence for point ${String(pointId)} between ` +
          `${bestMatch.rule.id} (${bestPattern}) and ${match.rule.id} (${pattern}) ` +
          `at score ${match.precedenceScore}.`,
      );
    }
  }

  if (!bestMatch) return null;
  return createMatchedRule(pointId, bestPattern, bestMatch, contour, pointIndex);
}

function evaluateRuleAtIndex(
  contour: ContourMatchInput,
  pointId: PointId,
  pointIndex: number,
  selectedIds: ReadonlySet<PointId>,
): RuleEvaluation {
  const ruleTable = getRuleTable();
  const probes: PatternProbe[] = [];
  const candidates: Array<{ windowSize: number; pattern: string; match: RuleMatch }> = [];

  // Evaluate each window size and pick by explicit precedence policy.
  for (const windowSize of WINDOW_SIZES) {
    const pattern = buildPattern(contour, pointIndex, selectedIds, windowSize);
    const match = ruleTable.get(pattern);
    probes.push({ windowSize, pattern, matched: match != null });

    if (match) {
      candidates.push({ windowSize, pattern, match });
    }
  }

  if (candidates.length === 0) {
    return { matchedRule: null, probes };
  }

  let best = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (!candidate) continue;

    const candidateScore = candidate.match.precedenceScore;
    const bestScore = best.match.precedenceScore;

    if (candidateScore > bestScore) {
      best = candidate;
      continue;
    }

    if (candidateScore === bestScore && candidate.match.rule.id !== best.match.rule.id) {
      throw new Error(
        `Ambiguous rule precedence for point ${String(pointId)} between ` +
          `${best.match.rule.id} (${best.pattern}) and ${candidate.match.rule.id} (${candidate.pattern}) ` +
          `at score ${candidateScore}.`,
      );
    }
  }

  const matchedRule = createMatchedRule(pointId, best.pattern, best.match, contour, pointIndex);
  return {
    matchedRule,
    probes,
  };
}

/**
 * Match a rule for a selected point in a contour
 */
export function pickRule(
  contour: ContourMatchInput,
  pointId: PointId,
  selectedIds: ReadonlySet<PointId>,
): MatchedRule | null {
  const pointIndex = Contours.findPointIndex(contour, pointId);
  if (pointIndex === -1) {
    return null;
  }

  return matchRuleAtIndex(contour, pointId, pointIndex, selectedIds);
}

export function pickRuleAtIndex(
  contour: ContourMatchInput,
  pointId: PointId,
  pointIndex: number,
  selectedIds: ReadonlySet<PointId>,
): MatchedRule | null {
  return matchRuleAtIndex(contour, pointId, pointIndex, selectedIds);
}

/**
 * Build per-point rule diagnostics for the current selection.
 */
export function diagnoseSelectionPatterns(
  glyph: Glyph,
  selectedIds: ReadonlySet<PointId>,
): SelectionRuleDiagnostics {
  const diagnostics: PointRuleDiagnostics[] = [];

  for (const pointId of selectedIds) {
    const found = Glyphs.findPoint(glyph, pointId);
    if (!found) {
      diagnostics.push({
        pointId,
        contourId: null,
        pointIndex: null,
        probes: [],
        matchedRule: null,
      });
      continue;
    }

    const { contour, index } = found;
    const { probes, matchedRule } = evaluateRuleAtIndex(contour, pointId, index, selectedIds);

    diagnostics.push({
      pointId,
      contourId: contour.id,
      pointIndex: index,
      probes,
      matchedRule,
    });
  }

  return {
    selectedPointIds: [...selectedIds],
    points: diagnostics,
  };
}
