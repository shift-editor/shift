use std::path::PathBuf;

use shift_font::{Font, Glyph, GlyphId, GlyphName};

use crate::{BackendError, BackendResult, FontFormat, FormatBackendResult};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlyphDirectoryEntry {
    pub glyph_id: GlyphId,
    pub name: GlyphName,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ImportBatchLimit {
    max_glyphs: usize,
    max_layers: usize,
}

impl ImportBatchLimit {
    pub fn new(max_glyphs: usize, max_layers: usize) -> Self {
        Self {
            max_glyphs: max_glyphs.max(1),
            max_layers: max_layers.max(1),
        }
    }

    pub fn max_glyphs(self) -> usize {
        self.max_glyphs
    }

    pub fn max_layers(self) -> usize {
        self.max_layers
    }
}

impl Default for ImportBatchLimit {
    fn default() -> Self {
        Self::new(512, 1_024)
    }
}

pub(crate) trait GlyphStream: Send {
    fn directory(&self) -> Vec<GlyphDirectoryEntry>;
    fn glyph_count(&self) -> usize;
    fn next_batch(&mut self, limit: ImportBatchLimit) -> FormatBackendResult<Vec<Glyph>>;
}

/// A bounded foreign-font import.
///
/// The header contains top-level authored state but no glyphs. Glyph geometry
/// is materialized only in batches requested by [`Self::next_batch`].
pub struct FontImport {
    header: Font,
    stream: Box<dyn GlyphStream>,
    format: FontFormat,
    path: PathBuf,
}

impl FontImport {
    pub(crate) fn new(
        header: Font,
        stream: impl GlyphStream + 'static,
        format: FontFormat,
        path: PathBuf,
    ) -> Self {
        Self {
            header,
            stream: Box::new(stream),
            format,
            path,
        }
    }

    pub fn header(&self) -> &Font {
        &self.header
    }

    pub fn directory(&self) -> Vec<GlyphDirectoryEntry> {
        self.stream.directory()
    }

    pub fn glyph_count(&self) -> usize {
        self.stream.glyph_count()
    }

    pub fn next_batch(&mut self, limit: ImportBatchLimit) -> BackendResult<Vec<Glyph>> {
        self.stream
            .next_batch(limit)
            .map_err(|source| BackendError::load(self.format, self.path.clone(), source))
    }
}
