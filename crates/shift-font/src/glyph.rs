use serde::Serialize;

use crate::contour::Contour;

#[derive(Clone, Serialize)]
pub struct Glyph {
    name: String,
    contours: Vec<Contour>,
}

impl Glyph {
    pub fn new(name: String, contours: Vec<Contour>) -> Self {
        Self { name, contours }
    }

    pub fn get_name(&self) -> &str {
        &self.name
    }

    pub fn get_contours(&self) -> &Vec<Contour> {
        &self.contours
    }
}
