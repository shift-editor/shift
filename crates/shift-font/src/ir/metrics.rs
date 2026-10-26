use crate::Source;
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

impl MetricKind {
    /// The standard Latin rows a new font gets, in display order.
    pub const STANDARD: [Self; 5] = [
        Self::Ascender,
        Self::CapHeight,
        Self::XHeight,
        Self::Baseline,
        Self::Descender,
    ];

    /// The name a new font gives this row.
    pub fn default_name(self) -> &'static str {
        match self {
            Self::Ascender => "Ascender",
            Self::CapHeight => "Cap Height",
            Self::XHeight => "x-Height",
            Self::Baseline => "Baseline",
            Self::Descender => "Descender",
            Self::Custom => "Custom",
        }
    }

    /// The default position for this row, as a fraction of the em.
    pub fn default_position_fraction(self) -> f64 {
        self.default_fractions().0
    }

    /// The default position and overshoot, as fractions of the em.
    fn default_fractions(self) -> (f64, f64) {
        match self {
            Self::Ascender => (0.8, 0.016),
            Self::CapHeight => (0.7, 0.016),
            Self::XHeight => (0.5, 0.016),
            Self::Baseline => (0.0, -0.016),
            Self::Descender => (-0.2, -0.016),
            Self::Custom => (0.0, 0.0),
        }
    }
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
        self.id
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
        MetricKind::STANDARD
            .into_iter()
            .map(|kind| Self::new(kind, kind.default_name().to_string()))
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
        let (position, overshoot) = kind.default_fractions();
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

    #[test]
    fn standard_metrics_write_present_roles_and_keep_overshoot() {
        let mut font = crate::Font::new();
        let source_id = font.default_source_id().unwrap();
        let before = font.standard_metrics(source_id).unwrap();
        let x_height_id = font
            .metric_definition_for_kind(MetricKind::XHeight)
            .unwrap()
            .id();
        font.source_mut(source_id)
            .unwrap()
            .set_metric_value(x_height_id, MetricValue::new(500.0, 12.0));

        font.set_standard_metrics(
            source_id,
            StandardMetrics {
                ascender: Some(780.0),
                x_height: Some(520.0),
                ..StandardMetrics::default()
            },
        )
        .unwrap();

        let after = font.standard_metrics(source_id).unwrap();
        assert_eq!(after.ascender, Some(780.0));
        assert_eq!(after.x_height, Some(520.0));
        assert_eq!(after.descender, before.descender);
        let x_height = font
            .source(source_id)
            .unwrap()
            .metric_value(x_height_id)
            .unwrap();
        assert_eq!(x_height.overshoot, 12.0);
    }

    #[test]
    fn definition_list_finds_definitions_by_id_and_kind() {
        let font = crate::Font::new();
        let definitions = font.metric_definitions();
        let ascender = definitions
            .definition_for_kind(MetricKind::Ascender)
            .expect("a new font defines an ascender");

        assert_eq!(definitions.definition(ascender.id()), Some(ascender));
        assert!(definitions.definition(MetricId::new()).is_none());
    }
}

/// Looks up metric definitions in a list of definitions.
pub trait MetricDefinitionList {
    /// Returns the definition with `metric_id`.
    fn definition(&self, metric_id: MetricId) -> Option<&MetricDefinition>;

    /// Returns the definition for a standard role, or the first custom one.
    fn definition_for_kind(&self, kind: MetricKind) -> Option<&MetricDefinition>;
}

impl MetricDefinitionList for [MetricDefinition] {
    fn definition(&self, metric_id: MetricId) -> Option<&MetricDefinition> {
        self.iter().find(|definition| definition.id() == metric_id)
    }

    fn definition_for_kind(&self, kind: MetricKind) -> Option<&MetricDefinition> {
        self.iter().find(|definition| definition.kind() == kind)
    }
}

/// The positions of a source's standard metrics, each `None` when the source
/// has no value for that role.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct StandardMetrics {
    pub ascender: Option<f64>,
    pub cap_height: Option<f64>,
    pub x_height: Option<f64>,
    pub baseline: Option<f64>,
    pub descender: Option<f64>,
}

impl StandardMetrics {
    /// Reads `source`'s positions for the roles `definitions` define.
    pub fn of(source: &Source, definitions: &[MetricDefinition]) -> Self {
        let position = |kind| {
            let definition = definitions.definition_for_kind(kind)?;
            source
                .metric_value(definition.id())
                .map(|value| value.position)
        };
        Self {
            ascender: position(MetricKind::Ascender),
            cap_height: position(MetricKind::CapHeight),
            x_height: position(MetricKind::XHeight),
            baseline: position(MetricKind::Baseline),
            descender: position(MetricKind::Descender),
        }
    }

    /// Writes each present position into `source`, keeping the overshoot it
    /// already has. Roles that `definitions` does not define are skipped.
    pub fn apply_to(self, source: &mut Source, definitions: &[MetricDefinition]) {
        for (kind, position) in self.by_kind() {
            let Some(position) = position else {
                continue;
            };
            let Some(definition) = definitions.definition_for_kind(kind) else {
                continue;
            };
            let overshoot = source
                .metric_value(definition.id())
                .map(|value| value.overshoot)
                .unwrap_or_default();
            source.set_metric_value(definition.id(), MetricValue::new(position, overshoot));
        }
    }

    fn by_kind(self) -> [(MetricKind, Option<f64>); 5] {
        [
            (MetricKind::Ascender, self.ascender),
            (MetricKind::CapHeight, self.cap_height),
            (MetricKind::XHeight, self.x_height),
            (MetricKind::Baseline, self.baseline),
            (MetricKind::Descender, self.descender),
        ]
    }
}
