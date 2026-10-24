//! Splits a horizontal proof line into shaping items in visual order: the
//! Unicode bidirectional algorithm orders runs, and each run is split by
//! script, as text layout engines do before handing runs to HarfBuzz.

use std::ops::Range;
use std::str::FromStr;

use unicode_bidi::{BidiInfo, Level};
use unicode_script::{Script, UnicodeScript};

use crate::TextDirection;
use crate::text::Piece;

/// Stands in for a named glyph in the bidi text; it is a neutral, so a
/// named glyph takes the direction of the text around it.
const OBJECT: char = '\u{FFFC}';

/// One run to shape or place, in visual order.
pub(crate) enum Item {
    /// Characters to shape in one direction and script.
    Text {
        text: String,
        /// Byte offset of `text` in the original line.
        start: usize,
        right_to_left: bool,
        script: Option<harfrust::Script>,
    },
    /// A glyph named directly, starting at byte `start` of the line.
    Glyph { name: String, start: usize },
}

/// A piece's place in the bidi text and in the original line.
struct Span {
    logical: Range<usize>,
    line_start: usize,
    name: Option<String>,
}

/// Orders `pieces` visually for a paragraph in `base` direction, or in the
/// direction of its first strong character when `base` is `None`; returns
/// the items and the paragraph direction.
pub(crate) fn visual_items(
    pieces: &[Piece],
    base: Option<TextDirection>,
) -> (Vec<Item>, TextDirection) {
    let mut logical = String::new();
    let mut spans = Vec::new();
    for piece in pieces {
        let start = logical.len();
        let (line_start, name) = match piece {
            Piece::Text { start, text } => {
                logical.push_str(text);
                (*start, None)
            }
            Piece::Glyph { start, name } => {
                logical.push(OBJECT);
                (*start, Some(name.clone()))
            }
        };
        spans.push(Span {
            logical: start..logical.len(),
            line_start,
            name,
        });
    }

    let level = base.map(|direction| match direction {
        TextDirection::RightToLeft => Level::rtl(),
        _ => Level::ltr(),
    });
    let bidi = BidiInfo::new(&logical, level);
    let mut items = Vec::new();
    let mut right_to_left = base == Some(TextDirection::RightToLeft);
    for paragraph in &bidi.paragraphs {
        right_to_left = paragraph.level.is_rtl();
        let (levels, runs) = bidi.visual_runs(paragraph, paragraph.range.clone());
        for run in runs {
            let run_is_rtl = levels[run.start].is_rtl();
            let mut run_items: Vec<Item> = spans
                .iter()
                .filter_map(|span| {
                    let start = span.logical.start.max(run.start);
                    let end = span.logical.end.min(run.end);
                    (start < end).then_some((span, start..end))
                })
                .flat_map(|(span, range)| span_items(&logical, span, range, run_is_rtl))
                .collect();
            if run_is_rtl {
                run_items.reverse();
            }
            items.extend(run_items);
        }
    }

    let direction = if right_to_left {
        TextDirection::RightToLeft
    } else {
        TextDirection::LeftToRight
    };
    (items, direction)
}

// Splits the part `range` of one span into script runs, in logical order.
fn span_items(logical: &str, span: &Span, range: Range<usize>, right_to_left: bool) -> Vec<Item> {
    if let Some(name) = &span.name {
        return vec![Item::Glyph {
            name: name.clone(),
            start: span.line_start,
        }];
    }

    let text = &logical[range.clone()];
    script_runs(text)
        .into_iter()
        .map(|(runs, script)| Item::Text {
            text: text[runs.clone()].to_string(),
            start: span.line_start + range.start - span.logical.start + runs.start,
            right_to_left,
            script,
        })
        .collect()
}

// Splits `text` where its script changes; common and inherited characters
// (spaces, digits, marks) join the run around them.
fn script_runs(text: &str) -> Vec<(Range<usize>, Option<harfrust::Script>)> {
    let mut runs: Vec<(Range<usize>, Option<Script>)> = Vec::new();
    for (index, character) in text.char_indices() {
        let end = index + character.len_utf8();
        let script = Some(character.script()).filter(|script| {
            !matches!(script, Script::Common | Script::Inherited | Script::Unknown)
        });
        match runs.last_mut() {
            Some((range, current))
                if script.is_none() || *current == script || current.is_none() =>
            {
                range.end = end;
                if current.is_none() {
                    *current = script;
                }
            }
            _ => runs.push((index..end, script)),
        }
    }
    runs.into_iter()
        .map(|(range, script)| {
            let script =
                script.and_then(|script| harfrust::Script::from_str(script.short_name()).ok());
            (range, script)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::pieces;

    fn order(line: &str, base: Option<TextDirection>) -> Vec<String> {
        visual_items(&pieces(line), base)
            .0
            .into_iter()
            .map(|item| match item {
                Item::Text {
                    text,
                    right_to_left,
                    ..
                } => {
                    format!("{}{text}", if right_to_left { "<" } else { ">" })
                }
                Item::Glyph { name, .. } => format!("/{name}"),
            })
            .collect()
    }

    #[test]
    fn orders_mixed_runs_visually_and_splits_scripts() {
        assert_eq!(order("abc אבג", None), [">abc ", "<אבג"]);
        assert_eq!(order("אבג abc", None), [">abc", "<אבג "]);
    }

    #[test]
    fn a_named_glyph_takes_the_direction_around_it() {
        assert_eq!(order("אב/x ג", None), ["<ג", "/x", "<אב"]);
    }
}
