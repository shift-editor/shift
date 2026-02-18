use std::collections::HashMap;
use std::path::Path;

use crate::binary::BytesFontAdaptor;
use shift_backends::glyphs::GlyphsReader;
use shift_backends::ufo::UfoReader;
use shift_backends::FontReader;
use shift_ir::Font;

#[derive(Hash, Eq, PartialEq)]
pub enum FontFormat {
    Ufo,
    Glyphs,
    Ttf,
    Otf,
}

pub trait FontAdaptor {
    fn read_font(&self, path: &str) -> Result<Font, String>;
    fn write_font(&self, font: &Font, path: &str) -> Result<(), String>;
}

struct UfoFontAdaptor;
struct GlyphsFontAdaptor;

impl FontAdaptor for UfoFontAdaptor {
    fn read_font(&self, path: &str) -> Result<Font, String> {
        UfoReader::new().load(path)
    }

    fn write_font(&self, font: &Font, path: &str) -> Result<(), String> {
        use shift_backends::ufo::UfoWriter;
        use shift_backends::FontWriter;
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

pub struct FontLoader {
    adaptors: HashMap<FontFormat, Box<dyn FontAdaptor>>,
}

impl Default for FontLoader {
    fn default() -> Self {
        Self::new()
    }
}

fn format_from_extension(ext: &str) -> Result<FontFormat, String> {
    match ext.to_ascii_lowercase().as_str() {
        "ufo" => Ok(FontFormat::Ufo),
        "glyphs" => Ok(FontFormat::Glyphs),
        "glyphspackage" => Ok(FontFormat::Glyphs),
        "ttf" => Ok(FontFormat::Ttf),
        "otf" => Ok(FontFormat::Otf),
        _ => Err(format!("Unsupported font format: {ext}")),
    }
}

fn extension_from_path(path: &Path) -> Result<&str, String> {
    path.extension()
        .ok_or_else(|| "File has no extension".to_string())?
        .to_str()
        .ok_or_else(|| "Invalid UTF-8 in extension".to_string())
}

impl FontLoader {
    pub fn new() -> Self {
        let mut adaptors: HashMap<FontFormat, Box<dyn FontAdaptor>> = HashMap::new();
        adaptors.insert(FontFormat::Ufo, Box::new(UfoFontAdaptor));
        adaptors.insert(FontFormat::Glyphs, Box::new(GlyphsFontAdaptor));
        adaptors.insert(FontFormat::Ttf, Box::new(BytesFontAdaptor));
        adaptors.insert(FontFormat::Otf, Box::new(BytesFontAdaptor));

        Self { adaptors }
    }

    pub fn available_formats(&self) -> Vec<&FontFormat> {
        self.adaptors.keys().collect()
    }

    pub fn read_font(&self, path: &str) -> Result<Font, String> {
        let path = Path::new(path);
        let ext = extension_from_path(path)?;
        let format = format_from_extension(ext)?;
        let adaptor = self.adaptors.get(&format).expect("all formats registered");
        adaptor.read_font(
            path.to_str()
                .ok_or_else(|| "Invalid UTF-8 in path".to_string())?,
        )
    }

    pub fn write_font(&self, font: &Font, path: &str) -> Result<(), String> {
        let path = Path::new(path);
        let ext = extension_from_path(path)?;
        let format = format_from_extension(ext)?;

        match format {
            FontFormat::Ufo => {}
            _ => return Err(format!("Unsupported font format for writing: {ext}")),
        }

        let adaptor = self.adaptors.get(&format).expect("all formats registered");
        adaptor.write_font(font, path.to_str().unwrap())
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
    fn extension_matching_is_case_insensitive() {
        assert!(matches!(format_from_extension("UFO"), Ok(FontFormat::Ufo)));
        assert!(matches!(
            format_from_extension("GLYPHS"),
            Ok(FontFormat::Glyphs)
        ));
        assert!(matches!(format_from_extension("OTF"), Ok(FontFormat::Otf)));
    }
}
