//! Unicode-derived glyph roles that relax advance and outline expectations.
//!
//! Encoded glyphs are classified from the Unicode general category of their
//! code points. Unencoded glyphs fall back to name heuristics: a `uniXXXX` or
//! `uXXXX[X]` name is classified like that code point. A name whose base
//! (the part before the first `.`) ends in `comb` is a combining mark
//! whatever its code point, since fonts encode mark variants in private use.

use crate::Glyph;
use icu_properties::CodePointMapData;
use icu_properties::props::GeneralCategory;

/// Advance and outline expectations for one glyph.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(super) struct GlyphRole {
    /// Nonspacing or enclosing combining mark (`Mn`, `Me`): zero advance is
    /// expected and monospace width checks skip it.
    pub(super) mark: bool,
    /// Separator, control, or format character (`Zs`, `Zl`, `Zp`, `Cc`, `Cf`):
    /// an empty outline is expected.
    pub(super) space_like: bool,
    /// Control or format character (`Cc`, `Cf`), or a `.null`/`NULL` glyph:
    /// zero advance is acceptable.
    pub(super) zero_width_allowed: bool,
}

impl GlyphRole {
    pub(super) fn of(glyph: &Glyph) -> Self {
        let codepoints = if glyph.unicodes().is_empty() {
            codepoint_from_name(glyph.name()).into_iter().collect()
        } else {
            glyph.unicodes().to_vec()
        };
        let categories = codepoints
            .iter()
            .filter_map(|codepoint| char::from_u32(*codepoint))
            .map(|character| CodePointMapData::<GeneralCategory>::new().get(character))
            .collect::<Vec<_>>();
        let any =
            |predicate: fn(GeneralCategory) -> bool| categories.iter().copied().any(predicate);
        let all = |predicate: fn(GeneralCategory) -> bool| {
            !categories.is_empty() && categories.iter().copied().all(predicate)
        };

        let mark = any(is_mark) || has_comb_name(glyph.name());
        let null_name = matches!(glyph.name(), ".null" | "NULL");
        let blank_symbol = !codepoints.is_empty()
            && codepoints
                .iter()
                .all(|codepoint| is_blank_symbol(*codepoint));

        Self {
            mark,
            space_like: all(is_space_like) || null_name || blank_symbol,
            zero_width_allowed: mark || all(is_zero_width_control) || null_name,
        }
    }
}

fn is_mark(category: GeneralCategory) -> bool {
    matches!(
        category,
        GeneralCategory::NonspacingMark | GeneralCategory::EnclosingMark
    )
}

fn is_space_like(category: GeneralCategory) -> bool {
    matches!(
        category,
        GeneralCategory::SpaceSeparator
            | GeneralCategory::LineSeparator
            | GeneralCategory::ParagraphSeparator
            | GeneralCategory::Control
            | GeneralCategory::Format
    )
}

/// Code points outside the separator categories whose standard glyph is
/// blank: U+2800 BRAILLE PATTERN BLANK (a symbol, `So`, with no dots) and the
/// Hangul fillers. Fonts draw them empty on purpose.
fn is_blank_symbol(codepoint: u32) -> bool {
    matches!(codepoint, 0x2800 | 0x115F | 0x1160 | 0x3164 | 0xFFA0)
}

fn is_zero_width_control(category: GeneralCategory) -> bool {
    matches!(category, GeneralCategory::Control | GeneralCategory::Format)
}

fn base_name(name: &str) -> &str {
    name.split('.').next().unwrap_or(name)
}

fn has_comb_name(name: &str) -> bool {
    base_name(name).ends_with("comb")
}

fn codepoint_from_name(name: &str) -> Option<u32> {
    let base = base_name(name);
    let hex = match base.strip_prefix("uni") {
        Some(hex) if hex.len() == 4 => hex,
        _ => base
            .strip_prefix('u')
            .filter(|hex| (4..=6).contains(&hex.len()))?,
    };
    u32::from_str_radix(hex, 16).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn role(name: &str, unicodes: &[u32]) -> GlyphRole {
        let mut glyph = Glyph::new(name);
        glyph.set_unicodes(unicodes.to_vec());
        GlyphRole::of(&glyph)
    }

    #[test]
    fn combining_marks_are_detected_by_category_and_name() {
        assert!(role("acutecomb", &[0x0301]).mark);
        assert!(role("gravecomb.case", &[]).mark);
        assert!(role("uni0308", &[]).mark);
        assert!(!role("acute", &[0x00B4]).mark);
        assert!(!role("A", &[0x41]).mark);
    }

    #[test]
    fn spaces_and_format_characters_relax_outline_and_advance_rules() {
        let space = role("space", &[0x20]);
        let zwj = role("uni200D", &[0x200D]);

        assert!(space.space_like);
        assert!(!space.zero_width_allowed);
        assert!(zwj.space_like);
        assert!(zwj.zero_width_allowed);
        assert!(role(".null", &[]).zero_width_allowed);
    }

    #[test]
    fn blank_braille_pattern_expects_an_empty_outline_but_keeps_its_advance() {
        let blank = role("uni2800", &[0x2800]);
        let dots = role("uni2801", &[0x2801]);

        assert!(blank.space_like);
        assert!(!blank.zero_width_allowed);
        assert!(!dots.space_like);
    }
}
