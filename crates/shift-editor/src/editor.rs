use shift_font::font::Font;
use shift_font::font_service::FontService;

pub struct Editor {
    current_font: Option<Font>,
    font_service: FontService,
}

impl Editor {
    pub fn new() -> Self {
        let font_service = FontService::new();
        Self {
            current_font: None,
            font_service,
        }
    }

    pub fn current_font(&self) -> Option<&Font> {
        self.current_font.as_ref()
    }

    pub fn read_font(&mut self, path: &str) {
        let font = self
            .font_service
            .read_font(path)
            .expect("Failed to read font");

        self.current_font = Some(font);
    }
}
