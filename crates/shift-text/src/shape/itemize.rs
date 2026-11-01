//! Splits a paragraph into runs of one script and one bidi level for
//! shaping, and orders runs for display.

use std::ops::Range;

use unicode_bidi::{BidiInfo, Level};
use unicode_script::{Script, UnicodeScript};

use crate::shape::{TextDirection, Unit};

/// What a glyph inserted by name reads as for bidi: an inline object,
/// neutral to the text around it.
const OBJECT_REPLACEMENT: char = '\u{FFFC}';

/// A stretch of a paragraph's units in one script and one bidi level.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextRun {
    pub units: Range<usize>,
    /// The run's ISO 15924 script tag, such as `Arab`; `None` when the run
    /// holds only characters common to all scripts.
    pub script: Option<&'static str>,
    /// The run's resolved bidi level; odd levels read right to left.
    pub level: u8,
}

impl TextRun {
    /// Returns the direction the run's level reads in.
    pub fn direction(&self) -> TextDirection {
        TextDirection::of_level(self.level)
    }
}

/// A paragraph split for shaping.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Itemized {
    /// The paragraph's base direction: the one asked for, else its first
    /// strong character's (UAX #9 rules P2 and P3), else left to right.
    pub direction: TextDirection,
    /// Runs in logical order; [`visual_order`] orders a line's runs for
    /// display.
    pub runs: Vec<TextRun>,
}

/// Splits a paragraph where its bidi level or script changes, reading it in
/// `base` direction, or in its first strong character's when `base` is
/// `None`.
///
/// Levels follow the Unicode Bidirectional Algorithm, including the
/// whitespace rule for a line's end (L1) with the paragraph as one line;
/// glyphs inserted by name read as an inline object (U+FFFC). Units common
/// to all scripts keep their own level, so digits inside Arabic become their
/// own left-to-right run. Levels split first and scripts within each level,
/// so a space between two directions takes the script of the text it reads
/// with.
pub fn itemize<G>(units: &[Unit<G>], base: Option<TextDirection>) -> Itemized {
    let text: String = units.iter().map(bidi_character).collect();
    let base_level = base.map(|direction| match direction {
        TextDirection::LeftToRight => Level::ltr(),
        TextDirection::RightToLeft => Level::rtl(),
    });
    let bidi = BidiInfo::new(&text, base_level);
    let direction = bidi.paragraphs.first().map_or_else(
        || base.unwrap_or(TextDirection::LeftToRight),
        |paragraph| TextDirection::of_level(paragraph.level.number()),
    );
    // `text` holds one char per unit, so its char indices are unit indices.
    let levels: Vec<Level> = bidi
        .paragraphs
        .iter()
        .flat_map(|paragraph| bidi.reordered_levels_per_char(paragraph, paragraph.range.clone()))
        .collect();

    let mut runs = Vec::new();
    let mut start = 0;
    for index in 1..=units.len() {
        if index < units.len() && levels[index] == levels[start] {
            continue;
        }
        runs.extend(
            script_runs(&units[start..index])
                .into_iter()
                .map(|run| TextRun {
                    units: start + run.units.start..start + run.units.end,
                    script: run.script.map(Script::short_name),
                    level: levels[start].number(),
                }),
        );
        start = index;
    }
    Itemized { direction, runs }
}

/// Orders runs for display by their bidi levels (UAX #9 rule L2): the
/// returned indices into `levels` read left to right on screen.
///
/// Apply it to the runs of one line: an English word inside Arabic then
/// sits left of the Arabic that precedes it.
pub fn visual_order(levels: &[u8]) -> Vec<usize> {
    let levels: Vec<Level> = levels
        .iter()
        .map(|&level| Level::new(level).unwrap_or_else(|_| Level::ltr()))
        .collect();
    BidiInfo::reorder_visual(&levels)
}

fn bidi_character<G>(unit: &Unit<G>) -> char {
    match unit {
        Unit::Character(character) => *character,
        Unit::Glyph(_) => OBJECT_REPLACEMENT,
    }
}

/// A stretch of a paragraph's units in one script.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ScriptRun {
    pub units: Range<usize>,
    /// `None` when every unit in the run is common to all scripts, such as
    /// digits, spaces, and punctuation on their own.
    pub script: Option<Script>,
}

/// Splits units where their script changes.
///
/// Units common to all scripts (spaces, digits, punctuation), combining marks,
/// and glyphs inserted by name join the run around them: the preceding run,
/// or the following one at the start of the paragraph.
fn script_runs<G>(units: &[Unit<G>]) -> Vec<ScriptRun> {
    let mut runs = Vec::new();
    let mut start = 0;
    let mut current: Option<Script> = None;

    for (index, unit) in units.iter().enumerate() {
        let Some(script) = specific_script(unit) else {
            continue;
        };
        match current {
            None => current = Some(script),
            Some(previous) if previous != script => {
                runs.push(ScriptRun {
                    units: start..index,
                    script: current,
                });
                start = index;
                current = Some(script);
            }
            Some(_) => {}
        }
    }

    if start < units.len() {
        runs.push(ScriptRun {
            units: start..units.len(),
            script: current,
        });
    }
    runs
}

/// Returns the script a unit belongs to, or `None` when it takes the script
/// of its neighbours.
fn specific_script<G>(unit: &Unit<G>) -> Option<Script> {
    match unit {
        Unit::Character(character) => match character.script() {
            Script::Common | Script::Inherited | Script::Unknown => None,
            script => Some(script),
        },
        Unit::Glyph(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runs(text: &str) -> Vec<(Range<usize>, Option<Script>)> {
        let units: Vec<Unit<u32>> = text.chars().map(Unit::Character).collect();
        script_runs(&units)
            .into_iter()
            .map(|run| (run.units, run.script))
            .collect()
    }

    #[test]
    fn splits_where_the_script_changes() {
        assert_eq!(
            runs("abc سلام"),
            vec![(0..4, Some(Script::Latin)), (4..8, Some(Script::Arabic))]
        );
    }

    #[test]
    fn leading_common_characters_join_the_first_script() {
        assert_eq!(runs("12 سلام"), vec![(0..7, Some(Script::Arabic))]);
    }

    #[test]
    fn a_combining_mark_stays_with_its_base() {
        assert_eq!(runs("بَ"), vec![(0..2, Some(Script::Arabic))]);
    }

    #[test]
    fn a_paragraph_of_common_characters_has_no_script() {
        assert_eq!(runs("1, 2"), vec![(0..4, None)]);
    }

    #[test]
    fn an_empty_paragraph_has_no_runs() {
        assert_eq!(runs(""), vec![]);
    }

    /// Each run's units and level, in display order, and the base direction.
    fn displayed(text: &str) -> (TextDirection, Vec<(Range<usize>, u8)>) {
        let units: Vec<Unit<u32>> = text.chars().map(Unit::Character).collect();
        let itemized = itemize(&units, None);
        let levels: Vec<u8> = itemized.runs.iter().map(|run| run.level).collect();
        let runs = visual_order(&levels)
            .into_iter()
            .map(|index| {
                let run = &itemized.runs[index];
                (run.units.clone(), run.level)
            })
            .collect();
        (itemized.direction, runs)
    }

    #[test]
    fn an_arabic_paragraph_puts_an_english_word_left_of_the_arabic_before_it() {
        assert_eq!(
            displayed("من hello دوست"),
            (
                TextDirection::RightToLeft,
                vec![(8..13, 1), (3..8, 2), (0..3, 1)]
            )
        );
    }

    #[test]
    fn digits_inside_arabic_read_left_to_right_left_of_the_arabic() {
        assert_eq!(
            displayed("سال 2024"),
            (TextDirection::RightToLeft, vec![(4..8, 2), (0..4, 1)])
        );
    }

    #[test]
    fn an_english_paragraph_keeps_arabic_words_together_in_place() {
        assert_eq!(
            displayed("I said سلام دوست today"),
            (
                TextDirection::LeftToRight,
                vec![(0..7, 0), (7..16, 1), (16..22, 0)]
            )
        );
    }

    #[test]
    fn a_paragraph_with_no_strong_character_reads_left_to_right() {
        assert_eq!(
            displayed("12, 34"),
            (TextDirection::LeftToRight, vec![(0..6, 0)])
        );
    }

    #[test]
    fn a_base_direction_overrides_the_first_strong_character() {
        let units: Vec<Unit<u32>> = "abc".chars().map(Unit::Character).collect();
        let itemized = itemize(&units, Some(TextDirection::RightToLeft));

        assert_eq!(itemized.direction, TextDirection::RightToLeft);
        assert_eq!(itemized.runs[0].level, 2);
    }

    #[test]
    fn an_empty_paragraph_reads_in_its_base_direction() {
        let units: Vec<Unit<u32>> = Vec::new();

        assert_eq!(
            itemize(&units, Some(TextDirection::RightToLeft)).direction,
            TextDirection::RightToLeft
        );
    }

    #[test]
    fn runs_come_back_in_logical_order() {
        let units: Vec<Unit<u32>> = "من hello دوست".chars().map(Unit::Character).collect();
        let starts: Vec<usize> = itemize(&units, None)
            .runs
            .iter()
            .map(|run| run.units.start)
            .collect();

        assert_eq!(starts, [0, 3, 8]);
    }
}
