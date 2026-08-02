use std::{collections::HashMap, path::Path};

use glyphs_reader::{Font as GlyphsFont, Glyph as GlyphsGlyph};
use rayon::prelude::*;
use shift_font::{Font, Glyph, GlyphId, SourceId};

use super::conversion::{convert_glyph, font_header, imported_layer_count};
use crate::{
    import::{GlyphDirectoryEntry, GlyphStream, ImportBatchLimit},
    FormatBackendError, FormatBackendResult,
};

/// Bounded Shift conversion over one parsed Glyphs source.
pub(crate) struct GlyphsGlyphStream {
    glyph_ids: HashMap<String, GlyphId>,
    glyphs: Vec<GlyphsGlyph>,
    source_ids_by_master_id: HashMap<String, SourceId>,
    next_glyph: usize,
}

impl GlyphStream for GlyphsGlyphStream {
    fn directory(&self) -> Vec<GlyphDirectoryEntry> {
        self.glyphs
            .iter()
            .map(|glyph| GlyphDirectoryEntry {
                glyph_id: self.glyph_ids[glyph.name.as_str()].clone(),
                name: glyph.name.to_string().into(),
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
            let next_layers =
                imported_layer_count(&self.glyphs[end], &self.source_ids_by_master_id);
            if end > self.next_glyph && layer_count + next_layers > limit.max_layers() {
                break;
            }

            layer_count += next_layers;
            end += 1;
        }

        let glyphs = self.glyphs[self.next_glyph..end]
            .par_iter()
            .map(|glyph| convert_glyph(glyph, &self.glyph_ids, &self.source_ids_by_master_id))
            .collect::<FormatBackendResult<Vec<_>>>()?;
        self.next_glyph = end;
        Ok(glyphs)
    }
}

pub(crate) fn stream_font(path: &str) -> FormatBackendResult<(Font, GlyphsGlyphStream)> {
    let mut glyphs_font = GlyphsFont::load(Path::new(path))
        .map_err(|error| FormatBackendError::Glyphs(error.to_string()))?;
    let (header, source_ids_by_master_id) = font_header(&glyphs_font)?;
    let glyph_ids = glyphs_font
        .glyphs
        .values()
        .map(|glyph| (glyph.name.to_string(), GlyphId::new()))
        .collect();
    let glyphs = std::mem::take(&mut glyphs_font.glyphs)
        .into_values()
        .collect();

    Ok((
        header,
        GlyphsGlyphStream {
            glyph_ids,
            glyphs,
            source_ids_by_master_id,
            next_glyph: 0,
        },
    ))
}
