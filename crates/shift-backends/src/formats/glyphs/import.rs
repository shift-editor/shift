use crate::SourceGlyphIds;
use std::{collections::HashMap, path::Path, sync::Arc};

use glyphs_reader::Font as GlyphsFont;
use rayon::prelude::*;
use shift_font::{Font, Glyph, GlyphId};

use super::{
    conversion::{
        add_intermediate_sources, convert_glyph, convert_kerning, font_header,
        imported_layer_count, GlyphsLayerSources,
    },
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
    sources: GlyphsLayerSources,
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
            let next_layers = imported_layer_count(glyph, &self.sources);
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
                    &self.sources,
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
    stream_retained(Path::new(path), source)
}

pub(crate) fn stream_retained(
    path: &Path,
    source: Arc<GlyphsFont>,
) -> FormatBackendResult<(Font, GlyphsGlyphStream, ImportReport)> {
    let mut report = import_report(&source);
    let (mut header, source_ids_by_master_id) = font_header(&source, path)?;
    let glyph_names = source
        .glyphs
        .values()
        .map(|glyph| glyph.name.to_string())
        .collect::<Vec<_>>();
    let source_glyph_ids = SourceGlyphIds::for_path(path);
    let glyph_ids = glyph_names
        .iter()
        .map(|name| (name.clone(), source_glyph_ids.glyph_id(name)))
        .collect();
    *header.kerning_mut() =
        convert_kerning(&source, &glyph_ids, &source_ids_by_master_id, &mut report);
    let sources = add_intermediate_sources(&mut header, &source, source_ids_by_master_id);

    Ok((
        header,
        GlyphsGlyphStream {
            source,
            glyph_ids,
            glyph_names,
            sources,
            next_glyph: 0,
        },
        report,
    ))
}
