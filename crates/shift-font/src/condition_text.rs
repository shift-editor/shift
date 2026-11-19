//! Conditions as text: the chips the editor shows and the command line's
//! `--when`, one range per text.
//!
//! A range is an axis, by name or tag, then a value:
//!
//! | Text                                   | Range               |
//! | -------------------------------------- | ------------------- |
//! | `700`, `>=700`, `≥700`, `700+`         | 700 and above       |
//! | `<=80`, `≤80`                          | 80 and below        |
//! | `400-600`, `400–600`                   | 400 to 600          |
//!
//! Ends are inclusive. Spaces around the operator are optional: `wght>=700`,
//! `Weight ≥ 700` and `Weight 700+` are the same range. Without an
//! operator the axis and the value are separated by a space (`Weight
//! 400–600`).
//!
//! Values are in **user units** on a font axis users see (an external axis),
//! as the editor's Font axes and location controls show them, and are mapped
//! through the font's axis mappings into the design units a [`Condition`]
//! stores. An internal axis is written in design units, and a glyph's own
//! axis in its own units, since neither has a mapping. Formatting runs the
//! other way, so a formatted range parses back to the same range.

use thiserror::Error;

use crate::axis::{Axis, AxisRole, DesignLocation, ExternalLocation};
use crate::condition::{Condition, ConditionRange};
use crate::entity::{AxisId, GlyphId};
use crate::error::{CoreError, CoreResult};
use crate::ir::{Font, GlyphAxis};
use crate::variation::{AxisMappingBasis, map_location_with_bases, unmap_location_with_bases};

/// Why a condition's text can't be read.
#[derive(Debug, Error)]
pub enum ConditionTextError {
    #[error(
        "{0:?} has no value; write the axis and then a value such as 700, >=700, <=80 or 400-600"
    )]
    MissingValue(String),

    #[error("{0:?} names no axis; write the axis and then a value, such as wght>=700")]
    MissingAxis(String),

    #[error("no axis is named or tagged {0:?}")]
    UnknownAxis(String),

    #[error("{0:?} is not a value; write 700, >=700, 700+, <=80 or 400-600")]
    InvalidValue(String),

    #[error("the range {min} to {max} runs downwards")]
    Reversed { min: f64, max: f64 },

    #[error(transparent)]
    Font(#[from] CoreError),
}

/// A range's ends as written, before they are placed on an axis. `None` on
/// a side leaves it open.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ValueRange {
    /// The lowest value the range holds at.
    pub from: Option<f64>,
    /// The highest value the range holds at.
    pub up_to: Option<f64>,
}

impl ValueRange {
    /// Reads a chip's value: `700`, `>=700`, `≥700` or `700+` (from 700),
    /// `<=80` or `≤80` (up to 80), `400-600` or `400–600` (both ends).
    ///
    /// # Errors
    ///
    /// Returns [`ConditionTextError::InvalidValue`] for text that is none of
    /// these, and [`ConditionTextError::Reversed`] for a range whose first
    /// end is above its second.
    pub fn parse(text: &str) -> Result<Self, ConditionTextError> {
        let compact: String = text.chars().filter(|c| !c.is_whitespace()).collect();
        let invalid = || ConditionTextError::InvalidValue(text.trim().to_string());
        let number = |value: &str| parse_number(value).ok_or_else(invalid);

        let from = |min| Self {
            from: Some(min),
            up_to: None,
        };
        let up_to = |max| Self {
            from: None,
            up_to: Some(max),
        };
        if let Some(rest) = compact
            .strip_prefix(">=")
            .or_else(|| compact.strip_prefix('≥'))
        {
            return Ok(from(number(rest)?));
        }
        if let Some(rest) = compact
            .strip_prefix("<=")
            .or_else(|| compact.strip_prefix('≤'))
        {
            return Ok(up_to(number(rest)?));
        }
        if let Some(rest) = compact.strip_suffix('+') {
            return Ok(from(number(rest)?));
        }
        if let Some(value) = parse_number(&compact) {
            return Ok(from(value));
        }
        let range = Self::both_ends(&compact).ok_or_else(invalid)?;
        if let Self {
            from: Some(min),
            up_to: Some(max),
        } = range
            && min > max
        {
            return Err(ConditionTextError::Reversed { min, max });
        }
        Ok(range)
    }

    /// The two ends of `400-600` or `400–600`: split at the first dash that
    /// follows a digit or a point, so a negative first end keeps its sign.
    fn both_ends(text: &str) -> Option<Self> {
        let mut previous = None;
        for (index, c) in text.char_indices() {
            let after_number = previous.is_some_and(|p: char| p.is_ascii_digit() || p == '.');
            if after_number && matches!(c, '-' | '–' | '—') {
                let (min, rest) = text.split_at(index);
                return Some(Self {
                    from: Some(parse_number(min)?),
                    up_to: Some(parse_number(rest.strip_prefix(c)?)?),
                });
            }
            previous = Some(c);
        }
        None
    }
}

/// A number, with `-` or `−` for a minus sign.
fn parse_number(text: &str) -> Option<f64> {
    let text = text.replace('−', "-");
    let starts_like_a_number = text
        .trim_start_matches('-')
        .starts_with(|c: char| c.is_ascii_digit() || c == '.');
    if !starts_like_a_number {
        return None;
    }
    text.parse::<f64>().ok().filter(|value| value.is_finite())
}

/// How [`ConditionSpace::format_range`] names an axis.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AxisNaming {
    /// Its name, `Weight`, as the editor's chips show it.
    Name,
    /// Its tag, `wght`, as files and scripts write it.
    Tag,
}

/// The axes a condition can be written on, and how their user units map to
/// design units: the font's axes and, for a component's condition, the axes
/// of the glyph it is placed in.
pub struct ConditionSpace<'a> {
    font: &'a Font,
    glyph_id: Option<GlyphId>,
    bases: Vec<AxisMappingBasis>,
    /// Where every font axis is at its default, in design units.
    design_defaults: DesignLocation,
}

impl Font {
    /// The axes conditions on `glyph_id` are written on: font axes and, with
    /// a glyph, its own axes. A glyph's swaps read font axes only; the
    /// font refuses a glyph axis there when the condition is set.
    ///
    /// # Errors
    ///
    /// Returns an axis-mapping error when an authored mapping cannot compile.
    pub fn condition_space(&self, glyph_id: Option<GlyphId>) -> CoreResult<ConditionSpace<'_>> {
        let bases = self.axis_mapping_bases()?;
        let defaults = ExternalLocation::at_defaults(self.axes());
        let design_defaults = map_location_with_bases(&defaults, self.axes(), &bases)?;
        Ok(ConditionSpace {
            font: self,
            glyph_id,
            bases,
            design_defaults,
        })
    }
}

/// An axis a condition text named, and whether it is written in user units.
struct NamedAxis<'a> {
    axis: &'a Axis,
    user_units: bool,
}

impl<'a> ConditionSpace<'a> {
    /// The font whose axes the space reads.
    pub fn font(&self) -> &'a Font {
        self.font
    }

    /// Reads one range, such as `wght>=700` or `Weight 400–600`, into design
    /// units.
    ///
    /// The axis is a font axis or one of the glyph's own axes, by tag or by
    /// name (ignoring case). Another glyph's axis is found by tag too, so the
    /// font can refuse it with its own reason when the condition is set.
    ///
    /// # Errors
    ///
    /// Returns [`ConditionTextError::MissingAxis`] or
    /// [`ConditionTextError::MissingValue`] when a part is missing,
    /// [`ConditionTextError::UnknownAxis`] for an axis no glyph has, and the
    /// errors of [`ValueRange::parse`].
    pub fn parse_range(&self, text: &str) -> Result<ConditionRange, ConditionTextError> {
        let RangeText {
            axis_text: axis,
            value_text: value,
        } = RangeText::split(text)?;
        let named = self
            .axis_named(axis)
            .ok_or_else(|| ConditionTextError::UnknownAxis(axis.to_string()))?;
        let ValueRange {
            from: min,
            up_to: max,
        } = ValueRange::parse(value)?;
        let axis = named.axis;
        if !named.user_units {
            return Ok(ConditionRange::new(axis.id(), min, max));
        }
        let to_design = |value| self.to_design(axis, value);
        let (min, max) = (
            min.map(to_design).transpose()?,
            max.map(to_design).transpose()?,
        );
        // A mapping that runs downwards turns "from" into "up to".
        let (min, max) = if self.decreasing(axis)? {
            (max, min)
        } else {
            (min, max)
        };
        Ok(ConditionRange::new(axis.id(), min, max))
    }

    /// Reads every range of a condition; see [`Self::parse_range`]. No
    /// ranges make the condition that always holds.
    ///
    /// # Errors
    ///
    /// As [`Self::parse_range`], for the first range that fails.
    pub fn parse<'t>(
        &self,
        texts: impl IntoIterator<Item = &'t str>,
    ) -> Result<Condition, ConditionTextError> {
        let ranges = texts
            .into_iter()
            .map(|text| self.parse_range(text))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Condition::all(ranges))
    }

    /// Writes one range as [`Self::parse_range`] reads it, in user units on
    /// a user-facing font axis: `Weight ≥ 700`, `Weight ≤ 80` or `Weight
    /// 400–600`. A range open on both sides is written `Weight ≥` its
    /// axis's minimum. An axis the font no longer has is written by its id.
    pub fn format_range(&self, range: &ConditionRange, label: AxisNaming) -> String {
        let Some(named) = self.axis_by_id(range.axis_id) else {
            return format_ends(&range.axis_id.to_string(), range.min, range.max);
        };
        let axis = named.axis;
        let name = match label {
            AxisNaming::Name => axis.name(),
            AxisNaming::Tag => axis.tag(),
        };
        let (mut min, mut max) = (range.min, range.max);
        if named.user_units {
            let to_user = |value| self.to_user(axis, value);
            (min, max) = (min.map(to_user), max.map(to_user));
            if self.decreasing(axis).unwrap_or(false) {
                (min, max) = (max, min);
            }
        }
        if min.is_none() && max.is_none() {
            min = Some(axis.minimum());
        }
        format_ends(name, min, max)
    }

    /// Writes every range of `condition`, one text each; see
    /// [`Self::format_range`].
    pub fn format(&self, condition: &Condition, label: AxisNaming) -> Vec<String> {
        condition
            .ranges()
            .iter()
            .map(|range| self.format_range(range, label))
            .collect()
    }

    fn axis_named(&self, text: &str) -> Option<NamedAxis<'_>> {
        let font = self.font;
        let matches = |axis: &&Axis| axis.tag() == text || axis.name().eq_ignore_ascii_case(text);
        if let Some(axis) = font.axes().iter().find(matches) {
            return Some(NamedAxis {
                axis,
                user_units: axis.role() == AxisRole::External,
            });
        }
        let own = self
            .glyph_id
            .and_then(|glyph_id| font.glyph(glyph_id))
            .and_then(|glyph| glyph.axes().iter().map(GlyphAxis::as_axis).find(matches));
        let axis = own.or_else(|| {
            let axis_id = font.glyph_axis_id_by_tag(text)?;
            Some(font.glyph_axis(axis_id)?.as_axis())
        })?;
        Some(NamedAxis {
            axis,
            user_units: false,
        })
    }

    fn axis_by_id(&self, axis_id: AxisId) -> Option<NamedAxis<'_>> {
        if let Some(axis) = self.font.axis(axis_id) {
            return Some(NamedAxis {
                axis,
                user_units: axis.role() == AxisRole::External,
            });
        }
        Some(NamedAxis {
            axis: self.font.glyph_axis(axis_id)?.as_axis(),
            user_units: false,
        })
    }

    /// The design value `user` on `axis` maps to, every other axis at its
    /// default.
    fn to_design(&self, axis: &Axis, user: f64) -> CoreResult<f64> {
        let mut external = ExternalLocation::at_defaults(self.font.axes());
        external.set(axis.id(), user);
        let design = map_location_with_bases(&external, self.font.axes(), &self.bases)?;
        Ok(design.value_on(axis))
    }

    /// The user value whose mapping reaches `design` on `axis`.
    fn to_user(&self, axis: &Axis, design: f64) -> f64 {
        let mut location = self.design_defaults.clone();
        location.set(axis.id(), design);
        unmap_location_with_bases(&location, self.font.axes(), &self.bases).value_on(axis)
    }

    /// Whether `axis`'s mapping takes higher user values to lower design
    /// values.
    fn decreasing(&self, axis: &Axis) -> CoreResult<bool> {
        Ok(self.to_design(axis, axis.maximum())? < self.to_design(axis, axis.minimum())?)
    }
}

/// One range's text, split into its axis and its value.
struct RangeText<'t> {
    axis_text: &'t str,
    value_text: &'t str,
}

impl<'t> RangeText<'t> {
    /// Splits `wght>=700`, `Weight ≥ 700` or `Weight 400–600` before the
    /// first operator, else at the last space.
    fn split(text: &'t str) -> Result<Self, ConditionTextError> {
        let text = text.trim();
        let operator = text.find(['>', '<', '≥', '≤']);
        let split = operator.or_else(|| text.rfind(char::is_whitespace));
        let Some(index) = split else {
            return Err(ConditionTextError::MissingValue(text.to_string()));
        };
        let (axis, value) = text.split_at(index);
        let (axis, value) = (axis.trim(), value.trim());
        if axis.is_empty() {
            return Err(ConditionTextError::MissingAxis(text.to_string()));
        }
        if value.is_empty() {
            return Err(ConditionTextError::MissingValue(text.to_string()));
        }
        Ok(Self {
            axis_text: axis,
            value_text: value,
        })
    }
}

fn format_ends(name: &str, min: Option<f64>, max: Option<f64>) -> String {
    match (min, max) {
        (Some(min), Some(max)) => format!("{name} {}–{}", number(min), number(max)),
        (Some(min), None) => format!("{name} ≥ {}", number(min)),
        (None, Some(max)) => format!("{name} ≤ {}", number(max)),
        (None, None) => name.to_string(),
    }
}

/// A value as a person writes it: no trailing zeros, at most three
/// decimals.
fn number(value: f64) -> String {
    let rounded = (value * 1000.0).round() / 1000.0;
    let text = format!("{rounded}");
    if text == "-0" { "0".to_string() } else { text }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::axis::AxisMapping;
    use crate::test_support::conditions_font;
    use crate::{AxisMappingPoint, GlyphAxis};

    fn value(text: &str) -> ValueRange {
        ValueRange::parse(text).unwrap()
    }

    fn ends(from: Option<f64>, up_to: Option<f64>) -> ValueRange {
        ValueRange { from, up_to }
    }

    #[test]
    fn a_chip_value_reads_as_a_minimum_a_maximum_or_both() {
        for text in ["700", ">=700", "≥700", "700+", ">= 700", "≥ 700"] {
            assert_eq!(value(text), ends(Some(700.0), None), "{text}");
        }
        for text in ["<=80", "≤80", "≤ 80"] {
            assert_eq!(value(text), ends(None, Some(80.0)), "{text}");
        }
        for text in ["400-600", "400–600", "400 – 600"] {
            assert_eq!(value(text), ends(Some(400.0), Some(600.0)), "{text}");
        }
        assert_eq!(value("-20--10"), ends(Some(-20.0), Some(-10.0)));
        assert_eq!(value("−5"), ends(Some(-5.0), None));
    }

    #[test]
    fn a_value_that_is_not_one_of_the_forms_is_refused() {
        for text in ["", "heavy", ">=", "700++", "4-5-6", "NaN", "inf"] {
            assert!(
                matches!(
                    ValueRange::parse(text),
                    Err(ConditionTextError::InvalidValue(_))
                ),
                "{text}"
            );
        }
        assert!(matches!(
            ValueRange::parse("600-400"),
            Err(ConditionTextError::Reversed {
                min: 600.0,
                max: 400.0
            })
        ));
    }

    #[test]
    fn a_range_names_its_axis_by_tag_or_name_with_or_without_spaces() {
        let font = conditions_font();
        let space = font.condition_space(None).unwrap();
        let weight = font.axis_id_by_tag("wght").unwrap();
        let from_700 = ConditionRange::new(weight, Some(700.0), None);

        for text in ["wght>=700", "Weight ≥ 700", "weight 700+", "wght 700"] {
            assert_eq!(space.parse_range(text).unwrap(), from_700, "{text}");
        }
    }

    #[test]
    fn a_range_without_an_axis_or_a_value_or_on_no_axis_is_refused() {
        let font = conditions_font();
        let space = font.condition_space(None).unwrap();

        assert!(matches!(
            space.parse_range(">=700"),
            Err(ConditionTextError::MissingAxis(_))
        ));
        assert!(matches!(
            space.parse_range("wght"),
            Err(ConditionTextError::MissingValue(_))
        ));
        assert!(matches!(
            space.parse_range("opsz>=12"),
            Err(ConditionTextError::UnknownAxis(axis)) if axis == "opsz"
        ));
    }

    #[test]
    fn a_glyph_axis_is_found_in_the_glyphs_space_by_name_and_anywhere_by_tag() {
        let font = conditions_font();
        let h = GlyphId::from_raw("H");
        let crossbar = AxisId::from_raw("crossbar");
        let in_h = font.condition_space(Some(h)).unwrap();
        let anywhere = font.condition_space(None).unwrap();

        assert_eq!(
            in_h.parse_range("Crossbar 70").unwrap(),
            ConditionRange::new(crossbar, Some(70.0), None)
        );
        assert_eq!(anywhere.parse_range("CRSB<=30").unwrap().axis_id, crossbar);
        assert!(matches!(
            anywhere.parse_range("Crossbar 70"),
            Err(ConditionTextError::UnknownAxis(_))
        ));
    }

    #[test]
    fn formatted_ranges_read_back_as_the_same_range() {
        let mut font = conditions_font();
        font.add_glyph_axis(
            GlyphId::from_raw("H"),
            GlyphAxis::new("Stroke", -50.0, 0.0, 50.0),
        )
        .unwrap();
        let space = font.condition_space(Some(GlyphId::from_raw("H"))).unwrap();
        let ranges = [
            "wght>=700",
            "wdth<=80",
            "Weight 400-600",
            "Stroke -20--10",
            "wght 650.5",
        ]
        .map(|text| space.parse_range(text).unwrap());

        let names = ranges.map(|range| space.format_range(&range, AxisNaming::Name));
        let tags = ranges.map(|range| space.format_range(&range, AxisNaming::Tag));

        assert_eq!(
            names,
            [
                "Weight ≥ 700",
                "Width ≤ 80",
                "Weight 400–600",
                "Stroke -20–-10",
                "Weight ≥ 650.5"
            ]
        );
        for text in names.iter().chain(&tags) {
            let range = space.parse_range(text).unwrap();
            assert!(ranges.contains(&range), "{text} reads back as {range:?}");
        }
    }

    /// `conditions_font` with Weight's user 100–900 mapped onto design
    /// 20–220 (user 400 at design 80).
    fn mapped_weight_font() -> Font {
        let mut font = conditions_font();
        let weight = font.axis_id_by_tag("wght").unwrap();
        let point = |user, design| AxisMappingPoint {
            description: None,
            input: [(weight, user)].into_iter().collect(),
            output: [(weight, design)].into_iter().collect(),
        };
        let mapping = AxisMapping::new(
            "Weight".into(),
            vec![weight],
            vec![weight],
            vec![point(100.0, 20.0), point(400.0, 80.0), point(900.0, 220.0)],
        );
        font.set_axis_mappings(vec![mapping]).unwrap();
        font
    }

    #[test]
    fn user_values_on_a_mapped_axis_are_stored_in_design_units() {
        let font = mapped_weight_font();
        let space = font.condition_space(None).unwrap();
        let weight = font.axis_id_by_tag("wght").unwrap();

        let range = space.parse_range("Weight 400–900").unwrap();

        assert_eq!(range, ConditionRange::new(weight, Some(80.0), Some(220.0)));
        assert_eq!(
            space.format_range(&range, AxisNaming::Name),
            "Weight 400–900"
        );
    }
}
