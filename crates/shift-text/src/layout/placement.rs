//! A key for where a layout places everything, so readers can keep what
//! they drew from a layout when an edit moved nothing in the text.

use std::collections::VecDeque;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use crate::layout::{CaretStop, LayoutLine, LineRun, PlacedGlyph, TextLayout};

/// How many recent distinct layouts [`PlacementKeys`] remembers.
const RECENT: usize = 64;

/// Gives each layout a placement key ([`TextLayout::placement`]) that two
/// layouts share only when they place every line, run, glyph, unit and
/// caret alike, glyph bounds aside: a hash finds a recent layout that may
/// match, and a full comparison confirms it, so a hash collision never
/// passes for a match.
///
/// A layout that matches none of the recent ones gets a new key, numbered
/// past every key given before, even when it matches one long forgotten.
pub struct PlacementKeys {
    hash: fn(&TextLayout) -> u64,
    /// Recent distinct layouts, bounds cleared, with their hash and key;
    /// oldest first.
    recent: VecDeque<KeyedLayout>,
    next: u64,
}

/// A layout [`PlacementKeys`] keyed.
struct KeyedLayout {
    hash: u64,
    layout: TextLayout,
    key: String,
}

impl Default for PlacementKeys {
    fn default() -> Self {
        Self::with_hash(TextLayout::placement_hash)
    }
}

impl PlacementKeys {
    /// Keys layouts by `hash`, which equal placements must share.
    pub(crate) fn with_hash(hash: fn(&TextLayout) -> u64) -> Self {
        Self {
            hash,
            recent: VecDeque::new(),
            next: 0,
        }
    }

    /// Sets `layout`'s placement key: a recent layout's when it places
    /// everything alike, else a new one.
    pub fn assign(&mut self, layout: &mut TextLayout) {
        let hash = (self.hash)(layout);
        let bare = layout.without_bounds();
        if let Some(known) = self
            .recent
            .iter()
            .find(|known| known.hash == hash && known.layout == bare)
        {
            layout.placement.clone_from(&known.key);
            return;
        }
        let key = format!("{hash:016x}-{}", self.next);
        self.next += 1;
        layout.placement.clone_from(&key);
        if self.recent.len() == RECENT {
            self.recent.pop_front();
        }
        self.recent.push_back(KeyedLayout {
            hash,
            layout: bare,
            key,
        });
    }
}

impl TextLayout {
    /// A hash of where the layout places every line, run, glyph, unit and
    /// caret, glyph bounds and its key aside; numbers by their bits.
    pub(crate) fn placement_hash(&self) -> u64 {
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
        hasher.finish()
    }

    /// The layout with no glyph bounds and no key: what placement compares.
    fn without_bounds(&self) -> Self {
        let mut bare = self.clone();
        bare.placement.clear();
        for glyph in &mut bare.glyphs {
            glyph.bounds = None;
        }
        bare
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
