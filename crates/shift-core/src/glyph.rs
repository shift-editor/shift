use std::collections::HashMap;

use crate::{contour::Contour, entity::ContourId};

#[derive(Clone)]
pub struct GlyphMetadata {
  pub name: String,
  pub unicode: u32,
  pub x_advance: f64,
}

#[derive(Clone)]
pub struct Glyph {
  metadata: GlyphMetadata,
  contours: HashMap<ContourId, Contour>,
}

impl Glyph {
  pub fn new(name: String, unicode: u32, x_advance: f64) -> Self {
    Self {
      metadata: GlyphMetadata {
        name,
        unicode,
        x_advance,
      },
      contours: HashMap::new(),
    }
  }

  pub fn from_contours(name: String, unicode: u32, x_advance: f64, contours: Vec<Contour>) -> Self {
    let mut contours_map = HashMap::new();
    for contour in contours {
      contours_map.insert(contour.get_id(), contour);
    }

    Self {
      metadata: GlyphMetadata {
        name,
        unicode,
        x_advance,
      },
      contours: contours_map,
    }
  }

  pub fn get_metadata(&self) -> &GlyphMetadata {
    &self.metadata
  }

  pub fn get_contours_count(&self) -> usize {
    self.contours.len()
  }

  pub fn get_contours(&self) -> Vec<&Contour> {
    self.contours.values().collect()
  }
}
