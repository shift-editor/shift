//! Axes only one glyph varies along: `glyph axis add`, `set` and `remove`.
//!
//! Every value is in the axis's own units. Range edits never move a stored
//! value unless `--rescale` asks for it; removal is refused while a drawing
//! or a component sets a value on the axis.

use miette::{Result, bail, miette};
use shift_font::{AxisId, AxisRange, CreateGlyphAxis, EditGlyphAxis, FontIntentSet, GlyphAxisEdit};

use crate::cli::{
    AddGlyphAxisArgs, EditGlyphAxisArgs, GlyphAxisRangeArgs, GlyphAxisRangeEditArgs,
    RemoveGlyphAxisArgs,
};
use crate::selector::FontSelectors;

use super::glyph::load_font;
use super::{AuthoringReport, apply_mutation, require_finite};

/// Adds one axis to a glyph.
///
/// # Errors
///
/// Rejects an unknown glyph, non-finite or unordered range values, a blank
/// name, and a tag another font or glyph axis has.
pub(crate) fn add_glyph_axis(args: AddGlyphAxisArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let glyph_id = font.glyph_id_for(&args.glyph)?;
    let GlyphAxisRangeArgs { min, default, max } = args.range;
    let range = AxisRange {
        minimum: min,
        default,
        maximum: max,
    };
    require_finite_range(range)?;
    let set = FontIntentSet::from(CreateGlyphAxis {
        glyph_id,
        axis_id: AxisId::new(),
        name: args.name,
        tag: args.tag,
        range,
    });

    apply_mutation(&args.path, &args.mutation, &set)
}

/// Renames, retags or changes the range of one glyph axis, as one edit.
///
/// # Errors
///
/// Rejects an empty edit, `--rescale` without a range, an unknown glyph or
/// axis, and a range that would strand a drawing or component location
/// (without `--rescale`), naming each value.
pub(crate) fn edit_glyph_axis(args: EditGlyphAxisArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let glyph_id = font.glyph_id_for(&args.glyph)?;
    let axis_id = font.glyph_axis_id_for(glyph_id, &args.axis)?;
    let current = font
        .glyph_axis(axis_id)
        .ok_or_else(|| miette!("axis {:?} does not exist", args.axis))?
        .as_axis()
        .kind()
        .range();
    let range = args.range.over(current);
    if args.range.rescale && range.is_none() {
        bail!("--rescale needs a new --min, --default or --max");
    }
    if args.name.is_none() && args.tag.is_none() && range.is_none() {
        bail!("glyph axis edit requires a name, tag, or range edit");
    }

    let mut edits = Vec::new();
    if let Some(name) = args.name {
        edits.push(GlyphAxisEdit::Name(name));
    }
    if let Some(tag) = args.tag {
        edits.push(GlyphAxisEdit::Tag(tag));
    }
    if let Some(range) = range {
        require_finite_range(range)?;
        edits.push(if args.range.rescale {
            GlyphAxisEdit::Rescale(range)
        } else {
            GlyphAxisEdit::Range(range)
        });
    }
    let set = edits
        .into_iter()
        .map(|edit| EditGlyphAxis { axis_id, edit }.into())
        .collect();

    apply_mutation(&args.path, &args.mutation, &set)
}

/// Removes one glyph axis that nothing sets a value on.
///
/// # Errors
///
/// Rejects an unknown glyph or axis, and an axis in use, naming every
/// drawing and component that sets it.
pub(crate) fn remove_glyph_axis(args: &RemoveGlyphAxisArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let glyph_id = font.glyph_id_for(&args.glyph)?;
    let axis_id = font.glyph_axis_id_for(glyph_id, &args.axis)?;
    let set = FontIntentSet::from(EditGlyphAxis {
        axis_id,
        edit: GlyphAxisEdit::Remove,
    });

    apply_mutation(&args.path, &args.mutation, &set)
}

/// Checks each of a range's values is finite, naming the flag of the first
/// that isn't.
fn require_finite_range(range: AxisRange) -> Result<()> {
    for (value, label) in [
        (range.minimum, "--min"),
        (range.default, "--default"),
        (range.maximum, "--max"),
    ] {
        require_finite(value, label)?;
    }
    Ok(())
}

impl GlyphAxisRangeEditArgs {
    /// The range these flags ask for, each omitted value kept from
    /// `current`; `None` when no value is given.
    fn over(&self, current: AxisRange) -> Option<AxisRange> {
        if self.min.is_none() && self.default.is_none() && self.max.is_none() {
            return None;
        }
        Some(AxisRange {
            minimum: self.min.unwrap_or(current.minimum),
            default: self.default.unwrap_or(current.default),
            maximum: self.max.unwrap_or(current.maximum),
        })
    }
}
