use napi::{Error, Result, Status};
use napi_derive::napi;
use shift_core::{edit_session::EditSession, font::Font, font_loader::FontLoader};
use std::rc::Rc;

use crate::types::{JSFontMetaData, JSFontMetrics};

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
  pub fn get_metadata(&self) -> JSFontMetaData {
    self.font.get_metadata().clone().into()
  }

  #[napi]
  pub fn get_metrics(&self) -> JSFontMetrics {
    self.font.get_metrics().clone().into()
  }

  #[napi]
  pub fn get_glyph_count(&self) -> u32 {
    self.font.get_glyph_count() as u32
  }

  pub fn start_editing_glyph(&mut self, unicode: u32) -> EditSession {
    let glyph = self.font.get_glyph(unicode);
    return EditSession::new(Rc::clone(&glyph));
  }
}
