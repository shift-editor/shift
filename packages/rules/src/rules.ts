/**
 * Rule Definitions - Pattern templates for point editing constraints
 */

import type { AffectedPointRole, Rule, RuleAffectedRole, RuleId } from "./types";
import { expandPattern } from "./parser";

export interface RuleMatch<Id extends RuleId = RuleId> {
  rule: Rule & { id: Id };
  affected: readonly AffectedPointSpec<Id>[];
  precedenceScore: number;
  sourcePatternTemplate: string;
}

export type AffectedPointSpec<Id extends RuleId = RuleId> = {
  role: RuleAffectedRole<Id>;
  offset: number;
};

export type RuleEntry<Id extends RuleId = RuleId> = {
  patternTemplate: string;
  affected: readonly AffectedPointSpec<Id>[];
};

export type RuleSpec<Id extends RuleId = RuleId> = {
  id: Id;
  description: string;
  entries: readonly RuleEntry<Id>[];
  priority?: number;
  allowPatternOverride?: boolean;
};

/**
 * Rule template definitions
 *
 * Authoring notes:
 * - Templates expand into concrete patterns via parser.expandPattern().
 * - Concrete collisions throw unless the overriding spec sets allowPatternOverride: true
 *   and has a higher precedence score.
 * - Precedence score = concretePatternLength * 1000 + priority.
 */
function defineRuleSpec<const Id extends RuleId>(spec: RuleSpec<Id>): RuleSpec<Id> {
  return spec;
}

const RULE_SPECS: RuleSpec[] = [
  defineRuleSpec({
    id: "moveRightHandle",
    description: "move the right neighbour handle of an anchor point",
    priority: 0,
    entries: [{ patternTemplate: "[X@][CS]H", affected: [at("rightHandle", 1)] }],
  }),
  defineRuleSpec({
    id: "moveLeftHandle",
    description: "move the left neighbour handle of an anchor point",
    priority: 1,
    allowPatternOverride: true,
    entries: [{ patternTemplate: "H[CS][X@]", affected: [at("leftHandle", -1)] }],
  }),
  defineRuleSpec({
    id: "moveBothHandles",
    description: "move the neighbour handles of an anchor point",
    priority: 2,
    allowPatternOverride: true,
    entries: [
      {
        patternTemplate: "H[CS]H",
        affected: [at("leftHandle", -1), at("rightHandle", 1)],
      },
    ],
  }),
  defineRuleSpec({
    id: "maintainTangencyRight",
    description: "maintain tangency through the anchor point with the opposite handle",
    entries: [
      {
        patternTemplate: "HS[HC][@X][@X]",
        affected: [at("smooth", -1), at("oppositeHandle", -2)],
      },
    ],
  }),
  defineRuleSpec({
    id: "maintainTangencyLeft",
    description: "maintain tangency through the anchor point with the opposite handle",
    entries: [
      { patternTemplate: "[@X][CH]S", affected: [at("smooth", 1), at("oppositeHandle", 2)] },
    ],
    allowPatternOverride: true,
    priority: 2,
  }),
  defineRuleSpec({
    id: "maintainTangencyBoth",
    description: "maintain tangency through the anchor point with both handles",
    entries: [
      { patternTemplate: "HSC", affected: [at("target", -1), at("reference", 1)] },
      { patternTemplate: "CSC", affected: [at("target", -1), at("reference", 1)] },
      { patternTemplate: "CSH", affected: [at("target", -1), at("reference", 1)] },
      {
        patternTemplate: "HSCSH",
        affected: [
          at("leftHandle", -2),
          at("leftSmooth", -1),
          at("rightSmooth", 1),
          at("rightHandle", 2),
        ],
      },
      {
        patternTemplate: "HHSSH",
        affected: [at("associatedHandle", -1), at("otherSmooth", 1), at("otherHandle", 2)],
      },
      {
        patternTemplate: "HSSHH",
        affected: [at("otherHandle", -2), at("otherSmooth", -1), at("associatedHandle", 1)],
      },
    ],
    priority: 3,
    allowPatternOverride: true,
  }),
  defineRuleSpec({
    id: "maintainCollinearity",
    description: "maintain collinearity through the corner, smooth and handle point",
    entries: [
      { patternTemplate: "[CS][HC@]HS[CS]", affected: [at("smooth", 1), at("end", 2)] },
      { patternTemplate: "[CS]SH[H@][CS]", affected: [at("smooth", -1), at("end", -2)] },
    ],
  }),
];

function at<const Role extends AffectedPointRole>(
  role: Role,
  offset: number,
): {
  role: Role;
  offset: number;
} {
  return { role, offset };
}

const WINDOW_SIZE_WEIGHT = 1000;

function computePatternPrecedenceScore(pattern: string, priority: number): number {
  return pattern.length * WINDOW_SIZE_WEIGHT + priority;
}

function addRulePatterns<Id extends RuleId>(
  table: Map<string, RuleMatch>,
  spec: RuleSpec<Id>,
  entry: RuleEntry<Id>,
): void {
  const priority = spec.priority ?? 0;
  const rule: Rule & { id: Id } = {
    id: spec.id,
    patternTemplate: entry.patternTemplate,
    description: spec.description,
    priority,
  };
  const expandedPatterns = expandPattern(entry.patternTemplate);

  for (const pattern of expandedPatterns) {
    const precedenceScore = computePatternPrecedenceScore(pattern, rule.priority);
    const existing = table.get(pattern);

    if (existing) {
      const sameRule = existing.rule.id === spec.id;

      if (!sameRule) {
        if (!spec.allowPatternOverride) {
          throw new Error(
            `Duplicate concrete pattern "${pattern}" from ${spec.id} (${entry.patternTemplate}) collides with ` +
              `${existing.rule.id} (${existing.sourcePatternTemplate}). ` +
              `Set allowPatternOverride: true and increase priority to override intentionally.`,
          );
        }

        if (precedenceScore < existing.precedenceScore) {
          throw new Error(
            `Rule override for pattern "${pattern}" has lower precedence (${precedenceScore}) than existing ` +
              `${existing.rule.id} (${existing.precedenceScore}). Increase rule priority to override.`,
          );
        }

        if (precedenceScore === existing.precedenceScore) {
          throw new Error(
            `Ambiguous override for pattern "${pattern}" between ${spec.id} and ${existing.rule.id} ` +
              `at precedence ${precedenceScore}. Adjust priorities to break the tie.`,
          );
        }
      }
    }

    table.set(pattern, {
      rule,
      affected: entry.affected,
      precedenceScore,
      sourcePatternTemplate: entry.patternTemplate,
    });
  }
}

/**
 * Build a lookup table from pattern strings to rules
 */
export function buildRuleTableFromSpecs(specs: readonly RuleSpec[]): Map<string, RuleMatch> {
  const table = new Map<string, RuleMatch>();

  for (const spec of specs) {
    for (const entry of spec.entries) {
      addRulePatterns(table, spec, entry);
    }
  }

  return table;
}

export function buildRuleTable(): Map<string, RuleMatch> {
  return buildRuleTableFromSpecs(RULE_SPECS);
}

// Singleton rule table (built once, reused)
let cachedRuleTable: Map<string, RuleMatch> | null = null;

/**
 * Get the rule table (lazily initialized singleton)
 */
export function getRuleTable(): Map<string, RuleMatch> {
  if (!cachedRuleTable) {
    cachedRuleTable = buildRuleTable();
  }
  return cachedRuleTable;
}
