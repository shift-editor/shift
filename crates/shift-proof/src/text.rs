//! Proof lines with `/name` glyph tokens, as Glyphs and FontGoggles write
//! them.
//!
//! In a line, `/` starts a glyph name that runs to the next `/` or space;
//! a space that ends a name is consumed, so `/a /b` sets two glyphs with no
//! space between them (write `/space` for one). `//` is a literal slash, and
//! a `/` with no name after it is kept as text.

use std::ops::Range;

use shift_text::shape::{self, NOTDEF, ShapeDirection, Unit, itemize, line_breaks, visual_order};

use crate::shape::{RunGlyph, ShapedGlyph, ShapedRun};
use crate::{ProofError, ProofFont, ScriptSetting, ShapingOptions, TextDirection};

/// One piece of a proof line.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Piece {
    /// Characters to shape, starting at byte `start` of the line.
    Text {
        start: usize,
        text: String,
        /// Where each character of `text` is in the line, in bytes: a `//`
        /// sets one slash from two bytes.
        offsets: Vec<usize>,
    },
    /// A glyph named directly, starting at byte `start` of the line.
    Glyph { start: usize, name: String },
}

/// Splits `line` into text and `/name` pieces, in logical order.
pub(crate) fn pieces(line: &str) -> Vec<Piece> {
    let mut pieces = Vec::new();
    let mut text = String::new();
    let mut offsets = Vec::new();
    let mut text_start = 0;
    let mut characters = line.char_indices().peekable();
    while let Some((index, character)) = characters.next() {
        if character != '/' {
            if text.is_empty() {
                text_start = index;
            }
            text.push(character);
            offsets.push(index);
            continue;
        }
        if characters.next_if(|(_, next)| *next == '/').is_some() {
            if text.is_empty() {
                text_start = index;
            }
            text.push('/');
            offsets.push(index);
            continue;
        }

        let mut name = String::new();
        while let Some((_, next)) = characters.next_if(|(_, next)| *next != '/' && *next != ' ') {
            name.push(next);
        }
        if name.is_empty() {
            if text.is_empty() {
                text_start = index;
            }
            text.push('/');
            offsets.push(index);
            continue;
        }
        characters.next_if(|(_, next)| *next == ' ');
        if !text.is_empty() {
            pieces.push(Piece::Text {
                start: text_start,
                text: std::mem::take(&mut text),
                offsets: std::mem::take(&mut offsets),
            });
        }
        pieces.push(Piece::Glyph { start: index, name });
    }
    if !text.is_empty() {
        pieces.push(Piece::Text {
            start: text_start,
            text,
            offsets,
        });
    }
    pieces
}

/// A proof line as shift-text reads it: one unit per character, and one per
/// `/name` glyph, which bidi and line breaking read as an inline object.
struct LineUnits<'l> {
    /// Named glyphs are placed, not shaped, so their units hold `.notdef`.
    units: Vec<Unit<u32>>,
    /// Each unit's byte offset in the line as glyph clusters report it: its
    /// piece's start plus its offset in the piece's text.
    starts: Vec<usize>,
    /// Where each unit is in the line, in bytes, to cut the line at.
    line_offsets: Vec<usize>,
    /// Each unit's glyph name, for a named glyph.
    names: Vec<Option<&'l str>>,
}

impl<'l> LineUnits<'l> {
    fn new(pieces: &'l [Piece]) -> Self {
        let mut line = Self {
            units: Vec::new(),
            starts: Vec::new(),
            line_offsets: Vec::new(),
            names: Vec::new(),
        };
        for piece in pieces {
            match piece {
                Piece::Text {
                    start,
                    text,
                    offsets,
                } => {
                    for ((offset, character), line_offset) in text.char_indices().zip(offsets) {
                        line.units.push(Unit::Character(character));
                        line.starts.push(start + offset);
                        line.line_offsets.push(*line_offset);
                        line.names.push(None);
                    }
                }
                Piece::Glyph { start, name } => {
                    line.units.push(Unit::Glyph(NOTDEF));
                    line.starts.push(*start);
                    line.line_offsets.push(*start);
                    line.names.push(Some(name));
                }
            }
        }
        line
    }

    /// Itemizes the line with shift-text, reading it in `base` direction or
    /// its first strong character's, splits each run at named glyphs, and
    /// orders the parts for display; returns them with the paragraph's
    /// direction.
    fn display_parts(
        &self,
        base: Option<shape::TextDirection>,
    ) -> (Vec<DisplayPart<'l>>, shape::TextDirection) {
        let itemized = itemize(&self.units, base);
        let mut levels = Vec::new();
        let mut parts = Vec::new();
        for run in &itemized.runs {
            for part in self.parts(run.units.clone()) {
                levels.push(run.level);
                parts.push(Some(DisplayPart {
                    part,
                    direction: run.direction(),
                    script: run.script,
                }));
            }
        }
        let ordered = visual_order(&levels)
            .into_iter()
            .filter_map(|index| parts.get_mut(index).and_then(Option::take))
            .collect();
        (ordered, itemized.direction)
    }

    /// Splits `units` at named glyphs: stretches of characters, and each
    /// named glyph on its own, in logical order.
    fn parts(&self, units: Range<usize>) -> Vec<LinePart<'l>> {
        let mut parts = Vec::new();
        let mut start = units.start;
        for index in units.clone() {
            let Some(name) = self.names[index] else {
                continue;
            };
            if start < index {
                parts.push(LinePart::Text(start..index));
            }
            parts.push(LinePart::Glyph { index, name });
            start = index + 1;
        }
        if start < units.end {
            parts.push(LinePart::Text(start..units.end));
        }
        parts
    }
}

/// A stretch of a line to shape, or a named glyph to place.
enum LinePart<'l> {
    Text(Range<usize>),
    Glyph { index: usize, name: &'l str },
}

/// A part of a line in display order, with the run it belongs to.
struct DisplayPart<'l> {
    part: LinePart<'l>,
    /// The direction its bidi run reads in, which a stretch is shaped in.
    direction: shape::TextDirection,
    /// Its run's ISO 15924 script tag; `None` for common characters only.
    script: Option<&'static str>,
}

/// Byte offsets in `line` where a wrapped part may start: shift-text's line
/// break opportunities (UAX #14), with each `/name` glyph read as an inline
/// object.
pub(crate) fn break_offsets(line: &str) -> Vec<usize> {
    let pieces = pieces(line);
    let line = LineUnits::new(&pieces);
    line_breaks(&line.units)
        .into_iter()
        .filter_map(|line_break| {
            let unit = usize::try_from(line_break.unit).ok()?;
            line.line_offsets.get(unit).copied()
        })
        .collect()
}

/// The characters `line` sets once `/name` tokens are taken out, in
/// logical order.
pub fn line_characters(line: &str) -> String {
    pieces(line)
        .into_iter()
        .filter_map(|piece| match piece {
            Piece::Text { text, .. } => Some(text),
            Piece::Glyph { .. } => None,
        })
        .collect()
}

impl ProofFont<'_> {
    /// Sets one proof line: text is shaped with `options`, and each `/name`
    /// glyph is placed directly with its own advance, unshaped.
    ///
    /// A horizontal line is itemized by shift-text: bidi levels (UAX #9),
    /// in `options.direction` as the paragraph direction or the direction of
    /// its first strong character, then scripts, and each run is shaped on
    /// its own in its level's direction (an explicit `options.script`
    /// applies to every run) and the runs ordered for display. A run is also
    /// split at each named glyph, so kerning and contextual features do not
    /// reach across a named glyph or a change of script. The run reports
    /// the paragraph direction. A vertical line is shaped piece by piece in
    /// the given direction. A name the font does not have is drawn as a
    /// missing glyph.
    ///
    /// # Errors
    ///
    /// Returns [`ProofError::Shape`] when the line is too long to shape.
    pub fn set_line(&self, line: &str, options: &ShapingOptions) -> Result<ShapedRun, ProofError> {
        let pieces = pieces(line);
        if let Some(direction) = options
            .direction
            .filter(|direction| direction.is_vertical())
        {
            return self.set_vertical(&pieces, direction, options);
        }

        let line = LineUnits::new(&pieces);
        let (ordered, direction) = line.display_parts(options.base_direction());
        let direction = TextDirection::from(direction);
        let mut glyphs = Vec::new();
        for DisplayPart {
            part,
            direction: run_direction,
            script,
        } in ordered
        {
            match part {
                LinePart::Text(units) => {
                    let script = options.script.as_ref().map(ScriptSetting::tag).or(script);
                    let shaped = self.shape_units(
                        &line.units[units.clone()],
                        &line.starts[units],
                        Some(ShapeDirection::from(run_direction)),
                        script,
                        options,
                    )?;
                    glyphs.extend(shaped.glyphs.into_iter().map(RunGlyph::shaped));
                }
                LinePart::Glyph { index, name } => {
                    glyphs.push(self.named_glyph(name, line.starts[index], direction));
                }
            }
        }
        Ok(self.place(glyphs, direction))
    }

    fn set_vertical(
        &self,
        pieces: &[Piece],
        direction: TextDirection,
        options: &ShapingOptions,
    ) -> Result<ShapedRun, ProofError> {
        let mut groups = pieces
            .iter()
            .map(|piece| match piece {
                Piece::Text { start, text, .. } => self.shaped_pieces(text, *start, options),
                Piece::Glyph { start, name } => Ok(vec![self.named_glyph(name, *start, direction)]),
            })
            .collect::<Result<Vec<Vec<RunGlyph>>, ProofError>>()?;
        if direction.is_backward() {
            groups.reverse();
        }
        Ok(self.place(groups.into_iter().flatten(), direction))
    }

    // Shapes `text`, which starts at byte `start` of its line.
    fn shaped_pieces(
        &self,
        text: &str,
        start: usize,
        options: &ShapingOptions,
    ) -> Result<Vec<RunGlyph>, ProofError> {
        let glyphs = self
            .shape_glyphs(text, options)?
            .glyphs
            .into_iter()
            .map(|glyph| {
                RunGlyph::shaped(ShapedGlyph {
                    cluster: start + glyph.cluster,
                    ..glyph
                })
            })
            .collect();
        Ok(glyphs)
    }

    /// Glyph names in `line` that the font does not have, in order of first
    /// appearance.
    pub fn missing_glyph_names(&self, line: &str) -> Vec<String> {
        let mut missing: Vec<String> = Vec::new();
        for piece in pieces(line) {
            let Piece::Glyph { name, .. } = piece else {
                continue;
            };
            if self.glyph_by_name(&name).is_none() && !missing.contains(&name) {
                missing.push(name);
            }
        }
        missing
    }

    fn named_glyph(&self, name: &str, start: usize, direction: TextDirection) -> RunGlyph {
        let glyph_id = self.glyph_by_name(name);
        let id = glyph_id.unwrap_or(0);
        let x_advance = self.advance_width(id).unwrap_or_default();
        let vertical = direction.is_vertical();
        let units_per_em = f32::from(self.units_per_em());
        let glyph = ShapedGlyph {
            glyph_id: id,
            cluster: start,
            x_advance: if vertical { 0.0 } else { x_advance },
            y_advance: if vertical { -units_per_em } else { 0.0 },
            x_offset: if vertical { -x_advance / 2.0 } else { 0.0 },
            y_offset: if vertical {
                -self.metrics().ascender
            } else {
                0.0
            },
        };
        RunGlyph {
            glyph,
            missing: glyph_id.is_none(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(start: usize, text: &str) -> Piece {
        Piece::Text {
            start,
            text: text.to_string(),
            offsets: text
                .char_indices()
                .map(|(offset, _)| start + offset)
                .collect(),
        }
    }

    fn glyph(start: usize, name: &str) -> Piece {
        Piece::Glyph {
            start,
            name: name.to_string(),
        }
    }

    #[test]
    fn names_end_at_the_next_slash_or_a_consumed_space() {
        assert_eq!(pieces("H/a.ss01H"), [text(0, "H"), glyph(1, "a.ss01H")]);
        assert_eq!(pieces("/a.alt/b"), [glyph(0, "a.alt"), glyph(6, "b")]);
        assert_eq!(pieces("/a H"), [glyph(0, "a"), text(3, "H")]);
    }

    /// The line's parts in display order: `>` or `<` and the text of a
    /// stretch by its run's direction, `/name` for a named glyph.
    fn order(line: &str, base: Option<shape::TextDirection>) -> Vec<String> {
        let pieces = pieces(line);
        let units = LineUnits::new(&pieces);
        let characters: Vec<char> = units
            .units
            .iter()
            .map(|unit| match unit {
                Unit::Character(character) => *character,
                Unit::Glyph(_) => '\u{FFFC}',
            })
            .collect();
        units
            .display_parts(base)
            .0
            .into_iter()
            .map(|display| match display.part {
                LinePart::Text(range) => {
                    let arrow = match display.direction {
                        shape::TextDirection::LeftToRight => '>',
                        shape::TextDirection::RightToLeft => '<',
                    };
                    let text: String = characters[range].iter().collect();
                    format!("{arrow}{text}")
                }
                LinePart::Glyph { name, .. } => format!("/{name}"),
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

    #[test]
    fn a_line_breaks_after_spaces_and_around_named_glyphs_at_their_bytes_in_the_line() {
        assert_eq!(break_offsets("ab cd"), [3]);
        // UAX #14 breaks after a slash before a letter; `//` is two bytes.
        assert_eq!(break_offsets("x //c d"), [4, 6]);
        assert_eq!(break_offsets("H/a H"), [1, 4]);
    }

    #[test]
    fn a_double_slash_or_a_bare_slash_is_text() {
        let escaped = Piece::Text {
            start: 0,
            text: "a/b".to_string(),
            offsets: vec![0, 1, 3],
        };
        assert_eq!(pieces("a//b"), [escaped]);
        assert_eq!(pieces("a / b"), [text(0, "a / b")]);
        assert_eq!(line_characters("x/one y"), "xy");
    }
}
