use std::collections::HashMap;
use std::path::Path;

use shift_ir::Font;

use crate::designspace::DesignspaceReader;
use crate::errors::{BackendError, BackendResult};
use crate::glyphs::GlyphsReader;
use crate::traits::{FontReader, FontWriter};
use crate::ufo::{UfoReader, UfoWriter};

use crate::binary::BytesFontAdaptor;

#[derive(Hash, Eq, PartialEq)]
pub enum FontFormat {
    Ufo,
    Glyphs,
    Designspace,
    Ttf,
    Otf,
}

impl FontFormat {
    fn name(&self) -> &'static str {
        match self {
            FontFormat::Ufo => "ufo",
            FontFormat::Glyphs => "glyphs",
            FontFormat::Designspace => "designspace",
            FontFormat::Ttf => "ttf",
            FontFormat::Otf => "otf",
        }
    }
}

pub trait FontAdaptor {
    fn read_font(&self, path: &str) -> Result<Font, String>;
    fn write_font(&self, font: &Font, path: &str) -> Result<(), String>;
}

struct UfoFontAdaptor;
struct GlyphsFontAdaptor;
struct DesignspaceFontAdaptor;

impl FontAdaptor for UfoFontAdaptor {
    fn read_font(&self, path: &str) -> Result<Font, String> {
        UfoReader::new().load(path)
    }

    fn write_font(&self, font: &Font, path: &str) -> Result<(), String> {
        UfoWriter::new().save(font, path)
    }
}

impl FontAdaptor for GlyphsFontAdaptor {
    fn read_font(&self, path: &str) -> Result<Font, String> {
        GlyphsReader::new().load(path)
    }

    fn write_font(&self, _font: &Font, _path: &str) -> Result<(), String> {
        Err("Glyphs writing is not supported; save as .ufo instead".to_string())
    }
}

impl FontAdaptor for DesignspaceFontAdaptor {
    fn read_font(&self, path: &str) -> Result<Font, String> {
        DesignspaceReader::new().load(path)
    }

    fn write_font(&self, _font: &Font, _path: &str) -> Result<(), String> {
        Err("Designspace writing is not supported; save as .ufo instead".to_string())
    }
}

pub struct FontLoader {
    adaptors: HashMap<FontFormat, Box<dyn FontAdaptor>>,
}

impl Default for FontLoader {
    fn default() -> Self {
        Self::new()
    }
}

fn format_from_extension(ext: &str) -> BackendResult<FontFormat> {
    match ext.to_ascii_lowercase().as_str() {
        "ufo" => Ok(FontFormat::Ufo),
        "glyphs" => Ok(FontFormat::Glyphs),
        "glyphspackage" => Ok(FontFormat::Glyphs),
        "designspace" => Ok(FontFormat::Designspace),
        "ttf" => Ok(FontFormat::Ttf),
        "otf" => Ok(FontFormat::Otf),
        _ => Err(BackendError::UnsupportedFormat(ext.to_string())),
    }
}

fn extension_from_path(path: &Path) -> BackendResult<&str> {
    path.extension()
        .ok_or(BackendError::MissingExtension)?
        .to_str()
        .ok_or(BackendError::InvalidExtensionUtf8)
}

impl FontLoader {
    pub fn new() -> Self {
        let mut adaptors: HashMap<FontFormat, Box<dyn FontAdaptor>> = HashMap::new();
        adaptors.insert(FontFormat::Ufo, Box::new(UfoFontAdaptor));
        adaptors.insert(FontFormat::Glyphs, Box::new(GlyphsFontAdaptor));
        adaptors.insert(FontFormat::Designspace, Box::new(DesignspaceFontAdaptor));
        adaptors.insert(FontFormat::Ttf, Box::new(BytesFontAdaptor));
        adaptors.insert(FontFormat::Otf, Box::new(BytesFontAdaptor));

        Self { adaptors }
    }

    pub fn available_formats(&self) -> Vec<&FontFormat> {
        self.adaptors.keys().collect()
    }

    pub fn read_font(&self, path: &str) -> BackendResult<Font> {
        let path = Path::new(path);
        let ext = extension_from_path(path)?;
        let format = format_from_extension(ext)?;
        let adaptor = self
            .adaptors
            .get(&format)
            .ok_or_else(|| BackendError::MissingAdaptor(format.name()))?;
        let path = path.to_str().ok_or(BackendError::InvalidPathUtf8)?;
        adaptor.read_font(path).map_err(BackendError::Load)
    }

    pub fn write_font(&self, font: &Font, path: &str) -> BackendResult<()> {
        let path = Path::new(path);
        let ext = extension_from_path(path)?;
        let format = format_from_extension(ext)?;

        match format {
            FontFormat::Ufo => {}
            _ => return Err(BackendError::UnsupportedWriteFormat(ext.to_string())),
        }

        let adaptor = self
            .adaptors
            .get(&format)
            .ok_or_else(|| BackendError::MissingAdaptor(format.name()))?;
        let path = path.to_str().ok_or(BackendError::InvalidPathUtf8)?;
        adaptor.write_font(font, path).map_err(BackendError::Save)
    }
}

#[cfg(test)]
mod tests {
    use super::{format_from_extension, FontFormat};

    #[test]
    fn supports_glyphs_extensions() {
        assert!(matches!(
            format_from_extension("glyphs"),
            Ok(FontFormat::Glyphs)
        ));
        assert!(matches!(
            format_from_extension("glyphspackage"),
            Ok(FontFormat::Glyphs)
        ));
    }

    #[test]
    fn supports_designspace_extension() {
        assert!(matches!(
            format_from_extension("designspace"),
            Ok(FontFormat::Designspace)
        ));
    }

    #[test]
    fn extension_matching_is_case_insensitive() {
        assert!(matches!(format_from_extension("UFO"), Ok(FontFormat::Ufo)));
        assert!(matches!(
            format_from_extension("GLYPHS"),
            Ok(FontFormat::Glyphs)
        ));
        assert!(matches!(format_from_extension("OTF"), Ok(FontFormat::Otf)));
        assert!(matches!(
            format_from_extension("DESIGNSPACE"),
            Ok(FontFormat::Designspace)
        ));
    }
}
