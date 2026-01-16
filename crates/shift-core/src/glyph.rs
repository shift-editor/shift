use std::collections::HashMap;

use crate::{contour::Contour, entity::ContourId};

#[derive(Clone, Debug)]
pub struct GlyphMetadata {
    pub name: String,
    pub unicode: u32,
    pub x_advance: f64,
}

/// A glyph containing contours
///
/// Note: We no longer use Rc<RefCell<>> - the EditSession owns the glyph directly
/// during editing, and writes it back to the Font when the session ends.
#[derive(Clone)]
pub struct Glyph {
    metadata: GlyphMetadata,
    contours: HashMap<ContourId, Contour>,
}

impl Default for Glyph {
    fn default() -> Self {
        Self {
            metadata: GlyphMetadata {
                name: String::new(),
                unicode: 0,
                x_advance: 500.0,
            },
            contours: HashMap::new(),
        }
    }
}

impl Glyph {
    /// Create a new glyph with the given metadata
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

    /// Create a glyph with existing contours
    pub fn from_contours(
        name: String,
        unicode: u32,
        x_advance: f64,
        contours: Vec<Contour>,
    ) -> Self {
        let mut contours_map = HashMap::new();
        for contour in contours {
            contours_map.insert(contour.id(), contour);
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

    pub fn metadata(&self) -> &GlyphMetadata {
        &self.metadata
    }

    pub fn unicode(&self) -> u32 {
        self.metadata.unicode
    }

    pub fn name(&self) -> &str {
        &self.metadata.name
    }

    pub fn x_advance(&self) -> f64 {
        self.metadata.x_advance
    }

    pub fn contours_count(&self) -> usize {
        self.contours.len()
    }

    pub fn contour(&self, id: ContourId) -> Option<&Contour> {
        self.contours.get(&id)
    }

    /// Get all contours as a reference
    pub fn contours(&self) -> &HashMap<ContourId, Contour> {
        &self.contours
    }

    /// Get an iterator over all contours
    pub fn contours_iter(&self) -> impl Iterator<Item = &Contour> {
        self.contours.values()
    }

    pub(crate) fn contour_mut(&mut self, id: ContourId) -> Result<&mut Contour, String> {
        self.contours
            .get_mut(&id)
            .ok_or(format!("Contour with id {id:?} not found"))
    }

    /// Add a contour and return its ID
    pub fn add_contour(&mut self, contour: Contour) -> ContourId {
        let id = contour.id();
        self.contours.insert(id, contour);
        id
    }

    /// Remove a contour by ID
    pub fn remove_contour(&mut self, id: ContourId) -> Option<Contour> {
        self.contours.remove(&id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_glyph() {
        let glyph = Glyph::new("A".to_string(), 65, 500.0);
        assert_eq!(glyph.unicode(), 65);
        assert_eq!(glyph.name(), "A");
        assert_eq!(glyph.x_advance(), 500.0);
        assert_eq!(glyph.contours_count(), 0);
    }

    #[test]
    fn add_and_remove_contour() {
        let mut glyph = Glyph::new("A".to_string(), 65, 500.0);
        let contour = Contour::new();
        let id = contour.id();

        glyph.add_contour(contour);
        assert_eq!(glyph.contours_count(), 1);

        let removed = glyph.remove_contour(id);
        assert!(removed.is_some());
        assert_eq!(glyph.contours_count(), 0);
    }
}
