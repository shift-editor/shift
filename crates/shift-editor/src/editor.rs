use shift_font::font::{Font, Metrics};
use shift_font::font_service::FontService;
use shift_font::glyph::Glyph;

pub struct Editor {
    current_font: Font,
    font_service: FontService,
}

impl Editor {
    pub fn new() -> Self {
        let font_service = FontService::new();
        Self {
            current_font: Font::default(),
            font_service,
        }
    }

    pub fn current_font(&self) -> &Font {
        &self.current_font
    }

    pub fn read_font(&mut self, path: &str) {
        let font = self
            .font_service
            .read_font(path)
            .expect("Failed to read font");

        self.current_font = font;
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

    pub fn get_glyph(&mut self, char: char) -> &Glyph {
        self.current_font
            .glyphs
            .entry(char)
            .or_insert_with(|| Glyph::new(char.to_string(), char, vec![], 600.0))
    }
}
