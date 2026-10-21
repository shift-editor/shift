//! Designspace questions that norad's axis and document types leave to callers.

use norad::designspace::{Axis, DesignSpaceDocument, Dimension};

use crate::font_source::{VariationAxisKind, piecewise_map};

/// Maps and describes a Designspace axis the way designspaceLib does.
pub(crate) trait DesignspaceAxisExt {
    /// Maps a user-space value to design space.
    fn map_forward(&self, user_value: f64) -> f64;
    /// Maps a design-space value back to user space.
    fn map_backward(&self, value: f64) -> f64;
    /// Returns the axis's user-space `(minimum, maximum)`.
    fn user_range(&self) -> (f64, f64);
    /// Returns the axis as a continuous range or a set of discrete values.
    fn variation_kind(&self) -> VariationAxisKind;
    /// Returns this axis's design-space value in a source's `dimensions`.
    fn design_value_in(&self, dimensions: &[Dimension]) -> f64;

    /// Returns the axis default mapped to design space.
    fn default_design_value(&self) -> f64;
}

/// Finds the default source the way designspaceLib does.
pub(crate) trait DesignspaceDocumentExt {
    /// Returns the index of the source at every axis's default.
    fn default_source_index(&self) -> Option<usize>;
}

impl DesignspaceAxisExt for Axis {
    fn map_forward(&self, user_value: f64) -> f64 {
        let Some(mapping) = self.map.as_ref().filter(|mapping| !mapping.is_empty()) else {
            return user_value;
        };

        if self.values.is_some() {
            return mapping
                .iter()
                .find(|point| point.input as f64 == user_value)
                .map_or(user_value, |point| point.output as f64);
        }

        let mut points = mapping
            .iter()
            .map(|point| (point.input as f64, point.output as f64))
            .collect::<Vec<_>>();
        points.sort_by(|left, right| left.0.total_cmp(&right.0));

        piecewise_map(user_value, &points)
    }

    // Matches designspaceLib's continuous and discrete `map_backward` behavior.
    // Continuous flat segments choose the first user value; discrete maps only
    // replace exact authored values.
    // https://fonttools.readthedocs.io/en/stable/designspaceLib/python.html#fontTools.designspaceLib.AxisDescriptor.map_backward
    fn map_backward(&self, value: f64) -> f64 {
        let Some(map) = self.map.as_ref().filter(|map| !map.is_empty()) else {
            return value;
        };

        if self.values.is_some() {
            return map
                .iter()
                .find(|point| point.output as f64 == value)
                .map_or(value, |point| point.input as f64);
        }

        let mut points = map
            .iter()
            .map(|point| (point.output as f64, point.input as f64))
            .collect::<Vec<_>>();
        points.sort_by(|left, right| {
            left.0
                .total_cmp(&right.0)
                .then_with(|| left.1.total_cmp(&right.1))
        });

        let (first_design, first_user) = points[0];
        if value <= first_design {
            return value + first_user - first_design;
        }
        for pair in points.windows(2) {
            let (lower_design, lower_user) = pair[0];
            let (upper_design, upper_user) = pair[1];
            if lower_design <= value && value <= upper_design {
                if lower_design == upper_design {
                    return lower_user;
                }

                return lower_user
                    + (upper_user - lower_user) * (value - lower_design)
                        / (upper_design - lower_design);
            }
        }

        let (last_design, last_user) = points[points.len() - 1];
        value + last_user - last_design
    }

    // Derive (minimum, maximum) for an axis from norad's parsed designspace.
    //
    // Designspace axis edge cases handled:
    // - **Continuous** (both min/max present): use as-is.
    // - **Discrete** (`values="0 1"` with no min/max attrs): min/max are the
    //   smallest/largest values in the list. e.g. `ital`, our `SLAB`.
    // - **One-sided** (only min OR max specified): the missing side falls back
    //   to `default`. Common with slant axes (`min=-15, default=0, max=0`).
    // - **Degenerate** (no min/max/values): all three collapse to default.
    fn user_range(&self) -> (f64, f64) {
        let values_range = || {
            self.values
                .as_ref()
                .filter(|v| !v.is_empty())
                .map(|values| {
                    let min = values.iter().copied().fold(f32::INFINITY, f32::min) as f64;
                    let max = values.iter().copied().fold(f32::NEG_INFINITY, f32::max) as f64;
                    (min, max)
                })
        };

        match (self.minimum, self.maximum) {
            (Some(min), Some(max)) => (min as f64, max as f64),
            (None, None) => values_range().unwrap_or((self.default as f64, self.default as f64)),
            (Some(min), None) => (min as f64, self.default as f64),
            (None, Some(max)) => (self.default as f64, max as f64),
        }
    }

    fn variation_kind(&self) -> VariationAxisKind {
        if let Some(values) = &self.values {
            let mut values = values
                .iter()
                .map(|value| f64::from(*value))
                .collect::<Vec<_>>();
            values.sort_by(f64::total_cmp);
            values.dedup();
            return VariationAxisKind::Discrete {
                values: values.into_boxed_slice(),
                default: f64::from(self.default),
            };
        }

        let (minimum, maximum) = self.user_range();
        VariationAxisKind::Continuous {
            minimum,
            default: f64::from(self.default),
            maximum,
        }
    }

    // Designspace source locations are partial design-space locations. Missing
    // dimensions resolve to the axis default after mapping from user space.
    // https://fonttools.readthedocs.io/en/stable/designspaceLib/python.html#fontTools.designspaceLib.SourceDescriptor.getFullDesignLocation
    fn design_value_in(&self, dimensions: &[Dimension]) -> f64 {
        let dimension = dimensions
            .iter()
            .find(|dimension| dimension.name == self.name);

        match dimension {
            Some(dimension) => match (dimension.xvalue, dimension.uservalue) {
                (Some(value), _) => value as f64,
                (None, Some(value)) => self.map_forward(value as f64),
                (None, None) => self.default_design_value(),
            },
            None => self.default_design_value(),
        }
    }

    fn default_design_value(&self) -> f64 {
        self.map_forward(f64::from(self.default))
    }
}

impl DesignspaceDocumentExt for DesignSpaceDocument {
    // This mirrors designspaceLib's findDefault semantics: compare complete
    // design-space locations to the mapped user-space defaults. Layer-backed
    // sources remain eligible because `layer` describes storage, not source role.
    // https://fonttools.readthedocs.io/en/stable/designspaceLib/python.html#fontTools.designspaceLib.DesignSpaceDocument.findDefault
    fn default_source_index(&self) -> Option<usize> {
        self.sources.iter().position(|source| {
            self.axes.iter().all(|axis| {
                let source_value = axis.design_value_in(&source.location);
                let default_value = axis.default_design_value();
                design_values_equal(source_value, default_value)
            })
        })
    }
}

fn design_values_equal(left: f64, right: f64) -> bool {
    let scale = left.abs().max(right.abs()).max(1.0);
    (left - right).abs() <= f64::from(f32::EPSILON) * scale * 4.0
}
