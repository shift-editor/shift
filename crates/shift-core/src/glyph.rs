use std::collections::HashMap;

use crate::{contour::Contour, entity::ContourId};

pub struct Glyph {
  name: String,
  unicode: u32,
  contours: HashMap<ContourId, Contour>,
  x_advance: f64,
}

impl Glyph {
  pub fn new(name: String, unicode: u32, x_advance: f64) -> Self {
    Self {
      name,
      unicode,
      contours: HashMap::new(),
      x_advance,
    }
  }

  pub fn get_name(&self) -> &str {
    &self.name
  }

  pub fn get_contours_count(&self) -> usize {
    self.contours.len()
  }

  pub fn get_unicode(&self) -> u32 {
    self.unicode
  }

  pub fn get_x_advance(&self) -> f64 {
    self.x_advance
  }
}
