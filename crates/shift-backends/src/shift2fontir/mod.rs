//! Adapts an owned Shift font snapshot to Google Fonts fontir work.
//!
//! Independent axis mappings convert Shift user coordinates to design
//! coordinates; master source locations are already in that design space and
//! are normalized through the same converters. Cross-axis mappings are
//! rejected because the compiler stack cannot emit `avar` version 2.
//!
//! Every glyph requires a default-source layer. Missing non-default layers are
//! sparse masters rather than errors. Font-wide metrics and kerning are static,
//! and source names do not create named instances.

mod axes;
mod glyph;
mod kerning;
mod metadata;
mod source;
mod stat;

#[cfg(test)]
mod tests;

pub(crate) use source::{ShiftIrSource, ShiftIrSourceError};
