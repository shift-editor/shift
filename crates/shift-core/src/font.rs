use crate::{constants::DEFAULT_X_ADVANCE, glyph::Glyph};
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

/// A font containing glyphs indexed by unicode codepoint.
///
/// The Font owns all glyph data directly (no Rc<RefCell<>>).
/// When editing a glyph, use `take_glyph` to extract it, modify it,
/// and `put_glyph` to return it.
#[derive(Clone)]
pub struct Font {
  metadata: FontMetadata,
  metrics: Metrics,
  glyphs: HashMap<u32, Glyph>,
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
  pub fn new(metadata: FontMetadata, metrics: Metrics, glyphs: HashMap<u32, Glyph>) -> Self {
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

  pub fn get_glyphs(&self) -> &HashMap<u32, Glyph> {
    &self.glyphs
  }

  /// Get a reference to a glyph by unicode codepoint
  pub fn get_glyph(&self, unicode: u32) -> Option<&Glyph> {
    self.glyphs.get(&unicode)
  }

  /// Get a mutable reference to a glyph by unicode codepoint
  pub fn get_glyph_mut(&mut self, unicode: u32) -> Option<&mut Glyph> {
    self.glyphs.get_mut(&unicode)
  }

  /// Take ownership of a glyph for editing.
  /// If the glyph doesn't exist, creates a new empty one.
  /// Returns the glyph, removing it from the font temporarily.
  pub fn take_glyph(&mut self, unicode: u32) -> Glyph {
    self.glyphs.remove(&unicode).unwrap_or_else(|| {
      Glyph::new(
        char::from_u32(unicode)
          .map(|c| c.to_string())
          .unwrap_or_default(),
        unicode,
        DEFAULT_X_ADVANCE,
      )
    })
  }

  /// Put a glyph back into the font after editing.
  pub fn put_glyph(&mut self, glyph: Glyph) {
    let unicode = glyph.unicode();
    self.glyphs.insert(unicode, glyph);
  }

  /// Insert a new glyph into the font
  pub fn insert_glyph(&mut self, glyph: Glyph) {
    let unicode = glyph.unicode();
    self.glyphs.insert(unicode, glyph);
  }

  /// Check if a glyph exists
  pub fn has_glyph(&self, unicode: u32) -> bool {
    self.glyphs.contains_key(&unicode)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn default_font() {
    let font = Font::default();
    assert_eq!(font.get_glyph_count(), 0);
    assert_eq!(font.get_metadata().family, "Untitled Font");
  }

  #[test]
  fn take_and_put_glyph() {
    let mut font = Font::default();

    // Take a non-existent glyph creates a new one
    let glyph = font.take_glyph(65); // 'A'
    assert_eq!(glyph.unicode(), 65);
    assert!(!font.has_glyph(65));

    // Put it back
    font.put_glyph(glyph);
    assert!(font.has_glyph(65));
    assert_eq!(font.get_glyph_count(), 1);
  }

  #[test]
  fn take_existing_glyph() {
    let mut font = Font::default();
    let glyph = Glyph::new("A".to_string(), 65, 600.0);
    font.insert_glyph(glyph);

    assert!(font.has_glyph(65));

    let taken = font.take_glyph(65);
    assert_eq!(taken.x_advance(), 600.0);
    assert!(!font.has_glyph(65));
  }

  #[test]
  fn get_glyph_mut() {
    let mut font = Font::default();
    let glyph = Glyph::new("A".to_string(), 65, 500.0);
    font.insert_glyph(glyph);

    // Can't mutate through get_glyph (immutable)
    let glyph_ref = font.get_glyph(65).unwrap();
    assert_eq!(glyph_ref.x_advance(), 500.0);
  }
}
