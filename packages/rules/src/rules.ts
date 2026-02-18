/**
 * Rule Definitions - Pattern templates for point editing constraints
 */

import type { Rule } from "./types";
import { expandPattern } from "./parser";

/**
 * Rule template definitions
 *
 * Pattern syntax:
 * - [X@] = Any point or selected marker
 * - [CS] = Corner or Smooth on-curve point
 * - H = Handle (off-curve point)
 */
const RULE_TEMPLATES: Rule[] = [
  {
    id: "moveRightHandle",
    patternTemplate: "[X@][CS]H",
    description: "move the right neighbour handle of an anchor point",
  },
  {
    id: "moveLeftHandle",
    patternTemplate: "H[CS][X@]",
    description: "move the left neighbour handle of an anchor point",
  },
  {
    id: "moveBothHandles",
    patternTemplate: "H[CS]H",
    description: "move the neighbour handles of an anchor point",
  },
  {
    id: "maintainTangencyRight",
    patternTemplate: "HS[HC][@X][@X]",
    description: "maintain tangency through the anchor point with the opposite handle",
  },
  {
    id: "maintainTangencyLeft",
    patternTemplate: "[@X]HS",
    description: "maintain tangency through the anchor point with the opposite handle",
  },
  {
    id: "maintainCollinearity",
    patternTemplate: "SHH",
    description: "maintain collinearity through the corner, smooth and handle point",
  },
];

/**
 * Build a lookup table from pattern strings to rules
 */
export function buildRuleTable(): Map<string, Rule> {
  const table = new Map<string, Rule>();

  for (const rule of RULE_TEMPLATES) {
    const expandedPatterns = expandPattern(rule.patternTemplate);

    for (const pattern of expandedPatterns) {
      table.set(pattern, rule);
    }
  }

  return table;
}

// Singleton rule table (built once, reused)
let cachedRuleTable: Map<string, Rule> | null = null;

/**
 * Get the rule table (lazily initialized singleton)
 */
export function getRuleTable(): Map<string, Rule> {
  if (!cachedRuleTable) {
    cachedRuleTable = buildRuleTable();
  }
  return cachedRuleTable;
}
