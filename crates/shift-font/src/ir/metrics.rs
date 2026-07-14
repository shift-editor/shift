use crate::entity::MetricId;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FontMetrics {
    pub units_per_em: f64,
}

impl Default for FontMetrics {
    fn default() -> Self {
        Self {
            units_per_em: 1000.0,
        }
    }
}

impl FontMetrics {
    pub fn new(units_per_em: f64) -> Self {
        Self { units_per_em }
    }
}

/// Semantic role of an authored line metric.
///
/// Standard roles lower to font metrics during compilation. `Custom` remains
/// authoring data until an exporter explicitly understands its meaning.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MetricKind {
    Ascender,
    CapHeight,
    XHeight,
    Baseline,
    Descender,
    Custom,
}

/// Font-owned identity and meaning for one metric row.
///
/// Sources store positions and overshoots by [`MetricId`], so renaming or
/// reordering a definition never changes which authored values it addresses.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricDefinition {
    id: MetricId,
    kind: MetricKind,
    name: String,
}

impl MetricDefinition {
    /// Creates a metric definition with newly minted stable identity.
    pub fn new(kind: MetricKind, name: String) -> Self {
        Self::with_id(MetricId::new(), kind, name)
    }

    /// Rebuilds a metric definition while preserving source-format identity.
    pub fn with_id(id: MetricId, kind: MetricKind, name: String) -> Self {
        Self { id, kind, name }
    }

    pub fn id(&self) -> MetricId {
        self.id.clone()
    }

    pub fn kind(&self) -> MetricKind {
        self.kind
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn set_name(&mut self, name: String) {
        self.name = name;
    }

    /// Creates the standard Latin metric rows used by a new font.
    pub fn defaults() -> Vec<Self> {
        [
            (MetricKind::Ascender, "Ascender"),
            (MetricKind::CapHeight, "Cap Height"),
            (MetricKind::XHeight, "x-Height"),
            (MetricKind::Baseline, "Baseline"),
            (MetricKind::Descender, "Descender"),
        ]
        .into_iter()
        .map(|(kind, name)| Self::new(kind, name.to_string()))
        .collect()
    }
}

/// One source's authored position and alignment-zone overshoot for a metric.
///
/// Both values are expressed in font units. Overshoots are positive above a
/// metric line and negative below it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricValue {
    pub position: f64,
    pub overshoot: f64,
}

impl MetricValue {
    pub fn new(position: f64, overshoot: f64) -> Self {
        Self {
            position,
            overshoot,
        }
    }

    /// Returns the initial authored value for a new definition at `units_per_em`.
    pub fn for_kind(kind: MetricKind, units_per_em: f64) -> Self {
        let (position, overshoot) = match kind {
            MetricKind::Ascender => (0.8, 0.016),
            MetricKind::CapHeight => (0.7, 0.016),
            MetricKind::XHeight => (0.5, 0.016),
            MetricKind::Baseline => (0.0, -0.016),
            MetricKind::Descender => (-0.2, -0.016),
            MetricKind::Custom => (0.0, 0.0),
        };
        Self::new(
            (position * units_per_em).round(),
            (overshoot * units_per_em).round(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_metrics() {
        let m = FontMetrics::default();
        assert_eq!(m.units_per_em, 1000.0);
    }

    #[test]
    fn default_metric_definitions_have_distinct_identity() {
        let definitions = MetricDefinition::defaults();
        assert_eq!(definitions.len(), 5);
        assert_ne!(definitions[0].id(), definitions[1].id());
    }

    #[test]
    fn standard_values_scale_with_units_per_em() {
        assert_eq!(
            MetricValue::for_kind(MetricKind::XHeight, 2000.0),
            MetricValue::new(1000.0, 32.0)
        );
    }
}
