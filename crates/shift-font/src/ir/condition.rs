use crate::AxisId;
use serde::{Deserialize, Serialize};

/// A reusable boolean expression over the root font design location.
///
/// Axis ranges are inclusive. Semantic validation requires at least one bound
/// and restricts references to font-owned axes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Condition {
    AxisRange {
        axis_id: AxisId,
        minimum: Option<f64>,
        maximum: Option<f64>,
    },
    And {
        conditions: Vec<Condition>,
    },
    Or {
        conditions: Vec<Condition>,
    },
    Not {
        condition: Box<Condition>,
    },
}
