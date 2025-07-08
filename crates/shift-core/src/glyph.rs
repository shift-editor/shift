use std::{cell::RefCell, collections::HashMap, rc::Rc};

use crate::{contour::Contour, entity::ContourId};

#[derive(Clone)]
pub struct GlyphMetadata {
  pub name: String,
  pub unicode: u32,
  pub x_advance: f64,
}

pub type SharedGlyph = Rc<RefCell<Glyph>>;
#[derive(Clone)]
pub struct Glyph {
  metadata: GlyphMetadata,
  contours: HashMap<ContourId, Contour>,
}

impl Glyph {
  pub fn new(name: String, unicode: u32, x_advance: f64) -> SharedGlyph {
    let g = Self {
      metadata: GlyphMetadata {
        name,
        unicode,
        x_advance,
      },
      contours: HashMap::new(),
    };

    return Rc::new(RefCell::new(g));
  }

  pub fn from_contours(
    name: String,
    unicode: u32,
    x_advance: f64,
    contours: Vec<Contour>,
  ) -> SharedGlyph {
    let mut contours_map = HashMap::new();
    for contour in contours {
      contours_map.insert(contour.id(), contour);
    }

    let g = Self {
      metadata: GlyphMetadata {
        name,
        unicode,
        x_advance,
      },
      contours: contours_map,
    };

    return Rc::new(RefCell::new(g));
  }

  pub fn metadata(&self) -> &GlyphMetadata {
    &self.metadata
  }

  pub fn contours_count(&self) -> usize {
    self.contours.len()
  }

  pub fn contour(&self, id: ContourId) -> Option<&Contour> {
    self.contours.get(&id)
  }

  pub(crate) fn contours_mut(&mut self) -> &mut HashMap<ContourId, Contour> {
    &mut self.contours
  }

  pub(crate) fn contour_mut(&mut self, id: ContourId) -> Result<&mut Contour, String> {
    self
      .contours
      .get_mut(&id)
      .ok_or(format!("Contour with id {:?} not found", id))
  }
}
