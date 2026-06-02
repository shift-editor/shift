mod reader;

use crate::errors::{FormatBackendError, FormatBackendResult};
use crate::font_loader::FontAdaptor;
use shift_font::Font;

pub struct BytesFontAdaptor;

impl FontAdaptor for BytesFontAdaptor {
    fn read_font(&self, path: &str) -> FormatBackendResult<Font> {
        reader::read_font_file(path)
    }

    fn write_font(&self, _font: &Font, _path: &str) -> FormatBackendResult<()> {
        Err(FormatBackendError::WriteUnsupported)
    }
}
