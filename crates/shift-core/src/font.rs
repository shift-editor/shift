use crate::{
  constants::DEFAULT_X_ADVANCE,
  glyph::{Glyph, SharedGlyph},
};
use std::collections::HashMap;

#[derive(Clone)]
pub struct FontMetadata {
  pub family: String,
  pub style_name: String,
  pub version: i32,
}

impl Default for FontMetadata {
  fn default() -> Self {
    Self {
      family: "Untitled Font".to_string(),
      style_name: "Regular".to_string(),
      version: 1,
    }
  }
}

#[derive(Clone, Copy)]
pub struct Metrics {
  pub units_per_em: f64,
  pub ascender: f64,
  pub descender: f64,
  pub cap_height: f64,
  pub x_height: f64,
}

impl Default for Metrics {
  fn default() -> Self {
    Metrics {
      units_per_em: 1000.0,
      ascender: 750.0,
      descender: -200.0,
      cap_height: 700.0,
      x_height: 500.0,
    }
  }
}

#[derive(Clone)]
pub struct Font {
  metadata: FontMetadata,
  metrics: Metrics,
  glyphs: HashMap<u32, SharedGlyph>,
}

impl Default for Font {
  fn default() -> Self {
    Self {
      metadata: FontMetadata::default(),
      metrics: Metrics::default(),
      glyphs: HashMap::new(),
    }
  }
}

impl Font {
  pub fn new(metadata: FontMetadata, metrics: Metrics, glyphs: HashMap<u32, SharedGlyph>) -> Self {
    Self {
      metadata,
      metrics,
      glyphs,
    }
  }

  pub fn get_metrics(&self) -> &Metrics {
    &self.metrics
  }

  pub fn get_metadata(&self) -> &FontMetadata {
    &self.metadata
  }

  pub fn set_new_metrics(&mut self, metrics: Metrics) {
    self.metrics = metrics;
  }

  pub fn set_new_metadata(&mut self, metadata: FontMetadata) {
    self.metadata = metadata;
  }

  pub fn get_glyph_count(&self) -> usize {
    self.glyphs.len()
  }

  pub fn get_glyphs(&self) -> &HashMap<u32, SharedGlyph> {
    &self.glyphs
  }

  pub fn get_glyph(&mut self, unicode: u32) -> SharedGlyph {
    self
      .glyphs
      .entry(unicode)
      .or_insert_with(|| Glyph::new("".to_string(), unicode, DEFAULT_X_ADVANCE))
      .clone()
  }
}
