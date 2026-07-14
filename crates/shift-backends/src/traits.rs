use crate::errors::FormatBackendResult;
use shift_font::{
    Axis, AxisMapping, BinaryData, FeatureData, Font, FontMetadata, FontMetrics, Glyph, GlyphName,
    Guideline, KerningData, LibData, NamedInstance, Source, SourceId,
};

pub trait FontView {
    fn metadata(&self) -> &FontMetadata;
    fn metrics(&self) -> &FontMetrics;
    fn axes(&self) -> &[Axis];
    fn axis_mappings(&self) -> &[AxisMapping];
    fn named_instances(&self) -> &[NamedInstance];
    fn sources(&self) -> &[Source];
    fn default_source_id(&self) -> Option<SourceId>;
    fn glyphs(&self) -> Vec<&Glyph>;
    fn glyph(&self, name: &str) -> Option<&Glyph>;
    fn kerning(&self) -> &KerningData;
    fn features(&self) -> &FeatureData;
    fn guidelines(&self) -> &[Guideline];
    fn lib(&self) -> &LibData;
    fn fontinfo_remainder(&self) -> &LibData;
    fn data_files(&self) -> &BinaryData;
    fn images(&self) -> &BinaryData;
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

    fn axis_mappings(&self) -> &[AxisMapping] {
        self.axis_mappings()
    }

    fn named_instances(&self) -> &[NamedInstance] {
        self.named_instances()
    }

    fn sources(&self) -> &[Source] {
        self.sources()
    }

    fn default_source_id(&self) -> Option<SourceId> {
        self.default_source_id()
    }

    fn glyphs(&self) -> Vec<&Glyph> {
        self.glyphs().collect()
    }

    fn glyph(&self, name: &str) -> Option<&Glyph> {
        self.glyph_by_name(name)
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

    fn fontinfo_remainder(&self) -> &LibData {
        self.fontinfo_remainder()
    }

    fn data_files(&self) -> &BinaryData {
        self.data_files()
    }

    fn images(&self) -> &BinaryData {
        self.images()
    }
}

pub trait FontReader: Send + Sync {
    fn load(&self, path: &str) -> FormatBackendResult<Font>;

    fn get_glyph(&self, font: &Font, name: &GlyphName) -> Option<Glyph> {
        font.glyph_by_name(name).cloned()
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
