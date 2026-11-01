//! The words of laid-out text and their edges on screen, for moving the
//! caret a word at a time.

use std::ops::Range;

use unicode_segmentation::UnicodeSegmentation;

use crate::layout::paragraph::{Paragraph, ParagraphText};
use crate::layout::{Direction, LayoutWord, TextLayout};

impl Paragraph {
    /// The paragraph's words as unit ranges in the text: UAX #29 word
    /// segments that hold a letter, digit or the like, not spaces or
    /// punctuation, in reading order.
    pub(crate) fn words(&self) -> Vec<Range<u32>> {
        let text = ParagraphText::of(self);
        text.text
            .unicode_word_indices()
            .map(|(byte, word)| text.unit_at(byte)..text.unit_at(byte + word.len()))
            .collect()
    }
}

impl TextLayout {
    /// Each paragraph's words with the direction they read in, as the glyph
    /// showing a word's first unit is laid out, and their edges on screen.
    pub(crate) fn words_of(&self, paragraphs: &[Paragraph]) -> Vec<LayoutWord> {
        paragraphs
            .iter()
            .flat_map(Paragraph::words)
            .map(|units| {
                let direction = self.direction_of(units.start);
                let (left, right) = match direction {
                    Direction::Ltr => (units.start, units.end),
                    Direction::Rtl => (units.end, units.start),
                };
                LayoutWord {
                    start: units.start,
                    end: units.end,
                    direction,
                    left,
                    right,
                }
            })
            .collect()
    }

    /// The direction of the glyph that shows `unit`; left to right for a
    /// unit no glyph shows.
    fn direction_of(&self, unit: u32) -> Direction {
        self.unit_glyphs
            .get(crate::layout::slice_index(unit))
            .and_then(|shown| shown.glyphs.first())
            .and_then(|&glyph| self.glyphs.get(crate::layout::slice_index(glyph)))
            .map_or(Direction::Ltr, |glyph| glyph.direction)
    }
}
