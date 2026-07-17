use std::collections::BTreeMap;

use crate::{Axis, CoreResult, Font, Location, MetricId, MetricValue, Source, SourceId};

use super::InterpolationBasis;

/// Identifies an optional source-level numeric metric within an interpolation model.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SourceMetricField {
    ItalicAngle,
    LineGap,
    UnderlinePosition,
    UnderlineThickness,
}

/// Ordered metric values authored by one source.
#[derive(Clone, Debug, PartialEq)]
pub struct SourceMetricValues {
    source_id: SourceId,
    values: Vec<f64>,
}

impl SourceMetricValues {
    /// Returns the stable identity of the authored source.
    pub fn source_id(&self) -> SourceId {
        self.source_id.clone()
    }

    /// Returns values aligned with the interpolation model's metric schema.
    pub fn as_slice(&self) -> &[f64] {
        &self.values
    }
}

/// Source-owned metrics resolved at an internal authoring location.
#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedSourceMetrics {
    metric_values: BTreeMap<MetricId, MetricValue>,
    italic_angle: Option<f64>,
    line_gap: Option<f64>,
    underline_position: Option<f64>,
    underline_thickness: Option<f64>,
}

impl ResolvedSourceMetrics {
    pub fn metric_values(&self) -> &BTreeMap<MetricId, MetricValue> {
        &self.metric_values
    }

    pub fn italic_angle(&self) -> Option<f64> {
        self.italic_angle
    }

    pub fn line_gap(&self) -> Option<f64> {
        self.line_gap
    }

    pub fn underline_position(&self) -> Option<f64> {
        self.underline_position
    }

    pub fn underline_thickness(&self) -> Option<f64> {
        self.underline_thickness
    }
}

/// Reusable interpolation for source-owned metric values.
///
/// Metric identity and flattened value ordering are owned here rather than by
/// a transport consumer. Optional technical fields participate only when every
/// master source authors them.
#[derive(Clone, Debug, PartialEq)]
pub struct SourceMetricInterpolation {
    metric_ids: Vec<MetricId>,
    technical_fields: Vec<SourceMetricField>,
    basis: InterpolationBasis,
    sources: Vec<SourceMetricValues>,
}

impl SourceMetricInterpolation {
    pub fn metric_ids(&self) -> &[MetricId] {
        &self.metric_ids
    }

    pub fn technical_fields(&self) -> &[SourceMetricField] {
        &self.technical_fields
    }

    /// Returns the coordinate-independent source contribution basis.
    pub fn basis(&self) -> &InterpolationBasis {
        &self.basis
    }

    /// Returns source values aligned with [`InterpolationBasis::source_ids`].
    pub fn sources(&self) -> &[SourceMetricValues] {
        &self.sources
    }

    /// Resolves source metrics at one internal authoring location.
    ///
    /// Missing axis coordinates use authoring defaults. The returned value is
    /// derived and owns no source identity.
    ///
    /// # Errors
    ///
    /// Returns [`crate::CoreError::AxisNotFound`] when `axes` omits an axis
    /// referenced by an interpolation region.
    pub fn resolve(&self, location: &Location, axes: &[Axis]) -> CoreResult<ResolvedSourceMetrics> {
        let value_count = self
            .sources
            .first()
            .map_or(0, |source| source.as_slice().len());
        let mut values = vec![0.0; value_count];
        let weights = self.basis.weights_at(location, axes)?;

        for (source, weight) in self.sources.iter().zip(weights) {
            if weight == 0.0 {
                continue;
            }

            for (value, source_value) in values.iter_mut().zip(source.as_slice()) {
                *value += weight * source_value;
            }
        }

        Ok(self.decode(&values))
    }

    fn decode(&self, values: &[f64]) -> ResolvedSourceMetrics {
        let mut metric_values = BTreeMap::new();
        for (index, metric_id) in self.metric_ids.iter().enumerate() {
            let value_index = index * 2;
            let Some(position) = values.get(value_index) else {
                break;
            };
            let Some(overshoot) = values.get(value_index + 1) else {
                break;
            };
            metric_values.insert(metric_id.clone(), MetricValue::new(*position, *overshoot));
        }

        let technical_offset = self.metric_ids.len() * 2;
        let technical = |field| {
            self.technical_fields
                .iter()
                .position(|candidate| *candidate == field)
                .and_then(|index| values.get(technical_offset + index))
                .copied()
        };

        ResolvedSourceMetrics {
            metric_values,
            italic_angle: technical(SourceMetricField::ItalicAngle),
            line_gap: technical(SourceMetricField::LineGap),
            underline_position: technical(SourceMetricField::UnderlinePosition),
            underline_thickness: technical(SourceMetricField::UnderlineThickness),
        }
    }
}

impl Font {
    /// Builds reusable interpolation for source-owned metric values.
    ///
    /// `None` means the font is static, lacks a master default source, contains
    /// duplicate normalized master locations, or cannot form a valid variation
    /// model. Exact authored source metrics remain available independently.
    pub fn source_metric_interpolation(&self) -> Option<SourceMetricInterpolation> {
        if !self.is_variable() {
            return None;
        }

        let sources = self
            .sources()
            .iter()
            .filter(|source| source.is_master())
            .collect::<Vec<_>>();
        let default_source = self.default_source()?;
        if !default_source.is_master() || sources.is_empty() {
            return None;
        }

        let metric_ids = self
            .metric_definitions()
            .iter()
            .map(|definition| definition.id())
            .collect::<Vec<_>>();
        let technical_fields = [
            SourceMetricField::ItalicAngle,
            SourceMetricField::LineGap,
            SourceMetricField::UnderlinePosition,
            SourceMetricField::UnderlineThickness,
        ]
        .into_iter()
        .filter(|field| {
            sources
                .iter()
                .all(|source| technical_metric(source, *field).is_some())
        })
        .collect::<Vec<_>>();

        let mut source_locations = Vec::with_capacity(sources.len());
        let mut source_values = Vec::with_capacity(sources.len());
        for source in sources {
            let mut values = Vec::with_capacity(metric_ids.len() * 2 + technical_fields.len());
            for metric_id in &metric_ids {
                let metric = source.metric_value(metric_id)?;
                values.push(metric.position);
                values.push(metric.overshoot);
            }
            for field in &technical_fields {
                values.push(technical_metric(source, *field)?);
            }
            source_locations.push((source.id(), source.location().clone()));
            source_values.push(SourceMetricValues {
                source_id: source.id(),
                values,
            });
        }

        let basis = InterpolationBasis::from_source_locations(&source_locations, self.axes())?;
        Some(SourceMetricInterpolation {
            metric_ids,
            technical_fields,
            basis,
            sources: source_values,
        })
    }
}

fn technical_metric(source: &Source, field: SourceMetricField) -> Option<f64> {
    match field {
        SourceMetricField::ItalicAngle => source.italic_angle(),
        SourceMetricField::LineGap => source.line_gap(),
        SourceMetricField::UnderlinePosition => source.underline_position(),
        SourceMetricField::UnderlineThickness => source.underline_thickness(),
    }
}

#[cfg(test)]
mod tests {
    use crate::{Font, Location, MetricKind, MetricValue, Source};

    use super::SourceMetricField;

    #[test]
    fn source_metrics_interpolate_without_inventing_sparse_fields() {
        let mut font = Font::new();
        let axis = crate::Axis::weight();
        let axis_id = axis.id();
        font.add_axis(axis).unwrap();

        let ascender_id = font
            .metric_definitions()
            .iter()
            .find(|definition| definition.kind() == MetricKind::Ascender)
            .unwrap()
            .id();
        let default_id = font.default_source_id().unwrap();
        let mut default_location = Location::new();
        default_location.set(axis_id.clone(), 400.0);
        let default_source = font.source_mut(default_id).unwrap();
        default_source.set_location(default_location);
        default_source.set_metric_value(ascender_id.clone(), MetricValue::new(800.0, 16.0));
        default_source.set_line_gap(Some(20.0));

        let mut bold_location = Location::new();
        bold_location.set(axis_id.clone(), 700.0);
        let bold_id = font.add_source(Source::new("Bold".to_string(), bold_location));
        font.source_mut(bold_id)
            .unwrap()
            .set_metric_value(ascender_id.clone(), MetricValue::new(900.0, 20.0));

        let interpolation = font.source_metric_interpolation().unwrap();
        let mut middle = Location::new();
        middle.set(axis_id, 550.0);
        let resolved = interpolation.resolve(&middle, font.axes()).unwrap();

        assert_eq!(
            resolved.metric_values().get(&ascender_id),
            Some(&MetricValue::new(850.0, 18.0))
        );
        assert!(!interpolation
            .technical_fields()
            .contains(&SourceMetricField::LineGap));
        assert_eq!(resolved.line_gap(), None);
    }
}
