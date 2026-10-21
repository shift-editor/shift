//! Proof lines with `/name` glyph tokens, as Glyphs and FontGoggles write
//! them.
//!
//! In a line, `/` starts a glyph name that runs to the next `/` or space;
//! a space that ends a name is consumed, so `/a /b` sets two glyphs with no
//! space between them (write `/space` for one). `//` is a literal slash, and
//! a `/` with no name after it is kept as text.

use crate::bidi::{Item, visual_items};
use crate::shape::{RunGlyph, ShapedGlyph, ShapedRun};
use crate::{ProofFont, ScriptSetting, ShapingOptions, TextDirection};

/// One piece of a proof line.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum Piece {
    /// Characters to shape, starting at byte `start` of the line.
    Text { start: usize, text: String },
    /// A glyph named directly, starting at byte `start` of the line.
    Glyph { start: usize, name: String },
}

/// Splits `line` into text and `/name` pieces, in logical order.
pub(crate) fn pieces(line: &str) -> Vec<Piece> {
    let mut pieces = Vec::new();
    let mut text = String::new();
    let mut text_start = 0;
    let mut characters = line.char_indices().peekable();
    while let Some((index, character)) = characters.next() {
        if character != '/' {
            if text.is_empty() {
                text_start = index;
            }
            text.push(character);
            continue;
        }
        if characters.next_if(|(_, next)| *next == '/').is_some() {
            if text.is_empty() {
                text_start = index;
            }
            text.push('/');
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
            continue;
        }
        characters.next_if(|(_, next)| *next == ' ');
        if !text.is_empty() {
            pieces.push(Piece::Text {
                start: text_start,
                text: std::mem::take(&mut text),
            });
        }
        pieces.push(Piece::Glyph { start: index, name });
    }
    if !text.is_empty() {
        pieces.push(Piece::Text {
            start: text_start,
            text,
        });
    }
    pieces
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
    /// A horizontal line is ordered with the Unicode bidirectional
    /// algorithm, in `options.direction` as the paragraph direction or the
    /// direction of its first strong character, and split into runs of one
    /// direction and script, each shaped on its own (an explicit
    /// `options.script` applies to every run). So kerning and contextual
    /// features do not reach across a named glyph or a change of script.
    /// The run reports the paragraph direction. A vertical line is shaped
    /// piece by piece in the given direction. A name the font does not have
    /// is drawn as a missing glyph.
    pub fn set_line(&self, line: &str, options: &ShapingOptions) -> ShapedRun {
        let pieces = pieces(line);
        if let Some(direction) = options
            .direction
            .filter(|direction| direction.is_vertical())
        {
            return self.set_vertical(&pieces, direction, options);
        }

        let (items, direction) = visual_items(&pieces, options.direction);
        let glyphs: Vec<RunGlyph> = items
            .into_iter()
            .flat_map(|item| match item {
                Item::Text {
                    text,
                    start,
                    right_to_left,
                    script,
                } => {
                    let item_options = ShapingOptions {
                        direction: Some(if right_to_left {
                            TextDirection::RightToLeft
                        } else {
                            TextDirection::LeftToRight
                        }),
                        script: options
                            .script
                            .clone()
                            .or_else(|| script.map(ScriptSetting::from_harfrust)),
                        ..options.clone()
                    };
                    self.shaped_pieces(&text, start, &item_options)
                }
                Item::Glyph { name, start } => {
                    vec![self.named_glyph(&name, start, direction)]
                }
            })
            .collect();
        self.place(glyphs, direction)
    }

    fn set_vertical(
        &self,
        pieces: &[Piece],
        direction: TextDirection,
        options: &ShapingOptions,
    ) -> ShapedRun {
        let mut groups: Vec<Vec<RunGlyph>> = pieces
            .iter()
            .map(|piece| match piece {
                Piece::Text { start, text } => self.shaped_pieces(text, *start, options),
                Piece::Glyph { start, name } => vec![self.named_glyph(name, *start, direction)],
            })
            .collect();
        if direction.is_backward() {
            groups.reverse();
        }
        self.place(groups.into_iter().flatten(), direction)
    }

    // Shapes `text`, which starts at byte `start` of its line.
    fn shaped_pieces(&self, text: &str, start: usize, options: &ShapingOptions) -> Vec<RunGlyph> {
        self.shape_glyphs(text, options)
            .glyphs
            .into_iter()
            .map(|glyph| RunGlyph {
                missing: glyph.glyph_id == 0,
                glyph: ShapedGlyph {
                    cluster: start + glyph.cluster,
                    ..glyph
                },
            })
            .collect()
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

    #[test]
    fn a_double_slash_or_a_bare_slash_is_text() {
        assert_eq!(pieces("a//b"), [text(0, "a/b")]);
        assert_eq!(pieces("a / b"), [text(0, "a / b")]);
        assert_eq!(line_characters("x/one y"), "xy");
    }
}
