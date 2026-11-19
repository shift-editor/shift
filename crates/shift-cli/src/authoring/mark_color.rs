//! Glyph mark colours: the colour a designer tags a glyph with, which the
//! app's glyph grid draws and filters by.

use std::collections::HashSet;

use miette::Result;
use shift_font::{FontIntentSet, InvalidMarkColor, MarkColor, NamedMarkColor, SetMarkColor};

use crate::cli::MarkColorArgs;
use crate::selector::FontSelectors;

use super::glyph::load_font;
use super::{AuthoringReport, apply_mutation};

/// Text that names no mark colour, with the colours that are accepted.
#[derive(Debug, thiserror::Error)]
#[error("{0}; use one of {names}, or r,g,b,a with each channel from 0 to 1", names = named_colors())]
pub(crate) struct UnknownMarkColor(InvalidMarkColor);

fn named_colors() -> String {
    NamedMarkColor::ALL
        .iter()
        .map(|named| named.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

/// Reads a mark colour as the CLI and glyph batches write it: a named
/// colour such as `red` or `lightGreen`, or `r,g,b,a` text for any other.
///
/// `r,g,b,a` text stays a custom colour even when it equals a named
/// colour's value.
///
/// # Errors
///
/// Returns [`UnknownMarkColor`] when `text` is neither form.
pub(crate) fn parse_mark_color(text: &str) -> Result<MarkColor, UnknownMarkColor> {
    text.trim().parse().map_err(UnknownMarkColor)
}

/// Tags the named glyphs with one mark colour, or clears their colours, as
/// one atomic edit.
///
/// # Errors
///
/// Rejects a glyph selector that names no glyph without writing; reports
/// document and persistence failures.
pub(crate) fn set_mark_color(args: &MarkColorArgs) -> Result<AuthoringReport> {
    let font = load_font(&args.path)?;
    let mut seen = HashSet::new();
    let mut glyph_ids = Vec::with_capacity(args.glyphs.len());
    for selector in &args.glyphs {
        let glyph_id = font.glyph_id_for(selector)?;
        if seen.insert(glyph_id) {
            glyph_ids.push(glyph_id);
        }
    }
    let set = FontIntentSet::from(SetMarkColor {
        glyph_ids,
        color: args.color.color,
    });

    apply_mutation(&args.path, &args.mutation, &set)
}
