//! A key for where a layout places everything, so readers can keep what
//! they drew from a layout when an edit moved nothing in the text.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use crate::{CaretStop, LayoutLine, LineRun, PlacedGlyph, TextLayout};

impl TextLayout {
    /// A key that two layouts share exactly when they place every line,
    /// run, glyph, unit and caret alike, up to a 64-bit hash collision.
    /// Glyph bounds are left out: an outline edit that moves nothing keeps
    /// the key. Numbers are compared by their bits.
    pub fn placement_key(&self) -> String {
        let mut hasher = DefaultHasher::new();
        for line in &self.lines {
            line.place(&mut hasher);
        }
        for glyph in &self.glyphs {
            glyph.place(&mut hasher);
        }
        for unit in &self.unit_glyphs {
            unit.glyphs.hash(&mut hasher);
        }
        for stop in &self.carets {
            stop.place(&mut hasher);
        }
        self.width.to_bits().hash(&mut hasher);
        self.unshaped.hash(&mut hasher);
        format!("{:016x}", hasher.finish())
    }
}

/// Feeds what places a value into a hasher.
trait Place {
    fn place(&self, hasher: &mut DefaultHasher);
}

impl Place for LayoutLine {
    fn place(&self, hasher: &mut DefaultHasher) {
        (self.paragraph, self.start, self.end).hash(hasher);
        for value in [
            self.baseline,
            self.ascent,
            self.descent,
            self.left,
            self.advance,
        ] {
            value.to_bits().hash(hasher);
        }
        self.direction.hash(hasher);
        for run in &self.runs {
            run.place(hasher);
        }
    }
}

impl Place for LineRun {
    fn place(&self, hasher: &mut DefaultHasher) {
        (self.start, self.end, self.level).hash(hasher);
        self.direction.hash(hasher);
        self.script.hash(hasher);
        (self.glyph_start, self.glyph_end).hash(hasher);
    }
}

impl Place for PlacedGlyph {
    fn place(&self, hasher: &mut DefaultHasher) {
        self.glyph_id.map(shift_font::GlyphId::as_str).hash(hasher);
        (self.start, self.end, self.line, self.is_mark).hash(hasher);
        for value in [
            self.left,
            self.baseline,
            self.x_offset,
            self.y_offset,
            self.advance,
            self.kern,
        ] {
            value.to_bits().hash(hasher);
        }
        self.direction.hash(hasher);
    }
}

impl Place for CaretStop {
    fn place(&self, hasher: &mut DefaultHasher) {
        (self.unit, self.line).hash(hasher);
        self.x.to_bits().hash(hasher);
        self.direction.hash(hasher);
        if let Some(secondary) = &self.secondary {
            secondary.x.to_bits().hash(hasher);
            secondary.direction.hash(hasher);
        }
    }
}
