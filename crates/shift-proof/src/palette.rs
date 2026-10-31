//! The colors a proof is drawn in.

use std::fmt;

use serde::{Serialize, Serializer};

/// An opaque 8-bit sRGB color, written as `#rrggbb`.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Rgb(pub [u8; 3]);

impl fmt::Display for Rgb {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let [red, green, blue] = self.0;
        write!(formatter, "#{red:02x}{green:02x}{blue:02x}")
    }
}

impl Serialize for Rgb {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

/// Page background.
pub(crate) const BACKGROUND: Rgb = Rgb([255, 255, 255]);
/// Glyph ink.
pub(crate) const INK: Rgb = Rgb([0, 0, 0]);
/// Fill for `.notdef` glyphs and placeholders.
pub(crate) const MISSING: Rgb = Rgb([220, 38, 38]);
/// Sizes, locations, and glyph names.
pub(crate) const LABEL: Rgb = Rgb([140, 140, 140]);
