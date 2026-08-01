mod reader;

use crate::errors::{FormatBackendError, FormatBackendResult};
use crate::font_loader::FontAdaptor;
use crate::import::GlyphStream;
use shift_font::Font;

pub struct BytesFontAdaptor;

impl FontAdaptor for BytesFontAdaptor {
    fn read_font(&self, path: &str) -> FormatBackendResult<Font> {
        reader::read_font_file(path)
    }

    fn write_font(&self, _font: &Font, _path: &str) -> FormatBackendResult<()> {
        Err(FormatBackendError::WriteUnsupported)
    }

    fn stream(&self, path: &str) -> FormatBackendResult<Option<(Font, Box<dyn GlyphStream>)>> {
        let (header, stream) = reader::stream_font_file(path)?;
        Ok(Some((header, Box::new(stream))))
    }
}
