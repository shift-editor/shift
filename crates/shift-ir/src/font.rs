use crate::axis::Axis;
use crate::entity::LayerId;
use crate::features::FeatureData;
use crate::glyph::Glyph;
use crate::guideline::Guideline;
use crate::kerning::KerningData;
use crate::layer::Layer;
use crate::lib_data::LibData;
use crate::metrics::FontMetrics;
use crate::source::Source;
use crate::GlyphName;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct FontMetadata {
    pub family_name: Option<String>,
    pub style_name: Option<String>,
    pub version_major: Option<i32>,
    pub version_minor: Option<i32>,
    pub copyright: Option<String>,
    pub trademark: Option<String>,
    pub designer: Option<String>,
    pub designer_url: Option<String>,
    pub manufacturer: Option<String>,
    pub manufacturer_url: Option<String>,
    pub license: Option<String>,
    pub license_url: Option<String>,
    pub description: Option<String>,
    pub note: Option<String>,
}

impl FontMetadata {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_names(family_name: String, style_name: String) -> Self {
        Self {
            family_name: Some(family_name),
            style_name: Some(style_name),
            ..Self::default()
        }
    }

    pub fn display_name(&self) -> String {
        match (&self.family_name, &self.style_name) {
            (Some(family), Some(style)) => format!("{family} {style}"),
            (Some(family), None) => family.clone(),
            (None, Some(style)) => style.clone(),
            (None, None) => "Untitled".to_string(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Font {
    metadata: FontMetadata,
    metrics: FontMetrics,
    axes: Vec<Axis>,
    sources: Vec<Source>,
    layers: HashMap<LayerId, Layer>,
    glyphs: HashMap<GlyphName, Glyph>,
    kerning: KerningData,
    features: FeatureData,
    guidelines: Vec<Guideline>,
    lib: LibData,
    default_layer_id: LayerId,
}

impl Default for Font {
    fn default() -> Self {
        let default_layer_id = LayerId::new();
        let mut layers = HashMap::new();
        layers.insert(default_layer_id, Layer::default_layer());

        Self {
            metadata: FontMetadata::default(),
            metrics: FontMetrics::default(),
            axes: Vec::new(),
            sources: Vec::new(),
            layers,
            glyphs: HashMap::new(),
            kerning: KerningData::new(),
            features: FeatureData::new(),
            guidelines: Vec::new(),
            lib: LibData::new(),
            default_layer_id,
        }
    }
}

impl Font {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn metadata(&self) -> &FontMetadata {
        &self.metadata
    }

    pub fn metadata_mut(&mut self) -> &mut FontMetadata {
        &mut self.metadata
    }

    pub fn metrics(&self) -> &FontMetrics {
        &self.metrics
    }

    pub fn metrics_mut(&mut self) -> &mut FontMetrics {
        &mut self.metrics
    }

    pub fn axes(&self) -> &[Axis] {
        &self.axes
    }

    pub fn add_axis(&mut self, axis: Axis) {
        self.axes.push(axis);
    }

    pub fn sources(&self) -> &[Source] {
        &self.sources
    }

    pub fn add_source(&mut self, source: Source) {
        self.sources.push(source);
    }

    pub fn is_variable(&self) -> bool {
        !self.axes.is_empty()
    }

    pub fn layers(&self) -> &HashMap<LayerId, Layer> {
        &self.layers
    }

    pub fn layer(&self, id: LayerId) -> Option<&Layer> {
        self.layers.get(&id)
    }

    pub fn layer_mut(&mut self, id: LayerId) -> Option<&mut Layer> {
        self.layers.get_mut(&id)
    }

    pub fn default_layer_id(&self) -> LayerId {
        self.default_layer_id
    }

    pub fn default_layer(&self) -> Option<&Layer> {
        self.layers.get(&self.default_layer_id)
    }

    pub fn add_layer(&mut self, layer: Layer) -> LayerId {
        let id = layer.id();
        self.layers.insert(id, layer);
        id
    }

    pub fn glyphs(&self) -> &HashMap<GlyphName, Glyph> {
        &self.glyphs
    }

    pub fn glyph(&self, name: &str) -> Option<&Glyph> {
        self.glyphs.get(name)
    }

    pub fn glyph_mut(&mut self, name: &str) -> Option<&mut Glyph> {
        self.glyphs.get_mut(name)
    }

    pub fn glyph_by_unicode(&self, unicode: u32) -> Option<&Glyph> {
        self.glyphs
            .values()
            .find(|g| g.unicodes().contains(&unicode))
    }

    pub fn glyph_by_unicode_mut(&mut self, unicode: u32) -> Option<&mut Glyph> {
        self.glyphs
            .values_mut()
            .find(|g| g.unicodes().contains(&unicode))
    }

    pub fn insert_glyph(&mut self, glyph: Glyph) {
        self.glyphs.insert(glyph.name().to_string(), glyph);
    }

    pub fn remove_glyph(&mut self, name: &str) -> Option<Glyph> {
        self.glyphs.remove(name)
    }

    pub fn glyph_count(&self) -> usize {
        self.glyphs.len()
    }

    pub fn take_glyph(&mut self, name: &str) -> Option<Glyph> {
        self.glyphs.remove(name)
    }

    pub fn put_glyph(&mut self, glyph: Glyph) {
        self.glyphs.insert(glyph.name().to_string(), glyph);
    }

    pub fn kerning(&self) -> &KerningData {
        &self.kerning
    }

    pub fn kerning_mut(&mut self) -> &mut KerningData {
        &mut self.kerning
    }

    pub fn features(&self) -> &FeatureData {
        &self.features
    }

    pub fn features_mut(&mut self) -> &mut FeatureData {
        &mut self.features
    }

    pub fn guidelines(&self) -> &[Guideline] {
        &self.guidelines
    }

    pub fn add_guideline(&mut self, guideline: Guideline) {
        self.guidelines.push(guideline);
    }

    pub fn lib(&self) -> &LibData {
        &self.lib
    }

    pub fn lib_mut(&mut self) -> &mut LibData {
        &mut self.lib
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::glyph::GlyphLayer;

    #[test]
    fn font_creation() {
        let font = Font::new();
        assert_eq!(font.glyph_count(), 0);
        assert!(font.default_layer().is_some());
    }

    #[test]
    fn font_glyph_operations() {
        let mut font = Font::new();
        let mut glyph = Glyph::with_unicode("A".to_string(), 65);
        let layer = GlyphLayer::with_width(600.0);
        glyph.set_layer(font.default_layer_id(), layer);

        font.insert_glyph(glyph);

        assert_eq!(font.glyph_count(), 1);
        assert!(font.glyph("A").is_some());
        assert!(font.glyph_by_unicode(65).is_some());
    }

    #[test]
    fn font_take_put_glyph() {
        let mut font = Font::new();
        font.insert_glyph(Glyph::with_unicode("A".to_string(), 65));

        let taken = font.take_glyph("A");
        assert!(taken.is_some());
        assert_eq!(font.glyph_count(), 0);

        font.put_glyph(taken.unwrap());
        assert_eq!(font.glyph_count(), 1);
    }
}
