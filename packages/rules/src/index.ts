/**
 * @shift/rules - Point editing rules engine
 *
 * Provides geometric constraint handling for point editing operations.
 * This is a TypeScript port of the Rust rules engine, designed to run
 * on the renderer side for immediate feedback during drag operations.
 *
 * @example
 * ```ts
 * import { applyRules, applyMovesToGlyph } from '@shift/rules';
 *
 * // During drag: compute all moves including rule-affected points
 * const { moves, matchedRules } = applyRules(glyph, selectedIds, dx, dy);
 *
 * // Apply moves to get updated glyph
 * const updatedGlyph = applyMovesToGlyph(glyph, moves);
 * ```
 */

// Types
export type { RuleId, MatchedRule, PointMove, RulesResult, Rule } from "./types";

// Pattern matching
export { matchRule, findPointContour, getPoint } from "./matcher";

// Rule application
export { applyRules, applyMovesToGlyph } from "./actions";

// Parser (for testing/debugging)
export { expandPattern } from "./parser";

// Rules table (for testing/debugging)
export { buildRuleTable, getRuleTable } from "./rules";
