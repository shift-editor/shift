//! Where a line may break, by the Unicode line breaking algorithm.

use unicode_linebreak::{linebreaks, BreakOpportunity};

use crate::Unit;

/// Stands in for a glyph inserted by name: an inline object, which breaks
/// like an ideograph would around it.
const OBJECT_REPLACEMENT: char = '\u{FFFC}';

/// A place a line may, or must, break.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LineBreak {
    /// The unit the next line starts with. A break after the last unit is
    /// not reported.
    pub unit: u32,
    /// Whether the line must break here, as after a hard line break
    /// character; otherwise breaking is allowed but optional.
    pub mandatory: bool,
}

/// Returns the places a line of `units` may break, in order
/// ([UAX #14](https://www.unicode.org/reports/tr14/)).
///
/// Breaks fall after spaces and hyphens, between ideographs, and around
/// inserted glyphs, never inside a word. Trailing spaces stay on the line
/// they end: a break is reported before the next unit that is not a space.
/// Scripts that need a dictionary to find word boundaries, such as Thai, are
/// broken only where they have spaces.
pub fn line_breaks<G>(units: &[Unit<G>]) -> Vec<LineBreak> {
    let mut text = String::new();
    let mut unit_at_byte = Vec::with_capacity(units.len());
    for (index, unit) in units.iter().enumerate() {
        let character = match unit {
            Unit::Character(character) => *character,
            Unit::Glyph(_) => OBJECT_REPLACEMENT,
        };
        for _ in 0..character.len_utf8() {
            unit_at_byte.push(index);
        }
        text.push(character);
    }

    linebreaks(&text)
        .filter_map(|(byte, opportunity)| {
            let unit = *unit_at_byte.get(byte)?;
            Some(LineBreak {
                unit: u32::try_from(unit).ok()?,
                mandatory: opportunity == BreakOpportunity::Mandatory,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn breaks(text: &str) -> Vec<(u32, bool)> {
        let units: Vec<Unit<u32>> = text.chars().map(Unit::Character).collect();
        line_breaks(&units)
            .into_iter()
            .map(|line_break| (line_break.unit, line_break.mandatory))
            .collect()
    }

    #[test]
    fn breaks_after_spaces_before_the_next_word() {
        assert_eq!(breaks("set the type"), vec![(4, false), (8, false)]);
    }

    #[test]
    fn keeps_a_run_of_spaces_on_the_line_it_ends() {
        assert_eq!(breaks("a   b"), vec![(4, false)]);
    }

    #[test]
    fn breaks_after_a_hyphen() {
        assert_eq!(breaks("well-set"), vec![(5, false)]);
    }

    #[test]
    fn breaks_between_ideographs() {
        assert_eq!(breaks("漢字文"), vec![(1, false), (2, false)]);
    }

    #[test]
    fn a_hard_line_break_must_break() {
        assert_eq!(breaks("a\nb"), vec![(2, true)]);
    }

    #[test]
    fn an_inserted_glyph_breaks_like_an_inline_object() {
        let units = [Unit::Character('a'), Unit::Glyph(7), Unit::Character('b')];

        assert_eq!(
            line_breaks(&units),
            vec![
                LineBreak {
                    unit: 1,
                    mandatory: false
                },
                LineBreak {
                    unit: 2,
                    mandatory: false
                },
            ]
        );
    }

    #[test]
    fn counts_units_not_bytes() {
        assert_eq!(breaks("é ü"), vec![(2, false)]);
    }
}
