//! Splits a paragraph into runs of one script and one bidi level for
//! shaping.

use std::ops::Range;

use unicode_bidi::{BidiInfo, Level};
use unicode_script::{Script, UnicodeScript};

use crate::{TextDirection, Unit};

/// What a picked glyph reads as for bidi: an inline object, neutral to the
/// text around it.
const OBJECT_REPLACEMENT: char = '\u{FFFC}';

/// A stretch of a paragraph's units in one script.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ScriptRun {
    pub units: Range<usize>,
    /// `None` when every unit in the run is common to all scripts, such as
    /// digits, spaces, and punctuation on their own.
    pub script: Option<Script>,
}

/// A stretch of a paragraph's units in one script and one bidi level.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct TextRun {
    pub units: Range<usize>,
    pub script: Option<Script>,
    /// The run's resolved bidi level; odd levels read right to left.
    pub level: Level,
}

/// A paragraph split for shaping.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Itemized {
    /// The paragraph's base direction, from its first strong character
    /// (UAX #9 rules P2 and P3); left to right when it has none.
    pub direction: TextDirection,
    /// Runs in visual order, left to right on screen.
    pub runs: Vec<TextRun>,
}

/// Splits a paragraph where its script or bidi level changes, and puts the
/// runs in the order they read on screen.
///
/// Levels follow the Unicode Bidirectional Algorithm, including the
/// whitespace rule for a line's end (L1), with the paragraph treated as one
/// line. Units common to all scripts keep their own level, so digits inside
/// Arabic become their own left-to-right run. Runs are then reordered by
/// level (rule L2): an English word inside Arabic sits left of the Arabic
/// that precedes it.
pub(crate) fn itemize<G>(units: &[Unit<G>]) -> Itemized {
    let text: String = units.iter().map(bidi_character).collect();
    let bidi = BidiInfo::new(&text, None);
    let direction = bidi
        .paragraphs
        .first()
        .map_or(TextDirection::LeftToRight, |paragraph| {
            TextDirection::of_level(paragraph.level)
        });
    let levels: Vec<Level> = bidi
        .paragraphs
        .iter()
        .flat_map(|paragraph| bidi.reordered_levels_per_char(paragraph, paragraph.range.clone()))
        .collect();

    // Levels first, then scripts within each level run, so a space between
    // two directions takes the script of the text it reads with.
    let mut logical = Vec::new();
    let mut start = 0;
    for index in 1..=units.len() {
        if index < units.len() && levels[index] == levels[start] {
            continue;
        }
        logical.extend(
            script_runs(&units[start..index])
                .into_iter()
                .map(|run| TextRun {
                    units: start + run.units.start..start + run.units.end,
                    script: run.script,
                    level: levels[start],
                }),
        );
        start = index;
    }
    Itemized {
        direction,
        runs: visual_order(logical),
    }
}

/// Reorders runs from logical to screen order by their levels (UAX #9 rule
/// L2), as `unicode-bidi` reorders characters.
fn visual_order(runs: Vec<TextRun>) -> Vec<TextRun> {
    let levels: Vec<Level> = runs.iter().map(|run| run.level).collect();
    let mut runs: Vec<Option<TextRun>> = runs.into_iter().map(Some).collect();
    BidiInfo::reorder_visual(&levels)
        .into_iter()
        .filter_map(|logical| runs.get_mut(logical).and_then(Option::take))
        .collect()
}

fn bidi_character<G>(unit: &Unit<G>) -> char {
    match unit {
        Unit::Character(character) => *character,
        Unit::Glyph(_) => OBJECT_REPLACEMENT,
    }
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

    fn levels(text: &str) -> (TextDirection, Vec<(Range<usize>, u8)>) {
        let units: Vec<Unit<u32>> = text.chars().map(Unit::Character).collect();
        let itemized = itemize(&units);
        let runs = itemized
            .runs
            .into_iter()
            .map(|run| (run.units, run.level.number()))
            .collect();
        (itemized.direction, runs)
    }

    #[test]
    fn an_arabic_paragraph_puts_an_english_word_left_of_the_arabic_before_it() {
        assert_eq!(
            levels("من hello دوست"),
            (
                TextDirection::RightToLeft,
                vec![(8..13, 1), (3..8, 2), (0..3, 1)]
            )
        );
    }

    #[test]
    fn digits_inside_arabic_read_left_to_right_left_of_the_arabic() {
        assert_eq!(
            levels("سال 2024"),
            (TextDirection::RightToLeft, vec![(4..8, 2), (0..4, 1)])
        );
    }

    #[test]
    fn an_english_paragraph_keeps_arabic_words_together_in_place() {
        assert_eq!(
            levels("I said سلام دوست today"),
            (
                TextDirection::LeftToRight,
                vec![(0..7, 0), (7..16, 1), (16..22, 0)]
            )
        );
    }

    #[test]
    fn a_paragraph_with_no_strong_character_reads_left_to_right() {
        assert_eq!(
            levels("12, 34"),
            (TextDirection::LeftToRight, vec![(0..6, 0)])
        );
    }
}
