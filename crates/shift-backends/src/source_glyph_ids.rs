use std::path::Path;

use shift_font::GlyphId;

/// Mints the glyph IDs for one font source, identically for every reader of that source.
///
/// A preview and the import that converts it into a document both derive IDs here, so an
/// open glyph keeps its identity across the conversion.
#[derive(Clone, Debug)]
pub struct SourceGlyphIds {
    source_key: String,
}

impl SourceGlyphIds {
    /// Keys IDs by the source's canonical path, or by `path` itself when it cannot be resolved.
    pub fn for_path(path: &Path) -> Self {
        let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        Self {
            source_key: canonical.to_string_lossy().into_owned(),
        }
    }

    /// Returns the ID of the source glyph named `name`.
    pub fn glyph_id(&self, name: &str) -> GlyphId {
        GlyphId::from_source(&self.source_key, name)
    }
}
