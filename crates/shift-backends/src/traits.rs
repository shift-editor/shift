use crate::errors::FormatBackendResult;
use shift_font::{
    Axis, FeatureData, Font, FontMetadata, FontMetrics, Glyph, GlyphName, Guideline, KerningData,
    Layer, LayerId, LibData, Source,
};

pub trait FontView {
    fn metadata(&self) -> &FontMetadata;
    fn metrics(&self) -> &FontMetrics;
    fn axes(&self) -> &[Axis];
    fn sources(&self) -> &[Source];
    fn layers(&self) -> Vec<(LayerId, &Layer)>;
    fn glyphs(&self) -> Vec<&Glyph>;
    fn glyph(&self, name: &str) -> Option<&Glyph>;
    fn kerning(&self) -> &KerningData;
    fn features(&self) -> &FeatureData;
    fn guidelines(&self) -> &[Guideline];
    fn lib(&self) -> &LibData;
    fn default_layer_id(&self) -> LayerId;
}

impl FontView for Font {
    fn metadata(&self) -> &FontMetadata {
        self.metadata()
    }

    fn metrics(&self) -> &FontMetrics {
        self.metrics()
    }

    fn axes(&self) -> &[Axis] {
        self.axes()
    }

    fn sources(&self) -> &[Source] {
        self.sources()
    }

    fn layers(&self) -> Vec<(LayerId, &Layer)> {
        self.layers()
            .iter()
            .map(|(layer_id, layer)| (*layer_id, layer))
            .collect()
    }

    fn glyphs(&self) -> Vec<&Glyph> {
        self.glyphs().values().map(|glyph| glyph.as_ref()).collect()
    }

    fn glyph(&self, name: &str) -> Option<&Glyph> {
        self.glyph(name)
    }

    fn kerning(&self) -> &KerningData {
        self.kerning()
    }

    fn features(&self) -> &FeatureData {
        self.features()
    }

    fn guidelines(&self) -> &[Guideline] {
        self.guidelines()
    }

    fn lib(&self) -> &LibData {
        self.lib()
    }

    fn default_layer_id(&self) -> LayerId {
        self.default_layer_id()
    }
}

pub trait FontReader: Send + Sync {
    fn load(&self, path: &str) -> FormatBackendResult<Font>;

    fn get_glyph(&self, font: &Font, name: &GlyphName) -> Option<Glyph> {
        font.glyph(name).cloned()
    }

    fn get_kerning(&self, font: &Font) -> KerningData {
        font.kerning().clone()
    }

    fn get_features(&self, font: &Font) -> FeatureData {
        font.features().clone()
    }
}

pub trait FontWriter: Send + Sync {
    fn save(&self, font: &Font, path: &str) -> FormatBackendResult<()>;
}

pub trait FontBackend: FontReader + FontWriter {}

impl<T: FontReader + FontWriter> FontBackend for T {}
