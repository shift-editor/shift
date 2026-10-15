//! Splits a paragraph into runs of one script for shaping.

use std::ops::Range;

use unicode_script::{Script, UnicodeScript};

use super::ShapeUnit;

/// A stretch of a paragraph's units in one script.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct ScriptRun {
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
pub(super) fn script_runs(units: &[ShapeUnit]) -> Vec<ScriptRun> {
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
fn specific_script(unit: &ShapeUnit) -> Option<Script> {
    match unit {
        ShapeUnit::Character(character) => match character.script() {
            Script::Common | Script::Inherited | Script::Unknown => None,
            script => Some(script),
        },
        ShapeUnit::Glyph(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runs(text: &str) -> Vec<(Range<usize>, Option<Script>)> {
        let units: Vec<ShapeUnit> = text.chars().map(ShapeUnit::Character).collect();
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
}
