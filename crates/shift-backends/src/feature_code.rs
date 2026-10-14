//! Lints and formats a font's authored feature code with feanor.
//!
//! Ranges are in UTF-16 code units, the offsets JavaScript strings and code
//! editors use, so callers can place them without converting.

use std::ops::Range;

use feanor::{
    Applicability, Diagnostic, FormatOptions, GlyphNames, Indent, LintOptions, Selection, Severity,
    SymbolKind,
};
use shift_font::{FeatureCodeIndent, FeatureCodeSettings, Font};

use crate::shaper_font::DiagnosticSeverity;

/// One problem the linter found in feature code.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeatureLint {
    /// The rule's stable code, such as `G001`.
    pub rule: &'static str,
    pub severity: DiagnosticSeverity,
    pub message: String,
    /// The problem's range in UTF-16 code units.
    pub range: Range<usize>,
    pub fixes: Vec<FeatureFix>,
}

/// Edits that resolve a [`FeatureLint`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeatureFix {
    /// What the fix does, for a quick-fix menu.
    pub title: String,
    /// Whether the fix keeps what the compiled font does. Unsafe fixes, such as
    /// renaming a glyph to a suggestion, need checking before they are applied.
    pub safe: bool,
    /// Non-overlapping edits, in no particular order.
    pub edits: Vec<FeatureEdit>,
}

/// Replaces `range` of the linted code, in UTF-16 code units, with `text`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeatureEdit {
    pub range: Range<usize>,
    pub text: String,
}

/// What kind of name a [`FeatureSymbol`] is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FeatureSymbolKind {
    Class,
    MarkClass,
    Lookup,
    /// A glyph name; the font defines it, so it has references only.
    Glyph,
}

/// A class, mark class, lookup, or glyph name in feature code, and every
/// place it's written, in UTF-16 code units.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeatureSymbol {
    pub kind: FeatureSymbolKind,
    /// The name as written; classes keep their `@`.
    pub name: String,
    pub definitions: Vec<Range<usize>>,
    pub references: Vec<Range<usize>>,
}

/// The symbol written at `offset`, in UTF-16 code units into `source`.
pub fn feature_symbol_at(source: &str, offset: usize) -> Option<FeatureSymbol> {
    let offsets = Utf16Offsets::new(source);
    let symbols = feanor::symbols(source);
    let symbol = symbols.at(Utf16Offsets::byte(source, offset))?;
    let kind = match symbol.kind {
        SymbolKind::Class => FeatureSymbolKind::Class,
        SymbolKind::MarkClass => FeatureSymbolKind::MarkClass,
        SymbolKind::Lookup => FeatureSymbolKind::Lookup,
        _ => FeatureSymbolKind::Glyph,
    };
    let ranges =
        |ranges: &[Range<usize>]| ranges.iter().map(|range| offsets.range(range)).collect();
    Some(FeatureSymbol {
        kind,
        name: symbol.name.clone(),
        definitions: ranges(&symbol.definitions),
        references: ranges(&symbol.references),
    })
}

/// The edits that rename the class, mark class, or lookup at `offset` to
/// `new_name` everywhere in `source`, in UTF-16 code units. `None` when
/// nothing renameable is there or `new_name` is not a valid name.
pub fn rename_feature_symbol(
    source: &str,
    offset: usize,
    new_name: &str,
) -> Option<Vec<FeatureEdit>> {
    let offsets = Utf16Offsets::new(source);
    let edits = feanor::symbols(source).rename(Utf16Offsets::byte(source, offset), new_name)?;
    Some(
        edits
            .into_iter()
            .map(|edit| FeatureEdit {
                range: offsets.range(&edit.range),
                text: edit.new_text,
            })
            .collect(),
    )
}

/// Lints `source` as `font`'s feature code: glyph names are checked against
/// the font, and the font's ignored rules and `# noqa` comments are honoured.
pub fn lint_feature_code(source: &str, font: &Font) -> Vec<FeatureLint> {
    let glyphs: GlyphNames = font
        .glyphs()
        .map(|glyph| glyph.name().to_string())
        .collect();
    let mut diagnostics = feanor::lint(source, &LintOptions::default().with_glyphs(&glyphs));
    feanor::apply_noqa(source, &mut diagnostics);
    Selection {
        select: Vec::new(),
        ignore: font.feature_code_settings().ignored_rules,
    }
    .retain(&mut diagnostics);

    let offsets = Utf16Offsets::new(source);
    diagnostics
        .into_iter()
        .map(|diagnostic| lint(diagnostic, &offsets))
        .collect()
}

/// `source` laid out by the formatter with `settings`. Only layout changes,
/// never a token or a comment; code that doesn't parse is left as written.
pub fn format_feature_code(source: &str, settings: &FeatureCodeSettings) -> String {
    let mut options = FormatOptions::default();
    options.line_width = usize::try_from(settings.line_width).unwrap_or(usize::MAX);
    options.keep_alignment = settings.keep_alignment;
    options.indent = match settings.indent {
        FeatureCodeIndent::Auto => Indent::Auto,
        FeatureCodeIndent::Spaces(spaces) => Indent::Spaces(usize::from(spaces)),
        FeatureCodeIndent::Tab => Indent::Tab,
    };
    feanor::format(source, &options).text
}

fn lint(diagnostic: Diagnostic, offsets: &Utf16Offsets) -> FeatureLint {
    let severity = match diagnostic.severity {
        Severity::Error => DiagnosticSeverity::Error,
        Severity::Warning => DiagnosticSeverity::Warning,
        _ => DiagnosticSeverity::Info,
    };
    let fixes = diagnostic
        .fixes
        .into_iter()
        .map(|fix| FeatureFix {
            title: fix.title,
            safe: fix.applicability == Applicability::Safe,
            edits: fix
                .edits
                .into_iter()
                .map(|edit| FeatureEdit {
                    range: offsets.range(&edit.range),
                    text: edit.new_text,
                })
                .collect(),
        })
        .collect();
    FeatureLint {
        rule: diagnostic.rule.code(),
        severity,
        message: diagnostic.message,
        range: offsets.range(&diagnostic.range),
        fixes,
    }
}

/// Converts byte offsets into one text to UTF-16 offsets. Only characters
/// outside ASCII are recorded, so ASCII text converts without a table.
struct Utf16Offsets {
    /// Byte offset just after each non-ASCII character, and how many fewer
    /// UTF-16 units than bytes the text has up to there.
    shrink: Vec<(usize, usize)>,
    len: usize,
}

impl Utf16Offsets {
    fn new(text: &str) -> Self {
        let mut shrink = Vec::new();
        let mut total = 0;
        for (index, character) in text.char_indices().filter(|(_, c)| !c.is_ascii()) {
            total += character.len_utf8() - character.len_utf16();
            shrink.push((index + character.len_utf8(), total));
        }
        Self {
            shrink,
            len: text.len(),
        }
    }

    fn offset(&self, byte: usize) -> usize {
        let byte = byte.min(self.len);
        let after = self.shrink.partition_point(|(end, _)| *end <= byte);
        let shrunk = after.checked_sub(1).map_or(0, |index| self.shrink[index].1);
        byte - shrunk
    }

    /// The byte offset of UTF-16 offset `utf16` in `text`, clamped to its end.
    fn byte(text: &str, utf16: usize) -> usize {
        let mut units = 0;
        for (index, character) in text.char_indices() {
            if units >= utf16 {
                return index;
            }
            units += character.len_utf16();
        }
        text.len()
    }

    fn range(&self, range: &Range<usize>) -> Range<usize> {
        self.offset(range.start)..self.offset(range.end)
    }
}

#[cfg(test)]
mod tests {
    use shift_font::{Font, Glyph};

    use super::*;

    fn font(glyphs: &[&str]) -> Font {
        let mut font = Font::new();
        for name in glyphs {
            font.insert_glyph(Glyph::new(*name)).unwrap();
        }
        font
    }

    #[test]
    fn a_glyph_the_font_lacks_is_reported_with_a_fix_from_its_glyphs() {
        let source = "feature liga {\n  sub f i by f_ii;\n} liga;\n";

        let lints = lint_feature_code(source, &font(&["f", "i", "f_i"]));

        let missing = lints.iter().find(|lint| lint.rule == "G001").unwrap();
        assert_eq!(&source[missing.range.clone()], "f_ii");
        assert!(missing
            .fixes
            .iter()
            .any(|fix| fix.edits[0].text == "f_i" && !fix.safe));
    }

    #[test]
    fn ignored_rules_and_noqa_comments_are_not_reported() {
        let source = "@unused = [a b];\nfeature liga { sub f i by f_ii; } liga; # noqa: G001\n";
        let mut font = font(&["a", "b", "f", "i"]);
        let mut settings = font.feature_code_settings();
        settings.ignored_rules = vec!["unused-class".to_string()];
        font.lib_mut().set(
            shift_font::FEATURE_CODE_SETTINGS_LIB_KEY.to_string(),
            settings.to_lib_value().unwrap(),
        );

        assert_eq!(lint_feature_code(source, &font), Vec::new());
    }

    #[test]
    fn ranges_count_utf16_units_after_non_ascii_text() {
        let source = "# جدول — ✓ 😀\nfeature liga { sub f i by f_ii; } liga;\n";

        let lints = lint_feature_code(source, &font(&["f", "i", "f_i"]));

        let missing = lints.iter().find(|lint| lint.rule == "G001").unwrap();
        let utf16: Vec<u16> = source.encode_utf16().collect();
        let text = String::from_utf16(&utf16[missing.range.clone()]).unwrap();
        assert_eq!(text, "f_ii");
    }

    #[test]
    fn the_symbol_under_a_cursor_after_non_ascii_text_has_its_definition_and_uses() {
        let source = "# ✓ 😀\n@lc = [a b];\nfeature smcp { sub @lc by @lc.sc; } smcp;\n";
        let utf16: Vec<u16> = source.encode_utf16().collect();
        let text = |range: &Range<usize>| String::from_utf16(&utf16[range.clone()]).unwrap();
        let cursor = source[..source.find("@lc by").unwrap()]
            .encode_utf16()
            .count()
            + 1;

        let symbol = feature_symbol_at(source, cursor).unwrap();

        assert_eq!(symbol.kind, FeatureSymbolKind::Class);
        assert_eq!(text(&symbol.definitions[0]), "@lc");
        assert_eq!(symbol.references.len(), 1);
        let edits = rename_feature_symbol(source, cursor, "lower").unwrap();
        assert_eq!(edits.len(), 2);
        assert!(edits
            .iter()
            .all(|edit| text(&edit.range) == "@lc" && edit.text == "@lower"));
    }

    #[test]
    fn formatting_follows_the_font_settings() {
        let settings = FeatureCodeSettings {
            indent: FeatureCodeIndent::Spaces(2),
            ..FeatureCodeSettings::default()
        };

        let formatted =
            format_feature_code("feature liga {\nsub f i by f_i;\n} liga;\n", &settings);

        assert_eq!(formatted, "feature liga {\n  sub f i by f_i;\n} liga;\n");
    }
}
