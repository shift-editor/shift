//! A read-only view of a font restricted to a few glyphs, for compiling just
//! what a preview needs.

use std::collections::HashSet;

use shift_font::{
    Axis, AxisMapping, BinaryData, FeatureData, FontMetadata, FontMetrics, Glyph, Guideline,
    KerningData, LibData, MetricDefinition, NamedInstance, Source, SourceId,
};

use crate::traits::FontView;

/// Exposes only the kept glyphs of `font`, plus every glyph they use as a
/// component, with no feature code or kerning.
///
/// Glyph order follows the underlying font. Dropping features and kerning
/// keeps the compile independent of glyphs outside the subset; text that
/// needs contextual forms must be compiled from the whole font instead.
pub struct GlyphSubsetView<'a, F: FontView> {
    font: &'a F,
    kept: HashSet<String>,
    features: FeatureData,
    kerning: KerningData,
}

impl<'a, F: FontView> GlyphSubsetView<'a, F> {
    /// Keeps the named glyphs and their component closure; unknown names are ignored.
    pub fn new<'n>(font: &'a F, names: impl IntoIterator<Item = &'n str>) -> Self {
        let mut kept = HashSet::new();
        let mut pending: Vec<String> = names.into_iter().map(str::to_owned).collect();
        while let Some(name) = pending.pop() {
            let Some(glyph) = font.glyph(&name) else {
                continue;
            };
            if !kept.insert(name) {
                continue;
            }
            for layer in glyph.layers().values() {
                pending.extend(
                    layer
                        .components_iter()
                        .map(|component| component.base_glyph_name().to_string()),
                );
            }
        }

        Self {
            font,
            kept,
            features: FeatureData::default(),
            kerning: KerningData::default(),
        }
    }
}

impl<F: FontView> FontView for GlyphSubsetView<'_, F> {
    fn metadata(&self) -> &FontMetadata {
        self.font.metadata()
    }

    fn metrics(&self) -> &FontMetrics {
        self.font.metrics()
    }

    fn metric_definitions(&self) -> &[MetricDefinition] {
        self.font.metric_definitions()
    }

    fn axes(&self) -> &[Axis] {
        self.font.axes()
    }

    fn axis_mappings(&self) -> &[AxisMapping] {
        self.font.axis_mappings()
    }

    fn named_instances(&self) -> &[NamedInstance] {
        self.font.named_instances()
    }

    fn sources(&self) -> &[Source] {
        self.font.sources()
    }

    fn default_source_id(&self) -> Option<SourceId> {
        self.font.default_source_id()
    }

    fn glyphs(&self) -> Vec<&Glyph> {
        self.font
            .glyphs()
            .into_iter()
            .filter(|glyph| self.kept.contains(glyph.name()))
            .collect()
    }

    fn glyph(&self, name: &str) -> Option<&Glyph> {
        self.kept
            .contains(name)
            .then(|| self.font.glyph(name))
            .flatten()
    }

    fn kerning(&self) -> &KerningData {
        &self.kerning
    }

    fn features(&self) -> &FeatureData {
        &self.features
    }

    fn guidelines(&self) -> &[Guideline] {
        self.font.guidelines()
    }

    fn lib(&self) -> &LibData {
        self.font.lib()
    }

    fn fontinfo_remainder(&self) -> &LibData {
        self.font.fontinfo_remainder()
    }

    fn data_files(&self) -> &BinaryData {
        self.font.data_files()
    }

    fn images(&self) -> &BinaryData {
        self.font.images()
    }
}
