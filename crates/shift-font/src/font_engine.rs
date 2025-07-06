use napi::{Error, Result, Status};
use napi_derive::napi;
use shift_core::{font::Font, font_loader::FontLoader};

use crate::types::JSMetrics;

#[napi]
pub struct FontEngine {
  font_loader: FontLoader,
  font: Font,
}

#[napi]
impl FontEngine {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      font_loader: FontLoader::new(),
      font: Font::default(),
    }
  }
}

#[napi]
impl FontEngine {
  #[napi]
  pub fn load_font(&mut self, path: String) -> Result<()> {
    self.font = self
      .font_loader
      .read_font(&path)
      .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to load font: {}", e)))?;
    Ok(())
  }

  #[napi]
  pub fn get_font_family(&self) -> &str {
    &self.font.metadata.family
  }

  #[napi]
  pub fn get_font_style(&self) -> &str {
    &self.font.metadata.style_name
  }

  #[napi]
  pub fn get_font_version(&self) -> i32 {
    self.font.metadata.version
  }

  #[napi]
  pub fn get_metrics(&self) -> JSMetrics {
    self.font.metrics.into()
  }

  #[napi]
  pub fn get_glyph_count(&self) -> u32 {
    self.font.glyphs.len() as u32
  }
}
