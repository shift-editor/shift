//! Feature code generated from glyph relationships, and the full source that
//! compiles: the authored code followed by the generated features.
//!
//! A feature written in the authored code is taken over: nothing is generated
//! for its tag, so code always wins over generation.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;

use crate::relationships::{GlyphIndex, GlyphLookup, relationships};
use crate::{Glyph, GlyphRelationship};

/// The order generated features are written in: forms and localisation
/// first, then ligatures, then case, figures, and stylistic alternates.
const FEATURE_ORDER: [&str; 26] = [
    "ccmp", "locl", "isol", "init", "medi", "fina", "rlig", "liga", "dlig", "smcp", "c2sc", "case",
    "sups", "subs", "sinf", "numr", "dnom", "lnum", "onum", "tnum", "pnum", "zero", "ordn", "salt",
    "swsh", "titl",
];

/// The feature source a font compiles with: its authored code, then the
/// features its glyphs' relationships generate. `glyphs` is in glyph order.
pub fn assembled_feature_source(glyphs: &[&Glyph], authored: Option<&str>) -> String {
    let authored = authored.unwrap_or_default();
    let generated = generated_feature_code(glyphs, authored);
    match (authored.trim().is_empty(), generated.is_empty()) {
        (_, true) => authored.to_string(),
        (true, false) => generated,
        (false, false) => format!("{authored}\n\n{generated}"),
    }
}

/// The feature code `glyphs`' relationships generate, leaving out every
/// feature `authored` defines. Empty when nothing is generated.
pub fn generated_feature_code(glyphs: &[&Glyph], authored: &str) -> String {
    let authored = authored_feature_tags(authored);
    let index = GlyphIndex::new(glyphs.iter().copied());
    let mut features: BTreeMap<String, Vec<Rule>> = BTreeMap::new();
    for glyph in glyphs {
        for relationship in relationships(glyph, &index) {
            let feature = relationship.feature().to_string();
            if authored.contains(&feature) {
                continue;
            }
            let Some(rule) = rule(&index, &relationship, glyph.name()) else {
                continue;
            };
            let rules = features.entry(feature).or_default();
            // One substitution per input: the first glyph claiming it wins.
            if !rules.iter().any(|existing| existing.input == rule.input) {
                rules.push(rule);
            }
        }
    }

    let mut code = String::new();
    for (tag, mut rules) in ordered(features) {
        let ligatures = rules.iter().any(|rule| rule.input.len() > 1);
        // Longer ligatures first, so f_f_i wins over f_f.
        rules.sort_by_key(|rule| std::cmp::Reverse(rule.input.len()));
        let _ = writeln!(code, "feature {tag} {{");
        if ligatures {
            let _ = writeln!(code, "    lookupflag IgnoreMarks;");
        }
        for rule in rules {
            let _ = writeln!(code, "    sub {} by {};", rule.input.join(" "), rule.output);
        }
        let _ = writeln!(code, "}} {tag};\n");
    }
    code.trim_end().to_string()
}

/// One substitution: the glyphs it replaces and the glyph it puts in their place.
struct Rule {
    input: Vec<String>,
    output: String,
}

fn rule(glyphs: &impl GlyphLookup, relationship: &GlyphRelationship, output: &str) -> Option<Rule> {
    let name = |id: &crate::GlyphId| glyphs.glyph_name_by_id(id).map(str::to_string);
    let input = match relationship {
        GlyphRelationship::Alternate { of, .. } | GlyphRelationship::PositionalForm { of, .. } => {
            vec![name(of)?]
        }
        GlyphRelationship::Ligature { of, .. } => of.iter().map(name).collect::<Option<_>>()?,
        // Language forms need their script's language system; not generated yet.
        GlyphRelationship::LanguageForm { .. } => return None,
    };
    Some(Rule {
        input,
        output: output.to_string(),
    })
}

/// Generated features in [`FEATURE_ORDER`], then stylistic sets, character
/// variants, and anything else by tag.
fn ordered(features: BTreeMap<String, Vec<Rule>>) -> Vec<(String, Vec<Rule>)> {
    let rank = |tag: &str| {
        FEATURE_ORDER
            .iter()
            .position(|known| *known == tag)
            .unwrap_or(FEATURE_ORDER.len())
    };
    let mut features: Vec<_> = features.into_iter().collect();
    features.sort_by(|(a, _), (b, _)| rank(a).cmp(&rank(b)).then_with(|| a.cmp(b)));
    features
}

/// The tags of the features `feature tag {` blocks in `source` define.
pub fn authored_feature_tags(source: &str) -> BTreeSet<String> {
    let mut tags = BTreeSet::new();
    for line in source.lines() {
        let code = line.split('#').next().unwrap_or_default();
        let mut words = code.split_whitespace();
        while let Some(word) = words.next() {
            if word != "feature" {
                continue;
            }
            let Some(tag) = words.next() else { break };
            let tag = tag.trim_end_matches('{');
            if (1..=4).contains(&tag.len()) {
                tags.insert(tag.to_string());
            }
        }
    }
    tags
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Glyph;

    fn glyphs(names: &[&str]) -> Vec<Glyph> {
        names.iter().map(|name| Glyph::new(*name)).collect()
    }

    fn generated(glyphs: &[Glyph], authored: &str) -> String {
        generated_feature_code(&glyphs.iter().collect::<Vec<_>>(), authored)
    }

    #[test]
    fn relationships_generate_features_in_a_stable_order() {
        let glyphs = glyphs(&[
            "f",
            "i",
            "f_i",
            "f_f_i",
            "a",
            "a.ss01",
            "one",
            "one.tf",
            "beh-ar",
            "beh-ar.fina",
        ]);

        assert_eq!(
            generated(&glyphs, ""),
            "feature fina {\n    sub beh-ar by beh-ar.fina;\n} fina;\n\n\
             feature liga {\n    lookupflag IgnoreMarks;\n    sub f f i by f_f_i;\n    sub f i by f_i;\n} liga;\n\n\
             feature tnum {\n    sub one by one.tf;\n} tnum;\n\n\
             feature ss01 {\n    sub a by a.ss01;\n} ss01;"
        );
    }

    #[test]
    fn a_feature_written_in_code_is_not_generated() {
        let authored = "feature liga { sub f i by f_i; } liga; # feature ss01 { } ss01;\n";
        let glyphs = glyphs(&["f", "i", "f_i", "a", "a.ss01"]);
        let refs: Vec<_> = glyphs.iter().collect();

        let generated = generated(&glyphs, authored);

        assert!(!generated.contains("feature liga"));
        assert!(
            generated.contains("feature ss01"),
            "a commented-out block does not take over"
        );
        assert_eq!(
            assembled_feature_source(&refs, Some(authored)),
            format!("{authored}\n\n{generated}")
        );
    }

    #[test]
    fn authored_tags_ignore_feature_references_and_comments() {
        let tags = authored_feature_tags(
            "feature aalt { feature locl; } aalt;\nfeature ss01{\n} ss01;\n# feature cv01 {",
        );
        assert_eq!(tags.into_iter().collect::<Vec<_>>(), ["aalt", "ss01"]);
    }
}
