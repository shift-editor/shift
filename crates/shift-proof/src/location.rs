//! Variation locations a proof is set at, and how they resolve against a
//! compiled font's `fvar` and `avar`.

use std::collections::HashSet;
use std::fmt;
use std::str::FromStr;

use serde::Serialize;
use skrifa::instance::{Location, NormalizedCoord};
use skrifa::raw::TableProvider;
use skrifa::{FontRef, MetadataProvider};

use crate::ProofError;

/// One axis coordinate, such as `wght=700`.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AxisValue {
    /// Four-character `fvar` axis tag.
    pub tag: String,
    /// User-space value, or a normalized value inside
    /// [`Coordinates::Normalized`].
    pub value: f32,
}

impl FromStr for AxisValue {
    type Err = ProofError;

    /// Parses `TAG=VALUE`, trimming whitespace around both parts.
    ///
    /// The tag is not checked against any font here.
    fn from_str(setting: &str) -> Result<Self, Self::Err> {
        let Some((tag, value)) = setting.split_once('=') else {
            return Err(ProofError::InvalidLocation {
                setting: setting.to_string(),
            });
        };
        let tag = tag.trim().to_string();
        let parsed = value
            .trim()
            .parse::<f32>()
            .ok()
            .filter(|value| value.is_finite());
        match parsed {
            Some(value) => Ok(Self { tag, value }),
            None => Err(ProofError::InvalidAxisValue {
                tag,
                value: value.to_string(),
            }),
        }
    }
}

impl fmt::Display for AxisValue {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}={}", self.tag, self.value)
    }
}

/// Axis coordinates of one location; axes not named stay at their defaults.
#[derive(Clone, Debug, PartialEq)]
pub enum Coordinates {
    /// User-space values, mapped through `avar` like any application does.
    User(Vec<AxisValue>),
    /// Normalized values in `-1..=1` after `avar`, as variation data stores
    /// them. Use this for locations known in design space, such as masters:
    /// normalize the design value by the axis's design extrema.
    Normalized(Vec<AxisValue>),
}

impl Default for Coordinates {
    fn default() -> Self {
        Self::User(Vec::new())
    }
}

/// A location to set a proof at, with an optional label.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProofLocation {
    /// Name shown next to rows set here, such as an instance or master name;
    /// without one the user-space coordinates are shown.
    pub label: Option<String>,
    pub coordinates: Coordinates,
}

impl ProofLocation {
    /// An unlabelled user-space location.
    pub fn user(values: Vec<AxisValue>) -> Self {
        Self {
            label: None,
            coordinates: Coordinates::User(values),
        }
    }

    /// The label shown in the proof: the given label, else the named
    /// coordinates as `wght 300 wdth 75`, else `default`.
    pub fn display_label(&self) -> String {
        if let Some(label) = &self.label {
            return label.clone();
        }
        let Coordinates::User(values) = &self.coordinates else {
            return "normalized".to_string();
        };
        if values.is_empty() {
            return "default".to_string();
        }
        values
            .iter()
            .map(|axis| format!("{} {}", axis.tag, axis.value))
            .collect::<Vec<_>>()
            .join(" ")
    }
}

/// Every named instance in `fvar`, labelled with its subfamily name.
///
/// # Errors
///
/// Returns [`ProofError::UnreadableFont`] when the bytes are not a font.
pub fn named_instances(font_data: &[u8]) -> Result<Vec<ProofLocation>, ProofError> {
    let font = FontRef::new(font_data).map_err(ProofError::UnreadableFont)?;
    let tags: Vec<String> = font
        .axes()
        .iter()
        .map(|axis| axis.tag().to_string())
        .collect();
    Ok(font
        .named_instances()
        .iter()
        .map(|instance| {
            let name = font
                .localized_strings(instance.subfamily_name_id())
                .english_or_first()
                .map(|name| name.to_string());
            let values = tags
                .iter()
                .zip(instance.user_coords())
                .map(|(tag, value)| AxisValue {
                    tag: tag.clone(),
                    value,
                })
                .collect();
            ProofLocation {
                label: name,
                coordinates: Coordinates::User(values),
            }
        })
        .collect())
}

/// A location resolved against one font.
pub(crate) struct ResolvedLocation {
    /// Normalized coordinates after `avar`, one per `fvar` axis.
    pub location: Location,
    /// Every axis in `fvar` order at its user-space value.
    pub axes: Vec<AxisValue>,
}

/// Resolves `coordinates` against `font`'s axes.
pub(crate) fn resolve(
    font: &FontRef,
    coordinates: &Coordinates,
) -> Result<ResolvedLocation, ProofError> {
    match coordinates {
        Coordinates::User(values) => resolve_user(font, values),
        Coordinates::Normalized(values) => resolve_normalized(font, values),
    }
}

fn resolve_user(font: &FontRef, settings: &[AxisValue]) -> Result<ResolvedLocation, ProofError> {
    let axes: Vec<_> = font.axes().iter().collect();
    let mut values: Vec<AxisValue> = axes
        .iter()
        .map(|axis| AxisValue {
            tag: axis.tag().to_string(),
            value: axis.default_value(),
        })
        .collect();
    for (index, setting) in validated(&values, settings)? {
        let axis = &axes[index];
        if setting.value < axis.min_value() || setting.value > axis.max_value() {
            return Err(ProofError::AxisOutOfRange {
                tag: setting.tag.clone(),
                value: setting.value,
                min: axis.min_value(),
                max: axis.max_value(),
            });
        }
        values[index].value = setting.value;
    }

    let location = font
        .axes()
        .location(values.iter().map(|axis| (axis.tag.as_str(), axis.value)));
    Ok(ResolvedLocation {
        location,
        axes: values,
    })
}

fn resolve_normalized(
    font: &FontRef,
    settings: &[AxisValue],
) -> Result<ResolvedLocation, ProofError> {
    let axes: Vec<_> = font.axes().iter().collect();
    let defaults: Vec<AxisValue> = axes
        .iter()
        .map(|axis| AxisValue {
            tag: axis.tag().to_string(),
            value: axis.default_value(),
        })
        .collect();
    let mut location = Location::new(axes.len());
    for (index, setting) in validated(&defaults, settings)? {
        if !(-1.0..=1.0).contains(&setting.value) {
            return Err(ProofError::AxisOutOfRange {
                tag: setting.tag.clone(),
                value: setting.value,
                min: -1.0,
                max: 1.0,
            });
        }
        location.coords_mut()[index] = NormalizedCoord::from_f32(setting.value);
    }

    let values = axes
        .iter()
        .enumerate()
        .map(|(index, axis)| {
            let normalized = location.coords()[index].to_f32();
            let user_normalized = unmap_avar(font, index, normalized);
            let value = if user_normalized < 0.0 {
                axis.default_value() + user_normalized * (axis.default_value() - axis.min_value())
            } else {
                axis.default_value() + user_normalized * (axis.max_value() - axis.default_value())
            };
            AxisValue {
                tag: axis.tag().to_string(),
                // `avar` stores its points as F2Dot14, so the inverse is only
                // good to about a hundredth of a unit.
                value: (value * 10.0).round() / 10.0,
            }
        })
        .collect();
    Ok(ResolvedLocation {
        location,
        axes: values,
    })
}

// Pairs each setting with its axis index, rejecting blank, repeated, and
// unknown tags.
fn validated<'s>(
    axes: &[AxisValue],
    settings: &'s [AxisValue],
) -> Result<Vec<(usize, &'s AxisValue)>, ProofError> {
    let mut seen = HashSet::new();
    settings
        .iter()
        .map(|setting| {
            let tag = setting.tag.as_str();
            if tag.is_empty() || !seen.insert(tag) {
                return Err(ProofError::RepeatedAxis {
                    tag: tag.to_string(),
                });
            }
            let index = axes
                .iter()
                .position(|axis| axis.tag == tag)
                .ok_or_else(|| ProofError::UnknownAxis {
                    tag: tag.to_string(),
                    available: axes
                        .iter()
                        .map(|axis| axis.tag.as_str())
                        .collect::<Vec<_>>()
                        .join(", "),
                })?;
            Ok((index, setting))
        })
        .collect()
}

// Inverts the `avar` segment map of one axis, taking a normalized value
// after `avar` back to the normalized user value before it. `avar` version 2
// cross-axis deltas are not inverted.
fn unmap_avar(font: &FontRef, axis_index: usize, normalized: f32) -> f32 {
    let Ok(avar) = font.avar() else {
        return normalized;
    };
    let Some(Ok(map)) = avar.axis_segment_maps().iter().nth(axis_index) else {
        return normalized;
    };
    let points: Vec<(f32, f32)> = map
        .axis_value_maps()
        .iter()
        .map(|point| {
            (
                point.from_coordinate().to_f32(),
                point.to_coordinate().to_f32(),
            )
        })
        .collect();
    for pair in points.windows(2) {
        let ((from_start, to_start), (from_end, to_end)) = (pair[0], pair[1]);
        if normalized < to_start || normalized > to_end {
            continue;
        }
        if to_end == to_start {
            return from_start;
        }
        return from_start
            + (normalized - to_start) * (from_end - from_start) / (to_end - to_start);
    }
    normalized
}
