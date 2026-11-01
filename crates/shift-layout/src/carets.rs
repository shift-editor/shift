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
            let first = stops.len();
            for &boundary in boundaries.range(line.start..=text_end) {
                stops.push(self.stop(number, line, boundary, text_end, boundaries));
            }
            if let Some(line_stops) = stops.get_mut(first..) {
                self.order_on_screen(line_stops, number, line, text_end);
            }
        }
        stops
    }

    /// Numbers one line's caret places left to right: each stop's
    /// ([`CaretStop::screen`]) and, at a direction boundary, its second
    /// place's ([`SecondaryCaret::screen`]), in one sequence. By `x`, then by
    /// where the glyph the place is an edge of is drawn (the glyph after a
    /// stop, the one before a second place; the line's end last left to
    /// right and first right to left), then in logical order.
    fn order_on_screen(
        &self,
        stops: &mut [CaretStop],
        number: u32,
        line: &LayoutLine,
        text_end: u32,
    ) {
        let line_end = match line.direction {
            Direction::Ltr => i64::MAX,
            Direction::Rtl => -1,
        };
        let drawn = |unit: Option<u32>| {
            unit.and_then(|unit| self.glyph_index_for(number, unit))
                .map_or(line_end, i64::from)
        };
        let mut places: Vec<ScreenPlace> = Vec::new();
        for (index, stop) in stops.iter().enumerate() {
            places.push(ScreenPlace {
                x: stop.x,
                drawn: drawn((stop.unit < text_end).then_some(stop.unit)),
                stop: index,
                edge: PlaceEdge::Stop,
            });
            if let Some(secondary) = &stop.secondary {
                places.push(ScreenPlace {
                    x: secondary.x,
                    drawn: drawn(stop.unit.checked_sub(1)),
                    stop: index,
                    edge: PlaceEdge::Second,
                });
            }
        }
        // A stable sort: places that also meet in drawing order keep their
        // logical order.
        places.sort_by(|first, second| {
            first
                .x
                .total_cmp(&second.x)
                .then(first.drawn.cmp(&second.drawn))
        });
        for (screen, place) in (0u32..).zip(places) {
            let Some(stop) = stops.get_mut(place.stop) else {
                continue;
            };
            match (&mut stop.secondary, place.edge) {
                (Some(secondary), PlaceEdge::Second) => secondary.screen = screen,
                _ => stop.screen = screen,
            }
        }
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
            screen: 0,
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
            screen: 0,
        }
    }

    /// The glyph that shows `unit` on line `number`: its widest, so a
    /// character the font decomposes into a body and a dot answers with the
    /// body.
    fn glyph_for(&self, number: u32, unit: u32) -> Option<&'l PlacedGlyph> {
        let index = self.glyph_index_for(number, unit)?;
        self.layout.glyphs.get(crate::slice_index(index))
    }

    /// The index in [`TextLayout::glyphs`] of the glyph [`Self::glyph_for`]
    /// answers with.
    fn glyph_index_for(&self, number: u32, unit: u32) -> Option<u32> {
        let shown = self.layout.unit_glyphs.get(crate::slice_index(unit))?;
        let layout = self.layout;
        shown
            .glyphs
            .iter()
            .filter_map(|&index| Some((index, layout.glyphs.get(crate::slice_index(index))?)))
            .filter(|(_, glyph)| glyph.line == number)
            .max_by(|(_, first), (_, second)| first.advance.total_cmp(&second.advance))
            .map(|(index, _)| index)
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

/// One caret place on a line, as [`Carets::order_on_screen`] sorts them.
struct ScreenPlace {
    x: f64,
    /// Where the glyph it is an edge of is drawn, by index in
    /// [`TextLayout::glyphs`].
    drawn: i64,
    /// Its stop, by index among the line's stops.
    stop: usize,
    edge: PlaceEdge,
}

/// Which of a stop's places a [`ScreenPlace`] is.
#[derive(Clone, Copy)]
enum PlaceEdge {
    /// The stop's own `x`.
    Stop,
    /// Its second place, at a direction boundary.
    Second,
}
