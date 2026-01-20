use shift_ir::{FeatureData, Font, Glyph, GlyphName, KerningData};

pub trait FontReader: Send + Sync {
    fn load(&self, path: &str) -> Result<Font, String>;

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
    fn save(&self, font: &Font, path: &str) -> Result<(), String>;
}

pub trait FontBackend: FontReader + FontWriter {}

impl<T: FontReader + FontWriter> FontBackend for T {}
