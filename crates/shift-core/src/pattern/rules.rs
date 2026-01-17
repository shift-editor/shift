use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::parser::PatternParser;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum RuleId {
    MoveRightHandle,
    MoveLeftHandle,
    MoveBothHandles,
    MaintainTangencyRight,
    MaintainTangencyLeft,
}

#[derive(Debug, Clone)]
pub struct Rule {
    pub id: RuleId,
    pub pattern_template: &'static str,
    pub description: &'static str,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MatchedRule {
    pub point_id: String,
    pub rule_id: RuleId,
    pub description: &'static str,
    pub pattern: String,
    pub affected_point_ids: Vec<String>,
}

const RULE_TEMPLATES: &[Rule] = &[
    Rule {
        id: RuleId::MoveRightHandle,
        pattern_template: "[X@][CS]H",
        description: "move the right neighbour handle of an anchor point",
    },
    Rule {
        id: RuleId::MoveLeftHandle,
        pattern_template: "H[CS][X@]",
        description: "move the left neighbour handle of an anchor point",
    },
    Rule {
        id: RuleId::MoveBothHandles,
        pattern_template: "H[CS]H",
        description: "move the neighbour handles of an anchor point",
    },
    Rule {
        id: RuleId::MaintainTangencyRight,
        pattern_template: "HS[HC][@X][@X]",
        description: "maintain tangency through the anchor point with the opposite handle",
    },
    Rule {
        id: RuleId::MaintainTangencyLeft,
        pattern_template: "[@X]HS",
        description: "maintain tangency through the anchor point with the opposite handle",
    },
];

pub fn build_rule_table() -> HashMap<String, Rule> {
    let mut table = HashMap::new();
    let parser = PatternParser::new();

    for rule in RULE_TEMPLATES {
        let expanded_patterns = parser.expand(rule.pattern_template);

        for pattern in expanded_patterns {
            table.insert(pattern, rule.clone());
        }
    }

    table
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rule_table_contains_expected_patterns() {
        let table = build_rule_table();

        assert!(table.contains_key("NCH"));
        assert!(table.contains_key("@SH"));
        assert!(table.contains_key("HCH"));
        assert!(table.contains_key("HSH"));
        assert!(table.contains_key("HCC"));
        assert!(table.contains_key("HCS"));
    }

    #[test]
    fn rule_table_maps_to_correct_rules() {
        let table = build_rule_table();

        assert_eq!(table.get("NCH").unwrap().id, RuleId::MoveRightHandle);
        assert_eq!(table.get("HCN").unwrap().id, RuleId::MoveLeftHandle);
        assert_eq!(table.get("HSH").unwrap().id, RuleId::MoveBothHandles);
    }

    #[test]
    fn rule_table_handles_tangency_patterns() {
        let table = build_rule_table();

        assert!(table.contains_key("HSHNN"));
        assert!(table.contains_key("HSHCN"));
        assert!(table.contains_key("HSH@N"));

        let rule = table.get("HSHNN").unwrap();
        assert_eq!(rule.id, RuleId::MaintainTangencyRight);
    }

    #[test]
    fn left_tangency_pattern() {
        let table = build_rule_table();

        assert!(table.contains_key("NHS"));
        assert!(table.contains_key("@HS"));

        let rule = table.get("NHS").unwrap();
        assert_eq!(rule.id, RuleId::MaintainTangencyLeft);
    }
}
