mod geometry;
mod inputs;
mod metrics;
mod reader;
mod source;
mod tables;
mod variable;

pub use inputs::build_binary_atlas_page;
pub use source::OpenTypeFont;

use crate::errors::{FormatBackendError, FormatBackendResult};
use crate::font_loader::FontAdaptor;
use crate::import::PreparedImport;
use crate::ImportReport;
use shift_font::Font;
use skrifa::string::StringId;
use skrifa::{FontRef, MetadataProvider};

pub struct BytesFontAdaptor;

pub(crate) fn localized_string(font: &FontRef<'_>, id: StringId) -> Option<String> {
    font.localized_strings(id)
        .english_or_first()
        .map(|string| string.to_string())
        .filter(|string| !string.is_empty())
}

impl FontAdaptor for BytesFontAdaptor {
    fn read_font(&self, path: &str) -> FormatBackendResult<Font> {
        reader::read_font_file(path)
    }

    fn write_font(&self, _font: &Font, _path: &str) -> FormatBackendResult<()> {
        Err(FormatBackendError::WriteUnsupported)
    }

    fn stream(&self, path: &str) -> FormatBackendResult<Option<PreparedImport>> {
        let (header, stream) = reader::stream_font_file(path)?;
        Ok(Some((header, Box::new(stream), ImportReport::default())))
    }
}
