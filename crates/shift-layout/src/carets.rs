//! Where the caret goes at each grapheme boundary.

use std::collections::BTreeSet;

use shift_shape::Unit;
use unicode_segmentation::UnicodeSegmentation;

use crate::font::LayoutFont;
use crate::paragraph::Paragraph;
use crate::{CaretStop, Direction, LayoutLine, PlacedGlyph, SecondaryCaret, TextLayout};

/// What a glyph inserted by name reads as when finding graphemes: an inline
/// object, a grapheme of its own.
const OBJECT_REPLACEMENT: char = '\u{FFFC}';

/// The prefix of a ligature's caret anchors, `caret_1`, `caret_2`, which
/// export compiles into `GDEF` ligature carets.
const CARET_ANCHOR_PREFIX: &str = "caret_";

/// Finds caret stops over a laid-out text.
pub(crate) struct Carets<'f, 'l, 'a> {
    font: &'f LayoutFont<'a>,
    layout: &'l TextLayout,
}

impl<'f, 'l, 'a> Carets<'f, 'l, 'a> {
    pub(crate) fn new(font: &'f LayoutFont<'a>, layout: &'l TextLayout) -> Self {
        Self { font, layout }
    }

    /// A stop at each grapheme boundary of each line, in logical order.
    pub(crate) fn stops(&self, paragraphs: &[Paragraph]) -> Vec<CaretStop> {
        let boundaries: Vec<BTreeSet<u32>> = paragraphs
            .iter()
            .map(Paragraph::grapheme_boundaries)
            .collect();
        let mut stops = Vec::new();
        for (number, line) in (0u32..).zip(&self.layout.lines) {
            let Some(paragraph) = usize::try_from(line.paragraph)
                .ok()
                .and_then(|index| paragraphs.get(index))
            else {
                continue;
            };
            let Some(boundaries) = usize::try_from(line.paragraph)
                .ok()
                .and_then(|index| boundaries.get(index))
            else {
                continue;
            };
            let text_end = line.end.min(paragraph.end);
            for &boundary in boundaries.range(line.start..=text_end) {
                stops.push(self.stop(number, line, boundary, text_end, boundaries));
            }
        }
        stops
    }

    /// The stop at `boundary` on `line`, whose text ends at `text_end`.
    fn stop(
        &self,
        number: u32,
        line: &LayoutLine,
        boundary: u32,
        text_end: u32,
        boundaries: &BTreeSet<u32>,
    ) -> CaretStop {
        let after = (boundary < text_end)
            .then(|| self.glyph_for(number, boundary))
            .flatten();
        let before = (boundary > line.start)
            .then(|| self.glyph_for(number, boundary - 1))
            .flatten();
        let trailing = before.map(|glyph| SecondaryCaret {
            x: self.edge(glyph, boundary, boundaries),
            direction: glyph.direction,
        });
        let (x, direction) = match (after, trailing) {
            (Some(glyph), _) => (self.edge(glyph, boundary, boundaries), glyph.direction),
            (None, Some(trailing)) => (trailing.x, trailing.direction),
            (None, None) => (line.left, line.direction),
        };
        let secondary =
            trailing.filter(|trailing| after.is_some() && trailing.direction != direction);
        CaretStop {
            unit: boundary,
            line: number,
            x,
            direction,
            secondary,
        }
    }

    /// The glyph that shows `unit` on line `number`: its widest, so a
    /// character the font decomposes into a body and a dot answers with the
    /// body.
    fn glyph_for(&self, number: u32, unit: u32) -> Option<&'l PlacedGlyph> {
        let shown = self.layout.unit_glyphs.get(usize::try_from(unit).ok()?)?;
        shown
            .glyphs
            .iter()
            .filter_map(|&index| self.layout.glyphs.get(usize::try_from(index).ok()?))
            .filter(|glyph| glyph.line == number)
            .max_by(|first, second| first.advance.total_cmp(&second.advance))
    }

    /// Where `boundary`, at or inside `glyph`'s units, falls on screen: an
    /// edge of its advance box, or inside a ligature at the ligature's
    /// caret anchor (`caret_N`, as export compiles `GDEF` ligature carets),
    /// or an even share of its advance per grapheme.
    fn edge(&self, glyph: &PlacedGlyph, boundary: u32, boundaries: &BTreeSet<u32>) -> f64 {
        let inside: Vec<u32> = boundaries
            .range(glyph.start + 1..glyph.end)
            .copied()
            .collect();
        let graphemes = inside.len() + 1;
        let read = if boundary <= glyph.start {
            0.0
        } else if boundary >= glyph.end {
            glyph.advance
        } else {
            let component = inside.iter().take_while(|&&at| at <= boundary).count();
            match self.ligature_caret(glyph, component, graphemes) {
                Some(x) => return glyph.left + x,
                None => glyph.advance * share(component, graphemes),
            }
        };
        match glyph.direction {
            Direction::Ltr => glyph.left + read,
            Direction::Rtl => glyph.left + glyph.advance - read,
        }
    }

    /// Where the ligature's caret after its `component`th component (from
    /// 1, in reading order) is, from its pen position, when it has a caret
    /// anchor for each of its `graphemes - 1` boundaries.
    fn ligature_caret(
        &self,
        glyph: &PlacedGlyph,
        component: usize,
        graphemes: usize,
    ) -> Option<f64> {
        let anchors = self.font.anchors(glyph.glyph_id?)?;
        let mut carets: Vec<f64> = anchors
            .anchors
            .iter()
            .filter(|anchor| {
                anchor
                    .name
                    .strip_prefix(CARET_ANCHOR_PREFIX)
                    .is_some_and(|index| index.parse::<u32>().is_ok())
            })
            .map(|anchor| anchor.x)
            .collect();
        if carets.len() + 1 != graphemes {
            return None;
        }
        carets.sort_by(f64::total_cmp);
        let index = match glyph.direction {
            Direction::Ltr => component.checked_sub(1)?,
            Direction::Rtl => carets.len().checked_sub(component)?,
        };
        carets.get(index).copied()
    }
}

/// `part` of `whole`, as a fraction.
fn share(part: usize, whole: usize) -> f64 {
    let part = u32::try_from(part).unwrap_or(u32::MAX);
    let whole = u32::try_from(whole).unwrap_or(u32::MAX).max(1);
    f64::from(part) / f64::from(whole)
}

impl Paragraph {
    /// The paragraph's grapheme boundaries as unit indices in the text, its
    /// start and end included.
    fn grapheme_boundaries(&self) -> BTreeSet<u32> {
        let text: String = self
            .units
            .iter()
            .map(|unit| match unit {
                Unit::Character(character) => *character,
                Unit::Glyph(_) => OBJECT_REPLACEMENT,
            })
            .collect();
        // Each unit is one char, so a char's index is its unit's.
        let mut unit_at_byte = vec![0u32; text.len() + 1];
        for (unit, (byte, _)) in (0u32..).zip(text.char_indices()) {
            unit_at_byte[byte] = unit;
        }
        let mut boundaries: BTreeSet<u32> = text
            .grapheme_indices(true)
            .map(|(byte, _)| self.start + unit_at_byte[byte])
            .collect();
        boundaries.insert(self.start);
        boundaries.insert(self.end);
        boundaries
    }
}
