use std::{collections::HashMap, path::Path, sync::Arc};

use glyphs_reader::Font as GlyphsFont;
use rayon::prelude::*;
use shift_font::{Font, Glyph, GlyphId, SourceId};

use super::{
    conversion::{convert_glyph, font_header, imported_layer_count},
    report::import_report,
};
use crate::{
    import::{GlyphDirectoryEntry, GlyphStream, ImportBatchLimit},
    FormatBackendError, FormatBackendResult, ImportReport,
};

/// Bounded Shift conversion over one parsed Glyphs source.
pub(crate) struct GlyphsGlyphStream {
    source: Arc<GlyphsFont>,
    glyph_ids: HashMap<String, GlyphId>,
    glyph_names: Vec<String>,
    source_ids_by_master_id: HashMap<String, SourceId>,
    next_glyph: usize,
}

impl GlyphStream for GlyphsGlyphStream {
    fn directory(&self) -> Vec<GlyphDirectoryEntry> {
        self.glyph_names
            .iter()
            .map(|name| GlyphDirectoryEntry {
                glyph_id: self.glyph_ids[name].clone(),
                name: name.clone().into(),
            })
            .collect()
    }

    fn glyph_count(&self) -> usize {
        self.glyph_names.len()
    }

    fn next_batch(&mut self, limit: ImportBatchLimit) -> FormatBackendResult<Vec<Glyph>> {
        if self.next_glyph == self.glyph_names.len() {
            return Ok(Vec::new());
        }

        let mut end = self.next_glyph;
        let mut layer_count = 0;
        while end < self.glyph_names.len() && end - self.next_glyph < limit.max_glyphs() {
            let glyph = &self.source.glyphs[self.glyph_names[end].as_str()];
            let next_layers = imported_layer_count(glyph, &self.source_ids_by_master_id);
            if end > self.next_glyph && layer_count + next_layers > limit.max_layers() {
                break;
            }

            layer_count += next_layers;
            end += 1;
        }

        let glyphs = self.glyph_names[self.next_glyph..end]
            .par_iter()
            .map(|name| {
                convert_glyph(
                    &self.source.glyphs[name.as_str()],
                    &self.glyph_ids,
                    &self.source_ids_by_master_id,
                )
            })
            .collect::<FormatBackendResult<Vec<_>>>()?;
        self.next_glyph = end;
        Ok(glyphs)
    }
}

pub(crate) fn stream_font(
    path: &str,
) -> FormatBackendResult<(Font, GlyphsGlyphStream, ImportReport)> {
    let source = Arc::new(
        GlyphsFont::load(Path::new(path))
            .map_err(|error| FormatBackendError::Glyphs(error.to_string()))?,
    );
    stream_retained(source)
}

pub(crate) fn stream_retained(
    source: Arc<GlyphsFont>,
) -> FormatBackendResult<(Font, GlyphsGlyphStream, ImportReport)> {
    let report = import_report(&source);
    let (header, source_ids_by_master_id) = font_header(&source)?;
    let glyph_names = source
        .glyphs
        .values()
        .map(|glyph| glyph.name.to_string())
        .collect::<Vec<_>>();
    let glyph_ids = glyph_names
        .iter()
        .map(|name| (name.clone(), GlyphId::new()))
        .collect();

    Ok((
        header,
        GlyphsGlyphStream {
            source,
            glyph_ids,
            glyph_names,
            source_ids_by_master_id,
            next_glyph: 0,
        },
        report,
    ))
}
