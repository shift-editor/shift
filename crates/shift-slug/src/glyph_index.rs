//! The position of a glyph in a Slug atlas's glyph table.

use std::fmt;

use crate::SlugError;
use crate::length::to_u32;

/// A glyph's position in a [`VariableAtlas`](crate::VariableAtlas)'s glyph table.
///
/// It is the atlas's own numbering, not a font glyph id. It has the layout of
/// a `u32`, so packed GPU records that hold one keep their bytes.
#[repr(transparent)]
#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct GlyphIndex(u32);

impl GlyphIndex {
    pub const fn new(index: u32) -> Self {
        Self(index)
    }

    pub const fn get(self) -> u32 {
        self.0
    }

    /// The index for indexing the atlas's glyph table.
    pub(crate) fn as_usize(self) -> usize {
        self.0 as usize
    }

    /// The index the next glyph appended to a table of `len` glyphs takes.
    ///
    /// # Errors
    ///
    /// Returns [`SlugError::LengthOverflow`] when `len` does not fit a `u32`.
    pub(crate) fn next_after(len: usize) -> Result<Self, SlugError> {
        to_u32(len).map(Self)
    }
}

impl fmt::Display for GlyphIndex {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl From<GlyphIndex> for u32 {
    fn from(index: GlyphIndex) -> Self {
        index.0
    }
}
