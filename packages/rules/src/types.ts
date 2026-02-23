import type { PointId } from "@shift/types";

/**
 * Rule identifiers matching the Rust implementation
 */
export type RuleId =
  | "moveRightHandle"
  | "moveLeftHandle"
  | "moveBothHandles"
  | "maintainTangencyRight"
  | "maintainTangencyLeft"
  | "maintainTangencyBoth"
  | "maintainCollinearity";

export type RuleAffectedRolesById = {
  moveRightHandle: "rightHandle";
  moveLeftHandle: "leftHandle";
  moveBothHandles: "leftHandle" | "rightHandle";
  maintainTangencyRight: "smooth" | "oppositeHandle";
  maintainTangencyLeft: "smooth" | "oppositeHandle";
  maintainTangencyBoth:
    | "target"
    | "reference"
    | "leftHandle"
    | "leftSmooth"
    | "rightSmooth"
    | "rightHandle"
    | "otherSmooth"
    | "otherHandle"
    | "associatedHandle";
  maintainCollinearity: "smooth" | "end";
};

export type AffectedPointRole = RuleAffectedRolesById[RuleId];
export type RuleAffectedRole<Id extends RuleId> = RuleAffectedRolesById[Id];
export type MatchedRuleAffected<Id extends RuleId> = Partial<Record<RuleAffectedRole<Id>, PointId>>;

export interface MatchedRuleBase<Id extends RuleId> {
  /**
   * The selected point currently being evaluated by the matcher.
   * This is the center point of the matched pattern (offset `0`).
   */
  pointId: PointId;
  ruleId: Id;
  description: string;
  /** Concrete pattern string that matched around `pointId`. */
  pattern: string;
  /** Related points resolved from semantic affected references on the rule. */
  affected: MatchedRuleAffected<Id>;
}

/**
 * A matched rule with affected points
 */
export type MatchedRuleById<Id extends RuleId> = MatchedRuleBase<Id>;
export type MatchedRule = { [Id in RuleId]: MatchedRuleById<Id> }[RuleId];

/** A single pattern attempt evaluated for a selected point. */
export interface PatternProbe {
  windowSize: number;
  pattern: string;
  matched: boolean;
}

/** Rule matching diagnostics for one selected point. */
export interface PointRuleDiagnostics {
  pointId: PointId;
  contourId: string | null;
  pointIndex: number | null;
  probes: PatternProbe[];
  matchedRule: MatchedRule | null;
}

/** Full diagnostics payload for a selection rule evaluation pass. */
export interface SelectionRuleDiagnostics {
  selectedPointIds: PointId[];
  points: PointRuleDiagnostics[];
}

/**
 * A point move operation
 */
export interface PointMove {
  id: PointId;
  x: number;
  y: number;
}

/** Result of constraining a drag frame. */
export interface DragPatch {
  /** Absolute point positions to apply for this frame. */
  pointUpdates: PointMove[];
  /** Rules that matched while producing this patch. */
  matched: MatchedRule[];
}

/**
 * Internal rule definition
 */
export interface Rule {
  id: RuleId;
  patternTemplate: string;
  description: string;
  /** Higher value increases precedence; window size still dominates by default. */
  priority: number;
}
