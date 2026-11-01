use crate::SourceIds;
use std::{collections::HashMap, path::Path, sync::Arc};

use glyphs_reader::{Font as GlyphsFont, Shape};
use rayon::prelude::*;
use shift_font::{Anchor, Font, Glyph, GlyphId, GlyphLayer};

use super::{
    GlyphsAnchorExt,
    conversion::{
        GlyphsLayerSources, add_intermediate_sources, component_base_id, convert_glyph,
        convert_kerning, font_header, glyph_identity, imported_layer_count,
    },
    families::InstanceFamilies,
    report::import_report,
};
use crate::font_source::authored::{AuthoredEntry, AuthoredGlyphs};
use crate::{
    FormatBackendError, FormatBackendResult, ImportReport,
    import::{GlyphDirectoryEntry, GlyphStream, ImportBatchLimit},
};

/// Bounded Shift conversion over one parsed Glyphs source.
pub(crate) struct GlyphsGlyphStream {
    source: Arc<GlyphsFont>,
    glyph_ids: HashMap<String, GlyphId>,
    glyph_names: Vec<String>,
    sources: GlyphsLayerSources,
    ids: SourceIds,
    next_glyph: usize,
}

impl GlyphStream for GlyphsGlyphStream {
    fn directory(&self) -> Vec<GlyphDirectoryEntry> {
        self.glyph_names
            .iter()
            .map(|name| GlyphDirectoryEntry {
                glyph_id: self.glyph_ids[name],
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
                    &self.ids,
                )
            })
            .collect::<FormatBackendResult<Vec<_>>>()?;
        self.next_glyph = end;
        Ok(glyphs)
    }
}

/// A Glyphs file's glyphs read one at a time, through the import stream.
pub(crate) struct GlyphsAuthoredGlyphs {
    stream: GlyphsGlyphStream,
}

impl GlyphsAuthoredGlyphs {
    pub(crate) fn new(stream: GlyphsGlyphStream) -> Self {
        Self { stream }
    }

    fn source_glyph(&self, index: usize) -> &glyphs_reader::Glyph {
        &self.stream.source.glyphs[self.stream.glyph_names[index].as_str()]
    }
}

impl AuthoredGlyphs for GlyphsAuthoredGlyphs {
    fn glyph_count(&self) -> usize {
        self.stream.glyph_names.len()
    }

    fn entry(&self, index: usize) -> FormatBackendResult<AuthoredEntry> {
        let glyph = self.source_glyph(index);
        let mut entry = AuthoredEntry::new(glyph_identity(glyph, &self.stream.glyph_ids));
        for (layer, source_id) in self.stream.sources.imported(glyph) {
            let layer_id = self
                .stream
                .ids
                .layer_id(glyph.name.as_str(), &layer.layer_id);
            entry.glyph.set_layer(GlyphLayer::with_width(
                layer_id,
                source_id,
                layer.width.into_inner(),
            ));
            for shape in &layer.shapes {
                if let Shape::Component(component) = shape {
                    entry.bases.insert(component_base_id(
                        &self.stream.glyph_ids,
                        component.name.as_str(),
                    )?);
                }
            }
            let attaching = layer
                .anchors
                .iter()
                .any(|anchor| Anchor::name_attaches_marks(anchor.name_and_position().0.as_deref()));
            if attaching {
                entry.attaching.push(layer_id);
            }
        }
        Ok(entry)
    }

    fn glyph(&self, index: usize) -> FormatBackendResult<Glyph> {
        convert_glyph(
            self.source_glyph(index),
            &self.stream.glyph_ids,
            &self.stream.sources,
            &self.stream.ids,
        )
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
    let families = InstanceFamilies::read(path, &source);
    report.losses.extend(families.loss());
    let (mut header, source_ids_by_master_id) =
        font_header(&source, path, &families, &mut report.losses)?;
    let glyph_names = source
        .glyphs
        .values()
        .map(|glyph| glyph.name.to_string())
        .collect::<Vec<_>>();
    let ids = SourceIds::for_path(path);
    let glyph_ids = glyph_names
        .iter()
        .map(|name| (name.clone(), ids.glyph_id(name)))
        .collect();
    *header.kerning_mut() =
        convert_kerning(&source, &glyph_ids, &source_ids_by_master_id, &mut report);
    let sources = add_intermediate_sources(&mut header, &source, source_ids_by_master_id, &ids);

    Ok((
        header,
        GlyphsGlyphStream {
            source,
            glyph_ids,
            glyph_names,
            sources,
            ids,
            next_glyph: 0,
        },
        report,
    ))
}
