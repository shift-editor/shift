use napi::bindgen_prelude::*;
use napi_derive::napi;
use shift_core::{font::Font, font_loader::FontLoader};

#[napi]
pub struct FontService {
  font_loader: FontLoader,
  font: Font,
}

#[napi]
impl FontService {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      font_loader: FontLoader::new(),
      font: Font::default(),
    }
  }

  #[napi]
  pub fn load_font(&mut self, path: String) -> Result<()> {
    self.font = self
      .font_loader
      .read_font(&path)
      .map_err(|e| Error::new(Status::InvalidArg, format!("Failed to load font: {}", e)))?;
    Ok(())
  }

  #[napi]
  pub fn get_font_family(&self) -> String {
    self.font.metadata.family.clone()
  }

  #[napi]
  pub fn get_font_style(&self) -> String {
    self.font.metadata.style_name.clone()
  }

  #[napi]
  pub fn get_font_version(&self) -> i32 {
    self.font.metadata.version
  }

  #[napi]
  pub fn get_units_per_em(&self) -> f64 {
    self.font.metrics.units_per_em
  }

  #[napi]
  pub fn get_ascender(&self) -> f64 {
    self.font.metrics.ascender
  }

  #[napi]
  pub fn get_descender(&self) -> f64 {
    self.font.metrics.descender
  }

  #[napi]
  pub fn get_cap_height(&self) -> f64 {
    self.font.metrics.cap_height
  }

  #[napi]
  pub fn get_x_height(&self) -> f64 {
    self.font.metrics.x_height
  }

  #[napi]
  pub fn get_glyph_count(&self) -> u32 {
    self.font.glyphs.len() as u32
  }
}
