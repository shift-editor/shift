use std::{collections::HashMap, path::PathBuf};

use rayon::prelude::*;
use shift_font::{Font, Glyph, GlyphId, GlyphName, LayerId, SourceId};

use crate::{BackendError, BackendResult, FontFormat, FormatBackendResult, ImportReport};

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

#[derive(Clone)]
pub(crate) struct GlifLayer {
    pub(crate) source_id: SourceId,
    pub(crate) layer_id: LayerId,
    pub(crate) path: PathBuf,
}

#[derive(Clone)]
pub(crate) struct GlifGlyph {
    pub(crate) id: GlyphId,
    pub(crate) name: String,
    pub(crate) layers: Vec<GlifLayer>,
}

pub(crate) struct GlifGlyphStream {
    glyph_ids: HashMap<String, GlyphId>,
    glyphs: Vec<GlifGlyph>,
    next_glyph: usize,
}

impl GlifGlyphStream {
    pub(crate) fn new(glyph_ids: HashMap<String, GlyphId>, glyphs: Vec<GlifGlyph>) -> Self {
        Self {
            glyph_ids,
            glyphs,
            next_glyph: 0,
        }
    }
}

impl GlyphStream for GlifGlyphStream {
    fn directory(&self) -> Vec<GlyphDirectoryEntry> {
        self.glyphs
            .iter()
            .map(|glyph| GlyphDirectoryEntry {
                glyph_id: glyph.id.clone(),
                name: glyph.name.clone().into(),
            })
            .collect()
    }

    fn glyph_count(&self) -> usize {
        self.glyphs.len()
    }

    fn next_batch(&mut self, limit: ImportBatchLimit) -> FormatBackendResult<Vec<Glyph>> {
        if self.next_glyph == self.glyphs.len() {
            return Ok(Vec::new());
        }

        let mut end = self.next_glyph;
        let mut layer_count = 0;
        while end < self.glyphs.len() && end - self.next_glyph < limit.max_glyphs() {
            let next_layers = self.glyphs[end].layers.len();
            if end > self.next_glyph && layer_count + next_layers > limit.max_layers() {
                break;
            }
            layer_count += next_layers;
            end += 1;
        }
        let glyph_ids = &self.glyph_ids;
        let glyphs = self.glyphs[self.next_glyph..end]
            .par_iter()
            .map(|record| load_glif_glyph(record, glyph_ids))
            .collect::<FormatBackendResult<Vec<_>>>()?;
        self.next_glyph = end;
        Ok(glyphs)
    }
}

fn load_glif_glyph(
    record: &GlifGlyph,
    glyph_ids: &HashMap<String, GlyphId>,
) -> FormatBackendResult<Glyph> {
    let mut glyph = Glyph::with_id(record.id.clone(), record.name.clone());
    for (index, layer_record) in record.layers.iter().enumerate() {
        let norad_glyph = norad::Glyph::load(&layer_record.path).map_err(|error| {
            crate::FormatBackendError::Ufo(format!(
                "failed to read glyph {:?} from {}: {error}",
                record.name,
                layer_record.path.display()
            ))
        })?;
        if index == 0 {
            glyph.set_unicodes(norad_glyph.codepoints.iter().map(u32::from).collect());
            if !norad_glyph.lib.is_empty() {
                *glyph.lib_mut() = crate::formats::ufo::UfoReader::convert_lib(&norad_glyph.lib);
            }
        }
        let layer = crate::formats::ufo::UfoReader::convert_stream_layer(
            &norad_glyph,
            layer_record.layer_id.clone(),
            layer_record.source_id.clone(),
            glyph_ids,
        )?;
        glyph.set_layer(layer);
    }
    Ok(glyph)
}

pub(crate) type PreparedImport = (Font, Box<dyn GlyphStream>, ImportReport);

pub(crate) trait GlyphStream: Send {
    fn directory(&self) -> Vec<GlyphDirectoryEntry>;
    fn glyph_count(&self) -> usize;
    fn next_batch(&mut self, limit: ImportBatchLimit) -> FormatBackendResult<Vec<Glyph>>;
}

pub(crate) fn collect_streamed_font(
    mut header: Font,
    stream: &mut dyn GlyphStream,
) -> FormatBackendResult<Font> {
    let expected_glyph_count = stream.glyph_count();
    loop {
        let glyphs = stream.next_batch(ImportBatchLimit::default())?;
        if glyphs.is_empty() {
            break;
        }
        for glyph in glyphs {
            header.insert_glyph(glyph)?;
        }
    }
    debug_assert_eq!(header.glyph_count(), expected_glyph_count);
    Ok(header)
}

/// A bounded source-to-Shift import.
///
/// The header contains top-level authored state but no glyphs. Glyph geometry
/// is materialized only in batches requested by [`Self::next_batch`].
pub struct FontImport {
    header: Font,
    stream: Box<dyn GlyphStream>,
    report: ImportReport,
    format: FontFormat,
    path: PathBuf,
}

impl FontImport {
    pub(crate) fn new(
        header: Font,
        stream: Box<dyn GlyphStream>,
        report: ImportReport,
        format: FontFormat,
        path: PathBuf,
    ) -> Self {
        Self {
            header,
            stream,
            report,
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

    pub fn report(&self) -> &ImportReport {
        &self.report
    }

    pub fn glyph_count(&self) -> usize {
        self.stream.glyph_count()
    }

    pub fn next_batch(&mut self, limit: ImportBatchLimit) -> BackendResult<Vec<Glyph>> {
        self.stream
            .next_batch(limit)
            .map_err(|source| BackendError::load(self.format, self.path.clone(), source))
    }

    /// Drains the same bounded stream used by native import into one eager
    /// font for compatibility callers. Streaming semantics are therefore the
    /// only parsing semantics for formats that implement them.
    pub fn collect_font(self) -> BackendResult<Font> {
        let Self {
            header,
            mut stream,
            report: _,
            format,
            path,
        } = self;
        collect_streamed_font(header, stream.as_mut())
            .map_err(|source| BackendError::load(format, path, source))
    }
}
