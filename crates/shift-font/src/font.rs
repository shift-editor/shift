use std::collections::HashMap;

use crate::glyph::Glyph;

pub struct Font {
    glyphs: HashMap<char, Glyph>,
}
