use shift_font::Font;

use crate::{errors::FormatBackendResult, import::collect_streamed_font, traits::FontReader};

pub struct GlyphsReader;

impl GlyphsReader {
    pub fn new() -> Self {
        Self
    }
}

impl Default for GlyphsReader {
    fn default() -> Self {
        Self::new()
    }
}

impl FontReader for GlyphsReader {
    fn load(&self, path: &str) -> FormatBackendResult<Font> {
        let (header, mut stream) = super::stream_font(path)?;
        collect_streamed_font(header, &mut stream)
    }
}
