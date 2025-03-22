use serde::Serialize;
use ts_rs::TS;

use crate::contour::Contour;

#[derive(Clone, Serialize, TS)]
#[ts(export)]
pub struct Glyph {
    name: String,
    unicode: u32,
    contours: Vec<Contour>,
    x_advance: f64,
}

impl Glyph {
    pub fn new(name: String, unicode: u32, contours: Vec<Contour>, x_advance: f64) -> Self {
        Self {
            name,
            unicode,
            contours,
            x_advance,
        }
    }

    pub fn get_name(&self) -> &str {
        &self.name
    }

    pub fn get_contours(&self) -> &Vec<Contour> {
        &self.contours
    }
}
