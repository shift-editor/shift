use std::path::PathBuf;

use shift_font::font::{Font, Metrics};
use shift_font::font_service::FontService;
use shift_font::glyph::Glyph;

pub struct Editor {
    font_path: PathBuf,
    current_font: Font,
    font_service: FontService,
}

impl Editor {
    pub fn new() -> Self {
        let font_service = FontService::new();
        Self {
            font_path: PathBuf::new(),
            current_font: Font::default(),
            font_service,
        }
    }

    pub fn current_font(&self) -> &Font {
        &self.current_font
    }

    pub fn font_path(&self) -> &PathBuf {
        &self.font_path
    }

    pub fn read_font(&mut self, path: &str) {
        let font = self
            .font_service
            .read_font(path)
            .expect("Failed to read font");

        self.current_font = font;
        self.font_path = PathBuf::from(path);
    }

    pub fn get_font_metrics(&self) -> Metrics {
        Metrics {
            units_per_em: self.current_font.metrics.units_per_em,
            ascender: self.current_font.metrics.ascender,
            descender: self.current_font.metrics.descender,
            cap_height: self.current_font.metrics.cap_height,
            x_height: self.current_font.metrics.x_height,
        }
    }

    pub fn get_glyph(&mut self, unicode: u32) -> &Glyph {
        self.current_font
            .glyphs
            .entry(unicode)
            .or_insert_with(|| Glyph::new(unicode.to_string(), unicode, vec![], 600.0))
    }
}
