//! Axes a single glyph varies along, on top of the font's axes.
//!
//! A glyph with axes of its own, such as a `dot` with Spread and Strike, is
//! drawn anywhere in a design space made of the font's axes plus its own:
//! [`Font::glyph_space_axes`](crate::Font::glyph_space_axes). A component sets
//! a value on one of its base glyph's axes through the same
//! [`Component::location`](crate::Component::location) it uses for font axes,
//! because glyph axis ids share the [`AxisId`] namespace with font axes.
//!
//! Every value on a glyph axis is stored in the axis's own units, never
//! normalized: layer coordinates and component locations alike.

use serde::{Deserialize, Serialize};

use crate::CoreError;
use crate::axis::Axis;
use crate::entity::{AxisId, ComponentId, GlyphId, LayerId};
use crate::variation::AxisRange;

/// An axis only one glyph varies along.
///
/// Its id is unique among the font's axes and every glyph's axes, and so is
/// its [tag](Self::tag): export writes each glyph axis as a hidden `fvar` axis.
/// A glyph axis is always continuous, and is never inherited by the glyphs its
/// glyph is placed in: a component that doesn't set it draws its base at the
/// axis default.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(from = "StoredGlyphAxis", into = "StoredGlyphAxis")]
pub struct GlyphAxis {
    axis: Axis,
}

/// A glyph axis as it is written: everything else about it is fixed.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct StoredGlyphAxis {
    id: AxisId,
    tag: String,
    name: String,
    minimum: f64,
    default: f64,
    maximum: f64,
}

impl From<StoredGlyphAxis> for GlyphAxis {
    fn from(stored: StoredGlyphAxis) -> Self {
        let StoredGlyphAxis {
            id,
            tag,
            name,
            minimum,
            default,
            maximum,
        } = stored;
        Self::with_id(id, tag, name, minimum, default, maximum)
    }
}

impl From<GlyphAxis> for StoredGlyphAxis {
    fn from(axis: GlyphAxis) -> Self {
        Self {
            id: axis.id(),
            tag: axis.tag().to_string(),
            name: axis.name().to_string(),
            minimum: axis.minimum(),
            default: axis.as_axis().default(),
            maximum: axis.maximum(),
        }
    }
}

impl GlyphAxis {
    /// An axis with a fresh id and no tag yet; adding it to a glyph with
    /// [`Font::add_glyph_axis`](crate::Font::add_glyph_axis) assigns one.
    pub fn new(name: impl Into<String>, minimum: f64, default: f64, maximum: f64) -> Self {
        Self::with_id(AxisId::new(), "", name, minimum, default, maximum)
    }

    /// An axis with a known id and tag, such as one read back from storage.
    pub fn with_id(
        id: AxisId,
        tag: impl Into<String>,
        name: impl Into<String>,
        minimum: f64,
        default: f64,
        maximum: f64,
    ) -> Self {
        let mut axis =
            Axis::continuous_with_id(id, tag.into(), name.into(), minimum, default, maximum);
        axis.set_hidden(true);
        Self { axis }
    }

    pub fn id(&self) -> AxisId {
        self.axis.id()
    }

    /// The four-character tag; empty until the axis is added to a font.
    pub fn tag(&self) -> &str {
        self.axis.tag()
    }

    pub fn name(&self) -> &str {
        self.axis.name()
    }

    pub fn minimum(&self) -> f64 {
        self.axis.minimum()
    }

    pub fn maximum(&self) -> f64 {
        self.axis.maximum()
    }

    /// The axis as one of a design space's axes: hidden, continuous, with this
    /// axis's id, tag and range.
    pub fn as_axis(&self) -> &Axis {
        &self.axis
    }

    pub(crate) fn with_tag(mut self, tag: String) -> Self {
        self.axis.set_tag(tag);
        self
    }

    pub(crate) fn with_name(&self, name: String) -> Self {
        let mut axis = self.clone();
        axis.axis.set_name(name);
        axis
    }

    pub(crate) fn with_range(&self, range: AxisRange) -> Self {
        Self::with_id(
            self.id(),
            self.tag(),
            self.name(),
            range.minimum,
            range.default,
            range.maximum,
        )
    }

    /// Whether `value` lies inside the axis range.
    pub fn contains(&self, value: f64) -> bool {
        self.minimum() <= value && value <= self.maximum()
    }
}

/// An edit to an existing glyph axis, applied with
/// [`Font::edit_glyph_axis`](crate::Font::edit_glyph_axis).
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "pack", derive(pack::Pack))]
pub enum GlyphAxisEdit {
    /// Gives the axis a new name; its tag stays.
    Name(String),
    /// Gives the axis a new tag.
    Tag(String),
    /// Gives the axis a new range; every stored value stays where it is.
    Range(AxisRange),
    /// Gives the axis a new range and moves every stored value with it.
    Rescale(AxisRange),
    /// Removes the axis.
    Remove,
}

/// A private tag for an axis named `name`, deterministic for a given set of
/// tags already `taken`: the name's first letter and the consonants after it,
/// uppercase (`Spread` is `SPRD`, `Strike` is `STRK`), padded with its other
/// letters and then `X`, with trailing digits replacing letters until the
/// tag is free. Uppercase marks the tag as private in OpenType.
pub(crate) fn private_tag(name: &str, taken: impl Fn(&str) -> bool) -> String {
    let letters: Vec<char> = name
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|letter| letter.to_ascii_uppercase())
        .collect();
    let mut chosen: Vec<char> = Vec::with_capacity(4);
    let mut rest = Vec::new();
    for (index, letter) in letters.iter().enumerate() {
        let vowel = matches!(letter, 'A' | 'E' | 'I' | 'O' | 'U');
        if index == 0 || !vowel {
            chosen.push(*letter);
        } else {
            rest.push(*letter);
        }
    }
    chosen.extend(rest);
    chosen.truncate(4);
    while chosen.len() < 4 {
        chosen.push('X');
    }
    if let Some(first) = chosen.first_mut()
        && !first.is_ascii_alphabetic()
    {
        *first = 'X';
    }

    let base: String = chosen.iter().collect();
    if !taken(&base) {
        return base;
    }
    for (width, count) in [(1, 10), (2, 100), (3, 1000)] {
        let stem: String = chosen.iter().take(4 - width).collect();
        for suffix in 0..count {
            let candidate = format!("{stem}{suffix:0width$}");
            if !taken(&candidate) {
                return candidate;
            }
        }
    }
    base
}

/// One value stored on a glyph axis: a drawing's coordinate, or a component's
/// location for its base glyph. Errors that refuse an axis edit list these.
#[derive(Clone, Debug, PartialEq)]
pub enum AxisValueUse {
    /// A drawing of the axis's glyph sits at `value` on the axis.
    Layer {
        glyph_id: GlyphId,
        layer_id: LayerId,
        value: f64,
    },
    /// A component draws the axis's glyph at `value` on the axis.
    Component {
        glyph_id: GlyphId,
        layer_id: LayerId,
        component_id: ComponentId,
        value: f64,
    },
}

impl AxisValueUse {
    /// The stored value.
    pub fn value(&self) -> f64 {
        match self {
            Self::Layer { value, .. } | Self::Component { value, .. } => *value,
        }
    }
}

/// The error for an edit that would leave `uses` outside the axis range.
pub(crate) fn values_outside_range(axis_id: AxisId, uses: Vec<AxisValueUse>) -> CoreError {
    CoreError::AxisValuesOutsideRange { axis_id, uses }
}

/// Maps `value` from `from` to `to` piecewise-linearly on each side of the
/// default: `from`'s minimum, default and maximum land on `to`'s. A value on
/// a side with no extent lands on the new default.
pub(crate) fn rescale_value(value: f64, from: AxisRange, to: AxisRange) -> f64 {
    let (old_edge, new_edge) = if value < from.default {
        (from.minimum, to.minimum)
    } else {
        (from.maximum, to.maximum)
    };
    let span = old_edge - from.default;
    if span == 0.0 {
        return to.default;
    }
    to.default + (value - from.default) / span * (new_edge - to.default)
}
