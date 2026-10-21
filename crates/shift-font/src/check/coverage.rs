//! Opt-in checks on what a font covers: a required character set, and one
//! advance width for a monospaced font.

use std::collections::BTreeMap;

use crate::{Font, Glyph, Source};

use super::health::extent;
use super::roles::GlyphRole;
use super::{Check, Finding};

/// Advances closer than this, in font units, are the same width.
const SAME_WIDTH: f64 = 1e-6;

/// Characters a font must map and draw in every master.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Charset {
    /// Ordered, duplicate-free Unicode scalar values.
    codepoints: Vec<u32>,
}

impl Charset {
    /// Printable ASCII, U+0020 to U+007E.
    pub fn ascii() -> Self {
        Self::new((0x20..=0x7E).collect())
    }

    /// Printable ASCII and Latin-1 Supplement.
    pub fn latin1() -> Self {
        Self::new((0x20..=0x7E).chain(0xA0..=0xFF).collect())
    }

    /// Builds a charset, dropping repeated code points.
    pub fn new(mut codepoints: Vec<u32>) -> Self {
        let mut seen = std::collections::HashSet::new();
        codepoints.retain(|codepoint| seen.insert(*codepoint));
        Self { codepoints }
    }

    /// Reads a charset list.
    ///
    /// Blank lines and lines starting with `#` are ignored. A line starting
    /// with `U+` names one scalar (`U+0041`) or an inclusive range
    /// (`U+0041..U+005A`); any other line contributes each of its
    /// non-whitespace characters.
    ///
    /// # Errors
    ///
    /// Returns the 1-based number of a `U+` line that isn't a valid scalar
    /// or range.
    pub fn parse(text: &str) -> Result<Self, usize> {
        let mut codepoints = Vec::new();
        for (index, line) in text.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let names_scalar = line
                .get(..2)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("U+"));
            if names_scalar && line.len() > 2 {
                codepoints.extend(range(line).ok_or(index + 1)?);
                continue;
            }
            codepoints.extend(line.chars().filter(|c| !c.is_whitespace()).map(u32::from));
        }
        Ok(Self::new(codepoints))
    }

    pub fn codepoints(&self) -> &[u32] {
        &self.codepoints
    }

    pub fn is_empty(&self) -> bool {
        self.codepoints.is_empty()
    }
}

fn range(line: &str) -> Option<std::ops::RangeInclusive<u32>> {
    let scalar = |text: &str| {
        let hex = text.trim().get(2..)?;
        let value = u32::from_str_radix(hex, 16).ok()?;
        char::from_u32(value).map(u32::from)
    };
    match line.split_once("..") {
        Some((start, end)) => {
            let (start, end) = (scalar(start)?, scalar(end)?);
            (start <= end).then_some(start..=end)
        }
        None => scalar(line).map(|value| value..=value),
    }
}

/// Reports characters of `charset` the font doesn't map, or maps to a glyph a
/// master doesn't draw.
pub(super) fn charset(font: &Font, charset: &Charset) -> Vec<Finding> {
    let mut findings = Vec::new();
    let mut missing = Vec::new();
    for &codepoint in charset.codepoints() {
        let Some(glyph) = font.glyphs_by_unicode(codepoint).next() else {
            missing.push(codepoint);
            continue;
        };
        for source in font.masters() {
            if glyph.layer_for_source(&source.id()).is_none() {
                findings.push(
                    Finding::glyph(
                        Check::CharsetMissingLayer,
                        glyph.id(),
                        format!(
                            "U+{codepoint:04X} '{}' has no layer in '{}'",
                            glyph.name(),
                            source.name()
                        ),
                    )
                    .in_source(source.id()),
                );
            }
        }
    }
    if missing.is_empty() {
        return findings;
    }

    let shown = missing
        .iter()
        .take(20)
        .map(|codepoint| match char::from_u32(*codepoint) {
            Some(character) if !character.is_control() => format!("U+{codepoint:04X} {character}"),
            _ => format!("U+{codepoint:04X}"),
        })
        .collect::<Vec<_>>()
        .join(", ");
    let more = missing.len().saturating_sub(20);
    findings.push(Finding::font(
        Check::CharsetMissingGlyph,
        format!(
            "the font doesn't map {} required character{}: {shown}{}",
            missing.len(),
            if missing.len() == 1 { "" } else { "s" },
            if more > 0 {
                format!(" and {more} more")
            } else {
                String::new()
            }
        ),
    ));
    findings
}

/// Reports, in each master, glyphs whose advance differs from the cell width
/// and glyphs whose ink is wider than their advance.
///
/// The cell width is `width` when given, otherwise the most common advance
/// in that master. Marks and zero-width glyphs are skipped.
pub(super) fn monospace(font: &Font, width: Option<f64>) -> Vec<Finding> {
    let mut findings = Vec::new();
    for source in font.masters() {
        let samples = font
            .glyphs()
            .filter(|glyph| !GlyphRole::of(glyph).mark)
            .filter_map(|glyph| {
                let layer = glyph.layer_for_source(&source.id())?;
                let advance = layer.width();
                (advance.is_finite() && advance > 0.0).then_some((glyph, layer, advance))
            })
            .collect::<Vec<_>>();
        let Some(cell) =
            width.or_else(|| most_common(samples.iter().map(|(_, _, advance)| *advance)))
        else {
            continue;
        };

        for (glyph, layer, advance) in &samples {
            if (advance - cell).abs() > SAME_WIDTH {
                findings.push(at(
                    Check::MonoWidthMismatch,
                    glyph,
                    source,
                    &format!("is {advance} wide instead of the cell width {cell}"),
                ));
            }
            let ink = extent(
                layer
                    .contours_iter()
                    .map(|contour| (contour.points(), contour.is_closed())),
            );
            if let Some(ink) = ink {
                let ink_width = ink.max_x - ink.min_x;
                if ink_width > advance + SAME_WIDTH {
                    findings.push(at(
                        Check::MonoInkOverflow,
                        glyph,
                        source,
                        &format!("has ink {} wide in a {advance} cell", ink_width.round()),
                    ));
                }
            }
        }
    }
    findings
}

fn at(check: Check, glyph: &Glyph, source: &Source, message: &str) -> Finding {
    Finding::glyph(
        check,
        glyph.id(),
        format!("'{}' in '{}' {message}", glyph.name(), source.name()),
    )
    .in_source(source.id())
}

fn most_common(advances: impl Iterator<Item = f64>) -> Option<f64> {
    let mut counts: BTreeMap<i64, (f64, usize)> = BTreeMap::new();
    for advance in advances {
        #[expect(
            clippy::cast_possible_truncation,
            reason = "a bucket key; advances are far below 2^63 font units"
        )]
        let key = (advance / SAME_WIDTH).round() as i64;
        counts.entry(key).or_insert((advance, 0)).1 += 1;
    }
    counts
        .into_values()
        .max_by(|left, right| left.1.cmp(&right.1).then(right.0.total_cmp(&left.0)))
        .map(|(advance, _)| advance)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_characters_scalars_and_ranges() {
        let charset = Charset::parse("# letters\nab\nU+0043\nU+0030..U+0032\n").unwrap();

        assert_eq!(charset.codepoints(), [0x61, 0x62, 0x43, 0x30, 0x31, 0x32]);
        assert_eq!(Charset::parse("U+ZZZZ"), Err(1));
    }

    #[test]
    fn the_most_common_advance_is_the_cell_width() {
        assert_eq!(most_common([600.0, 600.0, 500.0].into_iter()), Some(600.0));
    }
}
