/**
 * @shift/rules - Point editing rules engine
 *
 * Provides geometric constraint handling for point editing operations.
 * This is a TypeScript port of the Rust rules engine, designed to run
 * on the renderer side for immediate feedback during drag operations.
 *
 * @example
 * ```ts
 * import { applyRules } from '@shift/rules';
 *
 * // During drag: compute all moves including rule-affected points
 * const { moves, matchedRules } = applyRules(glyph, selectedIds, dx, dy);
 * ```
 */

// Types
export type { RuleId, MatchedRule, PointMove, RulesResult } from "./types";

// Pattern matching
export { matchRule } from "./matcher";

// Rule application
export { applyRules } from "./actions";
