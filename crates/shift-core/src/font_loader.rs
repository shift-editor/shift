use std::collections::HashMap;
use std::path::Path;

use crate::binary::BytesFontAdaptor;
use shift_backends::ufo::UfoReader;
use shift_backends::FontReader;
use shift_ir::Font;

#[derive(Hash, Eq, PartialEq)]
pub enum FontFormat {
    Ufo,
    Ttf,
    Otf,
}

pub trait FontAdaptor {
    fn read_font(&self, path: &str) -> Result<Font, String>;
    fn write_font(&self, font: &Font, path: &str) -> Result<(), String>;
}

struct UfoFontAdaptor;

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

pub struct FontLoader {
    file_name: String,
    adaptors: HashMap<FontFormat, Box<dyn FontAdaptor>>,
}

impl Default for FontLoader {
    fn default() -> Self {
        Self::new()
    }
}

impl FontLoader {
    pub fn new() -> Self {
        let mut adaptors: HashMap<FontFormat, Box<dyn FontAdaptor>> = HashMap::new();
        adaptors.insert(FontFormat::Ufo, Box::new(UfoFontAdaptor));
        adaptors.insert(FontFormat::Ttf, Box::new(BytesFontAdaptor));
        adaptors.insert(FontFormat::Otf, Box::new(BytesFontAdaptor));

        Self {
            file_name: String::new(),
            adaptors,
        }
    }

    pub fn available_formats(&self) -> Vec<&FontFormat> {
        self.adaptors.keys().collect()
    }

    pub fn read_font(&mut self, path: &str) -> Result<Font, String> {
        let path = Path::new(path);
        let extension = path
            .extension()
            .ok_or_else(|| "File has no extension".to_string())?
            .to_str()
            .ok_or_else(|| "Invalid UTF-8 in extension".to_string())?;

        let adaptor = match extension {
            "ufo" => self.adaptors.get(&FontFormat::Ufo).unwrap(),
            "ttf" => self.adaptors.get(&FontFormat::Ttf).unwrap(),
            "otf" => self.adaptors.get(&FontFormat::Otf).unwrap(),
            _ => {
                return Err(format!("Unsupported font format: {extension}"));
            }
        };

        let font = adaptor.read_font(path.to_str().unwrap())?;
        self.file_name = path.file_name().unwrap().to_str().unwrap().to_string();
        Ok(font)
    }
}
