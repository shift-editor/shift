use std::collections::HashMap;

use crate::glyph::Glyph;

pub struct FontMetadata {
    pub family: String,
}

pub struct Metrics {
    pub ascender: f32,
    pub descender: f32,
    pub cap_height: f32,
    pub x_height: f32,
}

pub struct Font {
    pub metadata: FontMetadata,
    pub glyphs: HashMap<char, Glyph>,
}
