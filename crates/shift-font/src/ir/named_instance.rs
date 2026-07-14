use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::{Axis, AxisKind, AxisRole, CoreError, CoreResult, Location, NamedInstanceId};

/// An authored product preset at a complete external variation location.
///
/// Named instances own no source or glyph geometry. Their location remains in
/// external coordinates when axis mappings change; interpolation maps it to
/// design space only when previewing or exporting the product.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedInstance {
    id: NamedInstanceId,
    name: String,
    location: Location,
    postscript_name: Option<String>,
}

impl NamedInstance {
    /// Creates a named instance with newly minted stable identity.
    pub fn new(name: String, location: Location, postscript_name: Option<String>) -> Self {
        Self::with_id(NamedInstanceId::new(), name, location, postscript_name)
    }

    /// Rebuilds a named instance while preserving source-format identity.
    pub fn with_id(
        id: NamedInstanceId,
        name: String,
        location: Location,
        postscript_name: Option<String>,
    ) -> Self {
        Self {
            id,
            name,
            location,
            postscript_name,
        }
    }

    /// Returns the identity retained across product renames and location edits.
    pub fn id(&self) -> NamedInstanceId {
        self.id.clone()
    }

    /// Returns the authored product name used as the variable-font subfamily name.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Returns the complete external location authored for this product.
    pub fn location(&self) -> &Location {
        &self.location
    }

    /// Returns the optional author-controlled published PostScript name.
    pub fn postscript_name(&self) -> Option<&str> {
        self.postscript_name.as_deref()
    }

    /// Validates authoring semantics against the current axis collection.
    ///
    /// # Errors
    ///
    /// Returns [`CoreError::InvalidNamedInstance`] when the name or optional
    /// PostScript name is invalid, or when the location is not a complete,
    /// finite external-axis location valid for each axis kind.
    pub fn validate(&self, axes: &[Axis]) -> CoreResult<()> {
        if self.name.trim().is_empty() {
            return Err(self.invalid("name must not be blank"));
        }

        if let Some(name) = &self.postscript_name {
            if !valid_postscript_name(name) {
                return Err(self.invalid(
                    "PostScript name must be 1..=63 printable ASCII characters without whitespace or [](){}<>/%",
                ));
            }
        }

        let axes_by_id = axes
            .iter()
            .map(|axis| (axis.id(), axis))
            .collect::<HashMap<_, _>>();
        for (axis_id, value) in self.location.iter() {
            let Some(axis) = axes_by_id.get(axis_id) else {
                return Err(self.invalid(format!("location references unknown axis {axis_id}")));
            };
            if axis.role() != AxisRole::External {
                return Err(
                    self.invalid(format!("location references internal axis {}", axis.tag()))
                );
            }
            validate_axis_value(axis, *value).map_err(|message| self.invalid(message))?;
        }

        for axis in axes.iter().filter(|axis| axis.role() == AxisRole::External) {
            if self.location.get(&axis.id()).is_none() {
                return Err(
                    self.invalid(format!("location is missing external axis {}", axis.tag()))
                );
            }
        }

        Ok(())
    }

    fn invalid(&self, message: impl Into<String>) -> CoreError {
        CoreError::InvalidNamedInstance {
            instance_id: self.id(),
            message: message.into(),
        }
    }
}

pub(crate) fn validate_named_instances(
    instances: &[NamedInstance],
    axes: &[Axis],
) -> CoreResult<()> {
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    let mut postscript_names = HashSet::new();

    for (index, instance) in instances.iter().enumerate() {
        instance.validate(axes)?;
        if !ids.insert(instance.id()) {
            return Err(CoreError::DuplicateNamedInstanceId(instance.id()));
        }
        if !names.insert(instance.name()) {
            return Err(CoreError::DuplicateNamedInstanceName(
                instance.name().to_string(),
            ));
        }
        if let Some(name) = instance.postscript_name() {
            if !postscript_names.insert(name) {
                return Err(CoreError::DuplicateNamedInstancePostscriptName(
                    name.to_string(),
                ));
            }
        }
        if let Some(existing) = instances[..index]
            .iter()
            .find(|existing| existing.location() == instance.location())
        {
            return Err(CoreError::DuplicateNamedInstanceLocation {
                first: existing.id(),
                second: instance.id(),
            });
        }
    }

    Ok(())
}

fn validate_axis_value(axis: &Axis, value: f64) -> Result<(), String> {
    if !value.is_finite() {
        return Err(format!("axis {} value must be finite", axis.tag()));
    }

    match axis.kind() {
        AxisKind::Continuous {
            minimum, maximum, ..
        } if value < *minimum || value > *maximum => Err(format!(
            "axis {} value {value} is outside {minimum}..={maximum}",
            axis.tag()
        )),
        AxisKind::Discrete { values, .. } if !values.contains(&value) => Err(format!(
            "axis {} value {value} is not one of its discrete values",
            axis.tag()
        )),
        _ => Ok(()),
    }
}

fn valid_postscript_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 63
        && name.bytes().all(|byte| {
            byte.is_ascii_graphic()
                && !matches!(
                    byte,
                    b'[' | b']' | b'(' | b')' | b'{' | b'}' | b'<' | b'>' | b'/' | b'%'
                )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn complete_external_location_is_valid() {
        let axis = Axis::weight();
        let mut location = Location::new();
        location.set(axis.id(), 700.0);
        let instance = NamedInstance::new("Bold".to_string(), location, None);

        assert!(instance.validate(&[axis]).is_ok());
    }

    #[test]
    fn missing_external_axis_is_invalid() {
        let axis = Axis::weight();
        let instance = NamedInstance::new("Bold".to_string(), Location::new(), None);

        assert!(matches!(
            instance.validate(&[axis]),
            Err(CoreError::InvalidNamedInstance { message, .. })
                if message.contains("missing external axis wght")
        ));
    }

    #[test]
    fn internal_axis_coordinate_is_invalid() {
        let mut axis = Axis::weight();
        axis.set_role(AxisRole::Internal);
        let mut location = Location::new();
        location.set(axis.id(), 400.0);
        let instance = NamedInstance::new("Regular".to_string(), location, None);

        assert!(matches!(
            instance.validate(&[axis]),
            Err(CoreError::InvalidNamedInstance { message, .. })
                if message.contains("internal axis wght")
        ));
    }

    #[test]
    fn postscript_name_uses_font_naming_constraints() {
        let axis = Axis::weight();
        let mut location = Location::new();
        location.set(axis.id(), 700.0);
        let instance = NamedInstance::new(
            "Bold".to_string(),
            location,
            Some("Dogfood Sans-Bold".to_string()),
        );

        assert!(matches!(
            instance.validate(&[axis]),
            Err(CoreError::InvalidNamedInstance { message, .. })
                if message.contains("PostScript name")
        ));
    }

    #[test]
    fn collection_rejects_two_products_at_the_same_location() {
        let axis = Axis::weight();
        let mut location = Location::new();
        location.set(axis.id(), 700.0);
        let first = NamedInstance::new("Bold".to_string(), location.clone(), None);
        let second = NamedInstance::new("Display".to_string(), location, None);

        assert!(matches!(
            validate_named_instances(&[first, second], &[axis]),
            Err(CoreError::DuplicateNamedInstanceLocation { .. })
        ));
    }
}
