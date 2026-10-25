//! The font-level records an edit changed, read from the font it left.
//!
//! Every session that applies an edit builds them the same way, with
//! [`FontReplacement::changed_by`]. Glyph records are not here: they need the
//! store's component references and glyph categories.

use std::collections::HashMap;

use serde::Serialize;
use shift_font::{CoreResult, Font, FontChangeImpact};

use crate::{
    Axis, AxisMapping, AxisMappingBasis, FontMetadata, KerningSnapshot, MetricDefinition,
    NamedInstance, Source, SourceMetricsInterpolationSnapshot,
};

/// Each font-level collection an edit changed, whole; `None` for one it left
/// as it was.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontReplacement {
    pub metadata: Option<FontMetadata>,
    pub axes: Option<Vec<Axis>>,
    pub axis_mappings: Option<Vec<AxisMapping>>,
    pub axis_mapping_bases: Option<Vec<AxisMappingBasis>>,
    pub metric_definitions: Option<Vec<MetricDefinition>>,
    pub source_metrics_interpolation: Option<SourceMetricsInterpolationReplacement>,
    pub named_instances: Option<Vec<NamedInstance>>,
    pub languages: Option<LanguagesReplacement>,
    pub sources: Option<Vec<Source>>,
    pub kerning: Option<KerningSnapshot>,
}

/// The source-metrics interpolation after an edit that changed it; `None`
/// inside when the font no longer has one.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMetricsInterpolationReplacement {
    pub snapshot: Option<SourceMetricsInterpolationSnapshot>,
}

/// The font's languages after an edit that changed them; `None` inside when
/// it declares none.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguagesReplacement {
    pub language_ids: Option<Vec<String>>,
}

impl FontReplacement {
    /// The font-level collections `impact` names, read from `font`; `None` when
    /// the edit changed nothing at font level.
    ///
    /// # Errors
    ///
    /// Returns the font's error when its axis-mapping bases cannot be built.
    pub fn changed_by(font: &Font, impact: FontChangeImpact) -> CoreResult<Option<Self>> {
        if impact.is_empty() {
            return Ok(None);
        }
        let changed = |flag| impact.contains(flag);
        Ok(Some(Self {
            metadata: changed(FontChangeImpact::METADATA)
                .then(|| FontMetadata::from(font.metadata())),
            axes: changed(FontChangeImpact::AXES)
                .then(|| font.axes().iter().map(Axis::from).collect()),
            axis_mappings: changed(FontChangeImpact::AXIS_MAPPINGS)
                .then(|| font.axis_mappings().iter().map(AxisMapping::from).collect()),
            axis_mapping_bases: changed(FontChangeImpact::AXIS_MAPPING_BASES)
                .then(|| -> CoreResult<_> {
                    Ok(font
                        .axis_mapping_bases()?
                        .iter()
                        .map(AxisMappingBasis::from)
                        .collect())
                })
                .transpose()?,
            metric_definitions: changed(FontChangeImpact::METRIC_DEFINITIONS).then(|| {
                font.metric_definitions()
                    .iter()
                    .map(MetricDefinition::from)
                    .collect()
            }),
            source_metrics_interpolation: changed(FontChangeImpact::SOURCE_METRICS).then(|| {
                SourceMetricsInterpolationReplacement {
                    snapshot: font
                        .source_metric_interpolation()
                        .as_ref()
                        .map(SourceMetricsInterpolationSnapshot::from),
                }
            }),
            named_instances: changed(FontChangeImpact::NAMED_INSTANCES).then(|| {
                font.named_instances()
                    .iter()
                    .map(NamedInstance::from)
                    .collect()
            }),
            languages: changed(FontChangeImpact::LANGUAGES).then(|| LanguagesReplacement {
                language_ids: font.language_ids(),
            }),
            sources: changed(FontChangeImpact::SOURCES).then(|| Source::masters_of(font)),
            kerning: changed(FontChangeImpact::KERNING).then(|| KerningSnapshot::from(font)),
        }))
    }
}

impl Source {
    /// The font's sources, each with its metric values in the order of the
    /// font's metric definitions.
    pub fn masters_of(font: &Font) -> Vec<Self> {
        let metric_order = font
            .metric_definitions()
            .iter()
            .enumerate()
            .map(|(index, definition)| (definition.id(), index))
            .collect::<HashMap<_, _>>();
        let position = |metric_id: &shift_font::MetricId| {
            metric_order.get(metric_id).copied().unwrap_or(usize::MAX)
        };
        let mut sources: Vec<Self> = font.masters().map(Self::from).collect();
        for source in &mut sources {
            source.metric_values.sort_by(|left, right| {
                position(&left.metric_id)
                    .cmp(&position(&right.metric_id))
                    .then_with(|| left.metric_id.cmp(&right.metric_id))
            });
        }
        sources
    }
}
