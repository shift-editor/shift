use crate::axis::Location;
use crate::entity::{MetricId, SourceId};
use crate::lib_data::LibData;
use crate::metrics::{MetricDefinition, MetricValue};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// How a source participates in the font. A `Master` is a genuine
/// designspace source: it has a design-space location and earns a
/// `<source>` entry when the font is written as a designspace. A `Layer`
/// only carries a format layer that rides along with its file's masters
/// (e.g. a plain UFO background layer) and must never gain a designspace
/// `<source>` entry on save.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceRole {
    #[default]
    Master,
    Layer,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    id: SourceId,
    name: String,
    location: Location,
    #[serde(default)]
    metric_values: BTreeMap<MetricId, MetricValue>,
    #[serde(default)]
    italic_angle: Option<f64>,
    #[serde(default)]
    line_gap: Option<f64>,
    #[serde(default)]
    underline_position: Option<f64>,
    #[serde(default)]
    underline_thickness: Option<f64>,
    filename: Option<String>,
    #[serde(default)]
    color: Option<String>,
    #[serde(default)]
    lib: LibData,
    #[serde(default)]
    role: SourceRole,
    #[serde(default)]
    layer_name: Option<String>,
}

impl Source {
    pub fn new(name: String, location: Location) -> Self {
        Self {
            id: SourceId::new(),
            name,
            location,
            metric_values: BTreeMap::new(),
            italic_angle: None,
            line_gap: None,
            underline_position: None,
            underline_thickness: None,
            filename: None,
            color: None,
            lib: LibData::new(),
            role: SourceRole::Master,
            layer_name: None,
        }
    }

    pub fn with_filename(name: String, location: Location, filename: String) -> Self {
        Self {
            id: SourceId::new(),
            name,
            location,
            metric_values: BTreeMap::new(),
            italic_angle: None,
            line_gap: None,
            underline_position: None,
            underline_thickness: None,
            filename: Some(filename),
            color: None,
            lib: LibData::new(),
            role: SourceRole::Master,
            layer_name: None,
        }
    }

    pub fn with_id(
        id: SourceId,
        name: String,
        location: Location,
        filename: Option<String>,
    ) -> Self {
        Self {
            id,
            name,
            location,
            metric_values: BTreeMap::new(),
            italic_angle: None,
            line_gap: None,
            underline_position: None,
            underline_thickness: None,
            filename,
            color: None,
            lib: LibData::new(),
            role: SourceRole::Master,
            layer_name: None,
        }
    }

    /// A layer-only source: it carries a format layer named `name` (e.g. a
    /// UFO background layer) but is not a designspace master.
    pub fn layer(name: String) -> Self {
        Self {
            id: SourceId::new(),
            name,
            location: Location::new(),
            metric_values: BTreeMap::new(),
            italic_angle: None,
            line_gap: None,
            underline_position: None,
            underline_thickness: None,
            filename: None,
            color: None,
            lib: LibData::new(),
            role: SourceRole::Layer,
            layer_name: None,
        }
    }

    pub fn id(&self) -> SourceId {
        self.id.clone()
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn location(&self) -> &Location {
        &self.location
    }

    pub fn filename(&self) -> Option<&str> {
        self.filename.as_deref()
    }

    /// Returns source-local metric values keyed by stable font metric identity.
    pub fn metric_values(&self) -> &BTreeMap<MetricId, MetricValue> {
        &self.metric_values
    }

    pub(crate) fn metric_values_mut(&mut self) -> &mut BTreeMap<MetricId, MetricValue> {
        &mut self.metric_values
    }

    pub fn metric_value(&self, metric_id: &MetricId) -> Option<MetricValue> {
        self.metric_values.get(metric_id).copied()
    }

    pub fn set_metric_value(&mut self, metric_id: MetricId, value: MetricValue) {
        self.metric_values.insert(metric_id, value);
    }

    pub fn set_metric_values(&mut self, values: BTreeMap<MetricId, MetricValue>) {
        self.metric_values = values;
    }

    /// Fills any missing metric rows without replacing authored values.
    pub fn fill_metric_values(&mut self, definitions: &[MetricDefinition], units_per_em: f64) {
        for definition in definitions {
            self.metric_values
                .entry(definition.id())
                .or_insert_with(|| MetricValue::for_kind(definition.kind(), units_per_em));
        }
    }

    pub fn italic_angle(&self) -> Option<f64> {
        self.italic_angle
    }

    pub fn set_italic_angle(&mut self, value: Option<f64>) {
        self.italic_angle = value;
    }

    pub fn line_gap(&self) -> Option<f64> {
        self.line_gap
    }

    pub fn set_line_gap(&mut self, value: Option<f64>) {
        self.line_gap = value;
    }

    pub fn underline_position(&self) -> Option<f64> {
        self.underline_position
    }

    pub fn set_underline_position(&mut self, value: Option<f64>) {
        self.underline_position = value;
    }

    pub fn underline_thickness(&self) -> Option<f64> {
        self.underline_thickness
    }

    pub fn set_underline_thickness(&mut self, value: Option<f64>) {
        self.underline_thickness = value;
    }

    pub fn role(&self) -> SourceRole {
        self.role
    }

    pub fn is_master(&self) -> bool {
        self.role == SourceRole::Master
    }

    pub fn set_role(&mut self, role: SourceRole) {
        self.role = role;
    }

    /// The UFO layer inside [`Self::filename`] that holds this source's
    /// data, when a designspace `<source>` declared it explicitly with a
    /// `layer` attribute. `None` means the file's default layer for
    /// masters, or a layer named after the source for layer-only sources.
    pub fn layer_name(&self) -> Option<&str> {
        self.layer_name.as_deref()
    }

    pub fn set_layer_name(&mut self, layer_name: Option<String>) {
        self.layer_name = layer_name;
    }

    /// The source's display color from the format's layer metadata
    /// (e.g. UFO `layerinfo.plist`), as an `r,g,b,a` string.
    pub fn color(&self) -> Option<&str> {
        self.color.as_deref()
    }

    pub fn set_color(&mut self, color: Option<String>) {
        self.color = color;
    }

    /// Layer-level lib data from the format's layer metadata
    /// (e.g. UFO `layerinfo.plist`).
    pub fn lib(&self) -> &LibData {
        &self.lib
    }

    pub fn lib_mut(&mut self) -> &mut LibData {
        &mut self.lib
    }

    pub fn set_name(&mut self, name: String) {
        self.name = name;
    }

    pub fn set_location(&mut self, location: Location) {
        self.location = location;
    }

    pub fn remove_axis_location(&mut self, axis_id: &crate::AxisId) -> Option<f64> {
        self.location.remove(axis_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AxisId;

    #[test]
    fn source_creation() {
        let mut location = Location::new();
        let axis_id = AxisId::from_raw("wght");
        location.set(axis_id.clone(), 400.0);

        let source = Source::new("Regular".to_string(), location);
        assert_eq!(source.name(), "Regular");
        assert_eq!(source.location().get(&axis_id), Some(400.0));
    }
}
