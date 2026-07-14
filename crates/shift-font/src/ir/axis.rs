use crate::entity::{AxisId, AxisLabelId, AxisMappingId};
use crate::error::{CoreError, CoreResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AxisRole {
    #[default]
    External,
    Internal,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AxisKind {
    Continuous {
        minimum: f64,
        default: f64,
        maximum: f64,
    },
    Discrete {
        values: Vec<f64>,
        default: f64,
    },
}

impl AxisKind {
    pub fn minimum(&self) -> f64 {
        match self {
            Self::Continuous { minimum, .. } => *minimum,
            Self::Discrete { values, default } => {
                values.iter().copied().reduce(f64::min).unwrap_or(*default)
            }
        }
    }

    pub fn default(&self) -> f64 {
        match self {
            Self::Continuous { default, .. } | Self::Discrete { default, .. } => *default,
        }
    }

    pub fn maximum(&self) -> f64 {
        match self {
            Self::Continuous { maximum, .. } => *maximum,
            Self::Discrete { values, default } => {
                values.iter().copied().reduce(f64::max).unwrap_or(*default)
            }
        }
    }

    pub fn values(&self) -> Option<&[f64]> {
        match self {
            Self::Continuous { .. } => None,
            Self::Discrete { values, .. } => Some(values),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisLabelRange {
    pub minimum: f64,
    pub maximum: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// One authored external-axis name and its stable identity.
///
/// Labels describe values for authoring UI and STAT output. They do not create
/// products or reference sources.
pub struct AxisLabel {
    id: AxisLabelId,
    pub name: String,
    pub value: f64,
    pub range: Option<AxisLabelRange>,
    pub linked_value: Option<f64>,
    pub elidable: bool,
}

impl AxisLabel {
    /// Creates a user-space axis label with newly minted stable identity.
    pub fn new(
        name: String,
        value: f64,
        range: Option<AxisLabelRange>,
        linked_value: Option<f64>,
        elidable: bool,
    ) -> Self {
        Self::with_id(
            AxisLabelId::new(),
            name,
            value,
            range,
            linked_value,
            elidable,
        )
    }

    /// Rebuilds an axis label while preserving source-format identity.
    pub fn with_id(
        id: AxisLabelId,
        name: String,
        value: f64,
        range: Option<AxisLabelRange>,
        linked_value: Option<f64>,
        elidable: bool,
    ) -> Self {
        Self {
            id,
            name,
            value,
            range,
            linked_value,
            elidable,
        }
    }

    /// Returns the identity retained across label renames and reordering.
    pub fn id(&self) -> AxisLabelId {
        self.id.clone()
    }

    fn invalid(&self, message: impl Into<String>) -> CoreError {
        CoreError::InvalidAxisLabel {
            label_id: self.id(),
            message: message.into(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Axis {
    id: AxisId,
    tag: String,
    name: String,
    role: AxisRole,
    kind: AxisKind,
    labels: Vec<AxisLabel>,
    hidden: bool,
}

impl Axis {
    pub fn new(tag: String, name: String, minimum: f64, default: f64, maximum: f64) -> Self {
        Self::with_id(AxisId::new(), tag, name, minimum, default, maximum)
    }

    pub fn with_id(
        id: AxisId,
        tag: String,
        name: String,
        minimum: f64,
        default: f64,
        maximum: f64,
    ) -> Self {
        Self::continuous_with_id(id, tag, name, minimum, default, maximum)
    }

    pub fn continuous_with_id(
        id: AxisId,
        tag: String,
        name: String,
        minimum: f64,
        default: f64,
        maximum: f64,
    ) -> Self {
        Self {
            id,
            tag,
            name,
            role: AxisRole::External,
            kind: AxisKind::Continuous {
                minimum,
                default,
                maximum,
            },
            labels: Vec::new(),
            hidden: false,
        }
    }

    pub fn discrete_with_id(
        id: AxisId,
        tag: String,
        name: String,
        values: Vec<f64>,
        default: f64,
    ) -> Self {
        Self {
            id,
            tag,
            name,
            role: AxisRole::External,
            kind: AxisKind::Discrete { values, default },
            labels: Vec::new(),
            hidden: false,
        }
    }

    pub fn weight() -> Self {
        Self::new(
            "wght".to_string(),
            "Weight".to_string(),
            100.0,
            400.0,
            900.0,
        )
    }

    pub fn width() -> Self {
        Self::new("wdth".to_string(), "Width".to_string(), 75.0, 100.0, 125.0)
    }

    pub fn id(&self) -> AxisId {
        self.id.clone()
    }

    pub fn tag(&self) -> &str {
        &self.tag
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn role(&self) -> AxisRole {
        self.role
    }

    pub fn kind(&self) -> &AxisKind {
        &self.kind
    }

    pub fn minimum(&self) -> f64 {
        self.kind.minimum()
    }

    pub fn default(&self) -> f64 {
        self.kind.default()
    }

    pub fn maximum(&self) -> f64 {
        self.kind.maximum()
    }

    pub fn discrete_values(&self) -> Option<&[f64]> {
        self.kind.values()
    }

    pub fn labels(&self) -> &[AxisLabel] {
        &self.labels
    }

    pub fn is_hidden(&self) -> bool {
        self.hidden
    }

    pub fn set_role(&mut self, role: AxisRole) {
        self.role = role;
    }

    pub fn set_kind(&mut self, kind: AxisKind) {
        self.kind = kind;
    }

    pub fn set_labels(&mut self, labels: Vec<AxisLabel>) {
        self.labels = labels;
    }

    pub fn set_hidden(&mut self, hidden: bool) {
        self.hidden = hidden;
    }

    pub fn validate(&self) -> CoreResult<()> {
        if self.name.trim().is_empty() {
            return Err(self.invalid("name must not be blank"));
        }
        if self.tag.len() != 4 || !self.tag.is_ascii() {
            return Err(self.invalid("tag must contain exactly four ASCII characters"));
        }

        match &self.kind {
            AxisKind::Continuous {
                minimum,
                default,
                maximum,
            } => {
                if !minimum.is_finite() || !default.is_finite() || !maximum.is_finite() {
                    return Err(self.invalid("continuous range values must be finite"));
                }
                if minimum > default || default > maximum {
                    return Err(self.invalid("expected minimum <= default <= maximum"));
                }
            }
            AxisKind::Discrete { values, default } => {
                if values.is_empty() {
                    return Err(self.invalid("discrete axes require at least one value"));
                }
                if !default.is_finite() || values.iter().any(|value| !value.is_finite()) {
                    return Err(self.invalid("discrete values must be finite"));
                }
                if values.windows(2).any(|pair| pair[0] >= pair[1]) {
                    return Err(self.invalid("discrete values must be strictly increasing"));
                }
                if !values.contains(default) {
                    return Err(self.invalid("default must be one of the discrete values"));
                }
            }
        }

        if self.role == AxisRole::Internal && !self.labels.is_empty() {
            return Err(self.invalid("internal axes cannot own user-space labels"));
        }

        let mut label_ids = std::collections::HashSet::new();
        for (index, label) in self.labels.iter().enumerate() {
            if !label_ids.insert(label.id()) {
                return Err(CoreError::DuplicateAxisLabelId(label.id()));
            }
            if label.name.trim().is_empty() {
                return Err(label.invalid("names must not be blank"));
            }
            if !label.value.is_finite()
                || label.linked_value.is_some_and(|value| !value.is_finite())
            {
                return Err(label.invalid("values must be finite"));
            }
            if let Some(range) = &label.range {
                if !range.minimum.is_finite() || !range.maximum.is_finite() {
                    return Err(label.invalid("ranges must be finite"));
                }
                if range.minimum > label.value || label.value > range.maximum {
                    return Err(label.invalid("ranges must contain their nominal value"));
                }
            }
            if label.range.is_some() && label.linked_value.is_some() {
                return Err(label.invalid("ranges and linked values are mutually exclusive"));
            }

            let mut values = vec![label.value];
            if let Some(linked_value) = label.linked_value {
                values.push(linked_value);
            }
            if let Some(range) = &label.range {
                values.extend([range.minimum, range.maximum]);
            }
            for value in values {
                if value < self.minimum() || value > self.maximum() {
                    return Err(label.invalid("values must be inside the axis range"));
                }
                if let AxisKind::Discrete { values, .. } = &self.kind {
                    if !values.contains(&value) {
                        return Err(
                            label.invalid("discrete-axis values must be authored discrete values")
                        );
                    }
                }
            }
            if self.labels[..index]
                .iter()
                .any(|existing| existing.value == label.value)
            {
                return Err(label.invalid("nominal values must be distinct"));
            }
        }

        Ok(())
    }

    fn invalid(&self, message: impl Into<String>) -> CoreError {
        CoreError::InvalidAxis {
            axis_id: self.id(),
            message: message.into(),
        }
    }

    pub fn normalize(&self, value: f64) -> f64 {
        let minimum = self.minimum();
        let default = self.default();
        let maximum = self.maximum();

        if value < default {
            if (default - minimum).abs() < f64::EPSILON {
                0.0
            } else {
                (value - default) / (default - minimum)
            }
        } else if value > default {
            if (maximum - default).abs() < f64::EPSILON {
                0.0
            } else {
                (value - default) / (maximum - default)
            }
        } else {
            0.0
        }
    }

    pub fn denormalize(&self, value: f64) -> f64 {
        let minimum = self.minimum();
        let default = self.default();
        let maximum = self.maximum();

        if value < 0.0 {
            default + value * (default - minimum)
        } else if value > 0.0 {
            default + value * (maximum - default)
        } else {
            default
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisMappingPoint {
    pub description: Option<String>,
    pub input: Location,
    pub output: Location,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AxisMapping {
    id: AxisMappingId,
    name: String,
    description: Option<String>,
    inputs: Vec<AxisId>,
    outputs: Vec<AxisId>,
    points: Vec<AxisMappingPoint>,
}

impl AxisMapping {
    pub fn new(
        name: String,
        inputs: Vec<AxisId>,
        outputs: Vec<AxisId>,
        points: Vec<AxisMappingPoint>,
    ) -> Self {
        Self::with_id(AxisMappingId::new(), name, inputs, outputs, points)
    }

    pub fn with_id(
        id: AxisMappingId,
        name: String,
        inputs: Vec<AxisId>,
        outputs: Vec<AxisId>,
        points: Vec<AxisMappingPoint>,
    ) -> Self {
        Self {
            id,
            name,
            description: None,
            inputs,
            outputs,
            points,
        }
    }

    pub fn id(&self) -> AxisMappingId {
        self.id.clone()
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    pub fn description(&self) -> Option<&str> {
        self.description.as_deref()
    }

    pub fn inputs(&self) -> &[AxisId] {
        &self.inputs
    }

    pub fn outputs(&self) -> &[AxisId] {
        &self.outputs
    }

    pub fn points(&self) -> &[AxisMappingPoint] {
        &self.points
    }

    pub fn is_independent(&self) -> bool {
        self.inputs.len() == 1 && self.outputs == self.inputs
    }

    pub fn set_description(&mut self, description: Option<String>) {
        self.description = description;
    }

    pub fn validate(&self, axes: &[Axis]) -> CoreResult<()> {
        if self.name.trim().is_empty() {
            return Err(self.invalid("name must not be blank"));
        }
        if self.inputs.is_empty() {
            return Err(self.invalid("at least one input axis is required"));
        }
        if self.outputs.is_empty() {
            return Err(self.invalid("at least one output axis is required"));
        }
        if self.points.is_empty() {
            return Err(self.invalid("at least one mapping point is required"));
        }
        if has_duplicates(&self.inputs) || has_duplicates(&self.outputs) {
            return Err(self.invalid("input and output axes must be unique"));
        }

        for axis_id in self.inputs.iter().chain(&self.outputs) {
            if !axes.iter().any(|axis| axis.id() == *axis_id) {
                return Err(self.invalid(format!("references unknown axis {axis_id}")));
            }
        }
        for input_id in &self.inputs {
            let axis = axes
                .iter()
                .find(|axis| axis.id() == *input_id)
                .expect("mapping axes were checked above");
            if self.is_independent() && axis.role() != AxisRole::External {
                return Err(self.invalid(format!("input axis {input_id} is not external")));
            }
        }

        for point in &self.points {
            if point.input.iter().next().is_none() || point.output.iter().next().is_none() {
                return Err(self.invalid("mapping points require input and output locations"));
            }
            if self.is_independent()
                && (point.input.get(&self.inputs[0]).is_none()
                    || point.output.get(&self.outputs[0]).is_none())
            {
                return Err(self.invalid(
                    "independent mapping points require explicit input and output values",
                ));
            }
            for (axis_id, value) in point.input.iter() {
                if !self.inputs.contains(axis_id) {
                    return Err(
                        self.invalid(format!("point input references undeclared axis {axis_id}"))
                    );
                }
                if !value.is_finite() {
                    return Err(self.invalid("point input values must be finite"));
                }
            }
            for (axis_id, value) in point.output.iter() {
                if !self.outputs.contains(axis_id) {
                    return Err(
                        self.invalid(format!("point output references undeclared axis {axis_id}"))
                    );
                }
                if !value.is_finite() {
                    return Err(self.invalid("point output values must be finite"));
                }
            }
        }

        Ok(())
    }

    fn invalid(&self, message: impl Into<String>) -> CoreError {
        CoreError::InvalidAxisMapping {
            mapping_id: self.id(),
            message: message.into(),
        }
    }
}

fn has_duplicates(ids: &[AxisId]) -> bool {
    ids.iter()
        .enumerate()
        .any(|(index, id)| ids[index + 1..].contains(id))
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Location {
    values: HashMap<AxisId, f64>,
}

impl Location {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn from_map(values: HashMap<AxisId, f64>) -> Self {
        Self { values }
    }

    pub fn get(&self, axis_id: &AxisId) -> Option<f64> {
        self.values.get(axis_id).copied()
    }

    pub fn set(&mut self, axis_id: AxisId, value: f64) {
        self.values.insert(axis_id, value);
    }

    pub fn remove(&mut self, axis_id: &AxisId) -> Option<f64> {
        self.values.remove(axis_id)
    }

    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&AxisId, &f64)> {
        self.values.iter()
    }

    pub fn normalize(&self, axes: &[Axis]) -> Location {
        let mut normalized = HashMap::new();
        for axis in axes {
            if let Some(&value) = self.values.get(&axis.id()) {
                normalized.insert(axis.id(), axis.normalize(value));
            }
        }
        Location::from_map(normalized)
    }

    pub fn is_default_axis(&self, axes: &[Axis]) -> bool {
        axes.iter().all(|axis| {
            let value = self.get(&axis.id()).unwrap_or(axis.default());
            (value - axis.default()).abs() < f64::EPSILON
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn axis_normalize() {
        let axis = Axis::weight();

        assert_eq!(axis.normalize(400.0), 0.0);
        assert!((axis.normalize(100.0) - (-1.0)).abs() < 0.001);
        assert!((axis.normalize(900.0) - 1.0).abs() < 0.001);
        assert!((axis.normalize(250.0) - (-0.5)).abs() < 0.001);
    }

    #[test]
    fn axis_denormalize() {
        let axis = Axis::weight();

        assert_eq!(axis.denormalize(0.0), 400.0);
        assert_eq!(axis.denormalize(-1.0), 100.0);
        assert_eq!(axis.denormalize(1.0), 900.0);
    }

    #[test]
    fn discrete_axis_uses_authored_values_for_range() {
        let axis = Axis::discrete_with_id(
            AxisId::from_raw("italic"),
            "ital".to_string(),
            "Italic".to_string(),
            vec![0.0, 1.0],
            0.0,
        );

        assert_eq!(axis.minimum(), 0.0);
        assert_eq!(axis.maximum(), 1.0);
        assert_eq!(axis.discrete_values(), Some([0.0, 1.0].as_slice()));
    }

    #[test]
    fn axis_label_identity_is_stable_and_unique() {
        let label_id = AxisLabelId::from_raw("regular");
        let label = AxisLabel::with_id(
            label_id.clone(),
            "Regular".to_string(),
            400.0,
            None,
            None,
            true,
        );
        let mut axis = Axis::weight();
        axis.set_labels(vec![label.clone()]);

        assert_eq!(axis.labels()[0].id(), label_id);
        assert!(axis.validate().is_ok());

        axis.set_labels(vec![label.clone(), label]);
        assert!(matches!(
            axis.validate(),
            Err(CoreError::DuplicateAxisLabelId(id)) if id == label_id
        ));
    }

    #[test]
    fn axis_label_range_and_linked_value_error_identifies_the_label() {
        let label_id = AxisLabelId::from_raw("regular");
        let mut axis = Axis::weight();
        axis.set_labels(vec![AxisLabel::with_id(
            label_id.clone(),
            "Regular".to_string(),
            400.0,
            Some(AxisLabelRange {
                minimum: 350.0,
                maximum: 450.0,
            }),
            Some(700.0),
            true,
        )]);

        assert!(matches!(
            axis.validate(),
            Err(CoreError::InvalidAxisLabel {
                label_id: invalid_id,
                message,
            }) if invalid_id == label_id && message.contains("mutually exclusive")
        ));
    }

    #[test]
    fn out_of_range_axis_label_error_identifies_the_label() {
        let label_id = AxisLabelId::from_raw("black");
        let mut axis = Axis::weight();
        axis.set_labels(vec![AxisLabel::with_id(
            label_id.clone(),
            "Black".to_string(),
            950.0,
            None,
            None,
            false,
        )]);

        assert!(matches!(
            axis.validate(),
            Err(CoreError::InvalidAxisLabel {
                label_id: invalid_id,
                message,
            }) if invalid_id == label_id && message.contains("inside the axis range")
        ));
    }

    #[test]
    fn internal_axis_cannot_own_external_labels() {
        let mut axis = Axis::weight();
        axis.set_role(AxisRole::Internal);
        axis.set_labels(vec![AxisLabel::new(
            "Regular".to_string(),
            400.0,
            None,
            None,
            true,
        )]);

        assert!(matches!(
            axis.validate(),
            Err(CoreError::InvalidAxis { message, .. })
                if message.contains("internal axes cannot own user-space labels")
        ));
    }

    #[test]
    fn location_operations() {
        let weight = AxisId::from_raw("wght");
        let width = AxisId::from_raw("wdth");
        let slant = AxisId::from_raw("slnt");
        let mut loc = Location::new();
        loc.set(weight.clone(), 700.0);
        loc.set(width.clone(), 100.0);

        assert_eq!(loc.get(&weight), Some(700.0));
        assert_eq!(loc.get(&width), Some(100.0));
        assert_eq!(loc.get(&slant), None);
    }
}
