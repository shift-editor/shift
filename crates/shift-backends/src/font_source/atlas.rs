use std::collections::HashSet;

pub(crate) use shift_slug::retained::{AtlasAxis, AtlasRegion, RegionAxis, RegionRegistry};
pub type SourceAtlasDescriptor = shift_slug::retained::RetainedAtlasDescriptor;
pub type SourceAtlasPage = shift_slug::retained::RetainedAtlasPage;

use crate::font_source::{FontDirectory, FontReadError, GlyphIndex};

#[derive(Debug, thiserror::Error)]
pub enum SourceAtlasError {
    #[error(transparent)]
    Read(#[from] FontReadError),

    #[error(transparent)]
    Slug(#[from] shift_slug::SlugError),

    #[error("unsupported binary atlas source: {details}")]
    UnsupportedBinary { details: &'static str },
}

pub(crate) fn validate_roots(
    directory: &FontDirectory,
    roots: &[GlyphIndex],
) -> Result<(), SourceAtlasError> {
    let mut unique = HashSet::with_capacity(roots.len());
    for root in roots {
        if directory.glyphs.get(root.to_usize()).is_none() {
            return Err(FontReadError::GlyphOutOfRange {
                glyph: *root,
                glyph_count: directory.glyphs.len() as u32,
            }
            .into());
        }
        if !unique.insert(*root) {
            return Err(FontReadError::InvalidProjection {
                details: format!("source atlas page repeats glyph {root:?}"),
            }
            .into());
        }
    }
    Ok(())
}
