//! The family name drawn in the font itself, fitted to the launcher's wide
//! "Last opened" tile.
//!
//! Sizes are CSS pixels at the tile's scale; outlines stay in font units with
//! y down, like the short specimen's.

use skrifa::MetadataProvider;
use skrifa::instance::{LocationRef, Size};
use skrifa::string::StringId;

use super::{Bounds, DrawnGlyphs, SpecimenFont, ViewBox};

/// Text box a family name is fitted into, in CSS pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct NameBox {
    /// Widest the name's ink may be.
    pub width: f64,
}

impl NameBox {
    /// The wide "Last opened" tile: 392 px wide with 24 px of padding on each
    /// side.
    pub const WIDE_TILE: Self = Self { width: 344.0 };
}

/// Which fitting rule placed a family name.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NameFit {
    /// One line at the full 64 px.
    Full,
    /// One line shrunk to fit the width, no smaller than 48 px.
    Scaled,
    /// Two lines broken at a word, balanced, between 32 and 34 px.
    TwoLines,
}

/// A family name laid out in the font for the wide tile.
#[derive(Clone, Debug, PartialEq)]
pub struct NameSpecimen {
    /// The family name: `name` ID 16, else ID 1.
    pub text: String,
    /// SVG path data in font units, y down; a second line sits one line
    /// height below the first.
    pub outline: String,
    /// Viewport in font units: horizontally the ink, so the ink's left edge
    /// is the box's left edge; vertically the line boxes, each with the
    /// font's ascent and descent centred in its line height, as CSS lays out
    /// a line.
    pub view_box: ViewBox,
    /// Width to draw [`Self::view_box`] at, in CSS pixels.
    pub width: f64,
    /// Height to draw [`Self::view_box`] at, in CSS pixels.
    pub height: f64,
    /// The rule that placed the name.
    pub fit: NameFit,
}

/// A font size and its line height, in CSS pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
struct TypeSize {
    size: f64,
    line_height: f64,
}

impl TypeSize {
    /// Scales `self` to `size`, keeping its ratio of line height to size.
    fn at(self, size: f64) -> Self {
        Self {
            size,
            line_height: size * self.line_height / self.size,
        }
    }
}

/// Rule 1: a name that fits on one line at full size.
const FULL: TypeSize = TypeSize {
    size: 64.0,
    line_height: 68.0,
};
/// Rule 2: one line shrinks to fit down to this size, with this line height.
const SCALED_FLOOR: TypeSize = TypeSize {
    size: 48.0,
    line_height: 56.0,
};
/// Rule 3: two lines are set at this size, shrinking to fit the width.
const TWO_LINES: TypeSize = TypeSize {
    size: 34.0,
    line_height: 38.0,
};
/// Rule 4: two lines that would need to be smaller than this fall back to the
/// short specimen.
const TWO_LINES_FLOOR: f64 = 32.0;

/// How a family name would be set, before it is drawn.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Fitted {
    fit: NameFit,
    type_size: TypeSize,
}

/// Picks the fitting rule from the ink widths, in ems, of the name on one
/// line and of its best two-line break, if it has a word break.
fn choose_fit(one_line_em: f64, two_lines_em: Option<f64>, name_box: NameBox) -> Option<Fitted> {
    let fitting_size = |width_em: f64| name_box.width / width_em;

    let one_line = fitting_size(one_line_em);
    if one_line >= FULL.size {
        return Some(Fitted {
            fit: NameFit::Full,
            type_size: FULL,
        });
    }
    if one_line >= SCALED_FLOOR.size {
        return Some(Fitted {
            fit: NameFit::Scaled,
            type_size: SCALED_FLOOR.at(one_line),
        });
    }

    let two_lines = fitting_size(two_lines_em?).min(TWO_LINES.size);
    (two_lines >= TWO_LINES_FLOOR).then(|| Fitted {
        fit: NameFit::TwoLines,
        type_size: TWO_LINES.at(two_lines),
    })
}

/// Ink extent of shaped lines set from a common left origin, in font units.
fn ink_width(ink: &Bounds) -> f64 {
    ink.max_x - ink.min_x
}

impl SpecimenFont<'_> {
    /// Reads the family name: the typographic family (`name` ID 16), else
    /// the legacy family (ID 1).
    pub(super) fn family_name(&self) -> Option<String> {
        [StringId::TYPOGRAPHIC_FAMILY_NAME, StringId::FAMILY_NAME]
            .into_iter()
            .filter_map(|id| self.font.localized_strings(id).english_or_first())
            .map(|name| name.to_string().trim().to_string())
            .find(|name| !name.is_empty())
    }

    /// Draws the family name fitted to `name_box`, or `None` when the font
    /// has no family name, cannot draw every character of it, or it would be
    /// smaller than the last rule allows.
    pub(super) fn name_specimen(&self, name_box: NameBox) -> Option<NameSpecimen> {
        let text = self.family_name()?;
        let one_line = self.draw_lines(&[text.as_str()])?;
        let two_lines = self.balanced_break(&text);
        let two_lines_em = two_lines
            .as_ref()
            .map(|(_, drawn)| ink_width(&drawn.ink) / self.units_per_em);
        let fitted = choose_fit(
            ink_width(&one_line.ink) / self.units_per_em,
            two_lines_em,
            name_box,
        )?;

        let lines: Vec<&str> = match fitted.fit {
            NameFit::Full | NameFit::Scaled => vec![text.as_str()],
            NameFit::TwoLines => two_lines?.0.to_vec(),
        };
        let drawn = self.draw_set_lines(&lines, fitted.type_size)?;
        let line_count = lines.len() as f64;

        let scale = fitted.type_size.size / self.units_per_em;
        Some(NameSpecimen {
            outline: drawn.path,
            view_box: ViewBox {
                x: drawn.ink.min_x,
                y: 0.0,
                width: ink_width(&drawn.ink),
                height: fitted.type_size.line_height / scale * line_count,
            },
            width: ink_width(&drawn.ink) * scale,
            height: fitted.type_size.line_height * line_count,
            fit: fitted.fit,
            text,
        })
    }

    /// Splits the name at the word break whose two lines are closest in ink
    /// width, so the wider line is as narrow as it can be.
    fn balanced_break<'t>(&self, text: &'t str) -> Option<([&'t str; 2], DrawnGlyphs)> {
        text.match_indices(' ')
            .filter_map(|(index, _)| {
                let first = text[..index].trim_end();
                let second = text[index..].trim_start();
                if first.is_empty() || second.is_empty() {
                    return None;
                }
                let drawn = self.draw_lines(&[first, second])?;
                Some(([first, second], drawn))
            })
            .min_by(|(_, a), (_, b)| ink_width(&a.ink).total_cmp(&ink_width(&b.ink)))
    }

    /// Draws `lines` from a common left origin with every baseline at zero,
    /// for measuring their combined ink width.
    fn draw_lines(&self, lines: &[&str]) -> Option<DrawnGlyphs> {
        self.draw_baselines(lines, |_| 0.0)
    }

    /// Draws `lines` one line height apart at `type_size`, each baseline
    /// placed as CSS places it in its line box.
    fn draw_set_lines(&self, lines: &[&str], type_size: TypeSize) -> Option<DrawnGlyphs> {
        let metrics = self.font.metrics(Size::unscaled(), LocationRef::default());
        let ascent = f64::from(metrics.ascent);
        let content = ascent - f64::from(metrics.descent);
        let line_height = type_size.line_height * self.units_per_em / type_size.size;
        let half_leading = (line_height - content) / 2.0;

        self.draw_baselines(lines, |index| {
            index as f64 * line_height + half_leading + ascent
        })
    }

    fn draw_baselines(
        &self,
        lines: &[&str],
        baseline: impl Fn(usize) -> f64,
    ) -> Option<DrawnGlyphs> {
        let mut path = String::new();
        let mut ink: Option<Bounds> = None;
        for (index, line) in lines.iter().enumerate() {
            let shaped = self.shape_line(line)?;
            let drawn = self.draw_glyphs(&shaped.placed, baseline(index))?;
            path.push_str(&drawn.path);
            ink = Some(ink.map_or(drawn.ink, |current| current.union(drawn.ink)));
        }

        Some(DrawnGlyphs { path, ink: ink? })
    }
}

#[cfg(test)]
mod tests;
