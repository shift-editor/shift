/**
 * @shift/rules - Point editing rules engine
 *
 * Provides geometric constraint handling for point editing operations.
 * This is a TypeScript port of the Rust rules engine, designed to run
 * on the renderer side for immediate feedback during drag operations.
 *
 * @example
 * ```ts
 * import { constrainDrag } from '@shift/rules';
 *
 * // During drag: compute all moves including rule-affected points
 * const patch = constrainDrag({
 *   glyph,
 *   selectedIds,
 *   mousePosition: { x: dx, y: dy },
 * });
 * ```
 */

// Types
export type {
  AffectedPointRole,
  RuleId,
  RuleAffectedRole,
  RuleAffectedRolesById,
  MatchedRule,
  MatchedRuleById,
  MatchedRuleAffected,
  PatternProbe,
  PointRuleDiagnostics,
  SelectionRuleDiagnostics,
  PointMove,
  DragPatch,
} from "./types";

// Pattern matching
export { pickRule, diagnoseSelectionPatterns } from "./matcher";

// Rule application
export { constrainDrag } from "./actions";
