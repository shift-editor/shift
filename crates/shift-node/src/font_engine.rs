use napi::{Error, Result, Status};
use napi_derive::napi;
use shift_core::{edit_session::EditSession, font::Font, font_loader::FontLoader};
use std::rc::Rc;

use crate::types::{JSFontMetaData, JSFontMetrics};

#[napi]
pub struct FontEngine {
  font_loader: FontLoader,
  current_edit_session: Option<EditSession>,
  font: Font,
}

#[napi]
impl FontEngine {
  #[napi(constructor)]
  pub fn new() -> Self {
    Self {
      font_loader: FontLoader::new(),
      current_edit_session: None,
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

  #[napi]
  pub fn start_edit_session(&mut self, unicode: u32) -> Result<()> {
    let glyph = self.font.get_glyph(unicode);
    let edit_session = EditSession::new(Rc::clone(&glyph));
    self.current_edit_session = Some(edit_session);
    Ok(())
  }

  fn get_edit_session(&mut self) -> Result<&mut EditSession> {
    self
      .current_edit_session
      .as_mut()
      .ok_or(Error::new(Status::GenericFailure, "No edit session"))
  }

  #[napi]
  pub fn end_edit_session(&mut self) {
    self.current_edit_session = None;
  }

  #[napi]
  pub fn add_empty_contour(&mut self) -> Result<u32> {
    let edit_session = self.get_edit_session()?;
    let contour_id = edit_session.add_empty_contour();
    Ok(contour_id.raw() as u32)
  }
}
