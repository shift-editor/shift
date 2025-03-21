use std::collections::HashMap;
use std::path::Path;

use crate::font::Font;
use crate::ufo::UfoFontAdaptor;

#[derive(Hash, Eq, PartialEq)]
pub enum FontFormat {
    Ufo,
}

pub trait FontAdaptor: Send + Sync {
    fn extension(&self) -> &str;
    fn read_font(&self, path: &str) -> Result<Font, String>;
    fn write_font(&self, font: &Font, path: &str) -> Result<(), String>;
}

pub struct FontService {
    file_name: String,
    adaptors: HashMap<FontFormat, Box<dyn FontAdaptor>>,
}

impl FontService {
    pub fn new() -> Self {
        let mut adaptors: HashMap<FontFormat, Box<dyn FontAdaptor>> = HashMap::new();
        adaptors.insert(FontFormat::Ufo, Box::new(UfoFontAdaptor));

        Self {
            file_name: String::new(),
            adaptors,
        }
    }

    pub fn read_font(&mut self, path: &str) -> Result<Font, String> {
        let path = Path::new(path);
        let extension = path.extension().unwrap().to_str().unwrap();

        let adaptor = match extension {
            "ufo" => self.adaptors.get(&FontFormat::Ufo).unwrap(),
            _ => {
                return Err(format!("Unsupported font format: {}", extension));
            }
        };

        let font = adaptor.read_font(path.to_str().unwrap())?;
        self.file_name = path.file_name().unwrap().to_str().unwrap().to_string();
        Ok(font)
    }
}
