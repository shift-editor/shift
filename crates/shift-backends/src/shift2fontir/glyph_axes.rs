//! Glyph axes as the compiler sees them: hidden axes shared across glyphs
//! by position.
//!
//! A glyph's own axes (`dot`'s Spread and Strike) compile to fontir glyph
//! axes, tagged by their position in the glyph: its first axis is `V000`, its
//! second `V001`, and so on, in [`Glyph::axes`] order. Every glyph reuses the
//! same tags, as Fontra does, so a font needs only as many hidden axes as its
//! glyph with the most axes has. The glyph axes' own tags (`SPRD`) stay in
//! the document.
//!
//! A tag a font axis already uses is skipped: with a font axis tagged `V000`,
//! the first glyph axis of every glyph is `V001`.
//!
//! Each glyph axis normalizes over its own range, in its own units. Drawings
//! on the axis and component locations for it normalize alike, so the
//! hidden `fvar` axis that `VARC` reads spans the normalized range, -1 to 1.

use std::collections::{BTreeMap, HashMap};

use fontdrasil::coords::{CoordConverter, DesignCoord, NormalizedCoord, UserCoord};
use fontdrasil::types::{Axes, Axis as IrAxis, GlyphName, Tag};
use shift_font::{AxisId, Glyph, GlyphAxis, GlyphId};
use shift_text::shaper_font::{AxisConversionError, to_ir_axes};

/// The most hidden axes a font can have: tags `V000` to `V999`.
const MAX_HIDDEN_AXES: usize = 1000;

/// Why a glyph's axes cannot compile.
#[derive(Debug, thiserror::Error)]
pub(crate) enum GlyphAxesError {
    #[error("glyph '{glyph}' has {count} axes, more than the {MAX_HIDDEN_AXES} a font can hide")]
    TooManyAxes { glyph: String, count: usize },

    #[error("glyph '{glyph}' has an invalid axis: {source}")]
    InvalidAxis {
        glyph: String,
        #[source]
        source: AxisConversionError,
    },
}

/// Every glyph's own axes, tagged by position (see the module docs).
#[derive(Clone, Debug, Default)]
pub(super) struct HiddenAxes {
    /// The shared tags in order, as many as the glyph with the most axes has.
    tags: Vec<Tag>,
    /// Each glyph axis by id, as a fontir axis with its positional tag and
    /// the axis's own range.
    by_axis: HashMap<AxisId, IrAxis>,
    /// Each glyph's axes, in its own order.
    by_glyph: HashMap<GlyphId, Axes>,
    /// The same, by glyph name, as fontir's static metadata lists them.
    by_name: BTreeMap<GlyphName, Axes>,
}

impl HiddenAxes {
    /// The hidden axes of `glyphs`, skipping the tags `font_tags` use.
    ///
    /// # Errors
    ///
    /// Returns [`GlyphAxesError`] when a glyph has more axes than there are
    /// free tags, or an axis that is invalid on its own.
    pub(super) fn new<'a>(
        glyphs: impl IntoIterator<Item = &'a Glyph>,
        font_tags: &[&str],
    ) -> Result<Self, GlyphAxesError> {
        let digits = b'0'..=b'9';
        let free_tags = digits
            .clone()
            .flat_map(move |hundreds| digits.clone().map(move |tens| (hundreds, tens)))
            .flat_map(|(hundreds, tens)| (b'0'..=b'9').map(move |ones| [hundreds, tens, ones]))
            .map(|[hundreds, tens, ones]| Tag::new(&[b'V', hundreds, tens, ones]))
            .filter(|tag| {
                !font_tags
                    .iter()
                    .any(|font_tag| font_tag.as_bytes() == tag.to_be_bytes())
            });
        let mut hidden = Self::default();
        for glyph in glyphs {
            let axes = glyph.axes();
            if axes.is_empty() {
                continue;
            }
            if hidden.tags.len() < axes.len() {
                hidden.tags = free_tags.clone().take(axes.len()).collect();
                if hidden.tags.len() < axes.len() {
                    return Err(GlyphAxesError::TooManyAxes {
                        glyph: glyph.name().to_string(),
                        count: axes.len(),
                    });
                }
            }
            let shift_axes: Vec<_> = axes.iter().map(|axis| axis.as_axis().clone()).collect();
            let ir_axes: Vec<IrAxis> = to_ir_axes(&shift_axes, &[])
                .map_err(|source| GlyphAxesError::InvalidAxis {
                    glyph: glyph.name().to_string(),
                    source,
                })?
                .into_iter()
                .zip(&hidden.tags)
                .map(|(mut ir_axis, tag)| {
                    ir_axis.tag = *tag;
                    ir_axis.hidden = true;
                    ir_axis
                })
                .collect();
            hidden
                .by_axis
                .extend(axes.iter().map(GlyphAxis::id).zip(ir_axes.iter().cloned()));
            let ir_axes = Axes::new(ir_axes);
            hidden.by_glyph.insert(glyph.id(), ir_axes.clone());
            hidden.by_name.insert(glyph.name().into(), ir_axes);
        }
        Ok(hidden)
    }

    /// The glyph axis `axis_id` as fontir reads it: its positional tag and
    /// its own range. `None` for an axis that is not a glyph axis.
    pub(super) fn axis(&self, axis_id: AxisId) -> Option<&IrAxis> {
        self.by_axis.get(&axis_id)
    }

    /// `glyph_id`'s own axes, in its order; empty for a glyph without any.
    pub(super) fn of_glyph(&self, glyph_id: GlyphId) -> Axes {
        self.by_glyph.get(&glyph_id).cloned().unwrap_or_default()
    }

    /// Every glyph's axes by glyph name, for fontir's static metadata.
    pub(super) fn by_glyph_name(&self) -> BTreeMap<GlyphName, Axes> {
        self.by_name.clone()
    }

    /// The shared hidden axes as `fvar` axes for `VARC`: one per tag, over
    /// the normalized range, as fontra2fontir declares them.
    pub(super) fn fvar_axes(&self) -> impl Iterator<Item = IrAxis> + '_ {
        let (min, default, max) = (
            UserCoord::new(-1.0),
            UserCoord::new(0.0),
            UserCoord::new(1.0),
        );
        self.tags.iter().map(move |tag| IrAxis {
            name: tag.to_string(),
            tag: *tag,
            hidden: true,
            min,
            default,
            max,
            converter: CoordConverter::unmapped(min, default, max),
            localized_names: Default::default(),
        })
    }
}

/// `value`, in `axis`'s own units, normalized over its range.
pub(super) fn normalized(axis: &IrAxis, value: f64) -> NormalizedCoord {
    DesignCoord::new(value).to_normalized(&axis.converter)
}
