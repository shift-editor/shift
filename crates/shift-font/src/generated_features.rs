//! Feature code generated from glyph relationships, and the full source that
//! compiles: the authored code followed by the generated features.
//!
//! A feature written in the authored code is taken over: nothing is generated
//! for its tag, so code always wins over generation.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;

use crate::relationships::{relationships, GlyphIndex, GlyphLookup};
use crate::{Glyph, GlyphRelationship, LibData, LibValue};

/// The font lib key listing the generated features switched off, by tag.
pub const GENERATED_FEATURES_OFF_LIB_KEY: &str = "com.shift.generatedFeaturesOff";

/// The tags of the generated features `lib` switches off.
pub fn generated_features_off(lib: &LibData) -> BTreeSet<String> {
    let Some(LibValue::Array(tags)) = lib.get(GENERATED_FEATURES_OFF_LIB_KEY) else {
        return BTreeSet::new();
    };
    tags.iter()
        .filter_map(|tag| match tag {
            LibValue::String(tag) => Some(tag.clone()),
            _ => None,
        })
        .collect()
}

/// The order generated features are written in: forms and localisation
/// first, then ligatures, then case, figures, and stylistic alternates.
const FEATURE_ORDER: [&str; 26] = [
    "ccmp", "locl", "isol", "init", "medi", "fina", "rlig", "liga", "dlig", "smcp", "c2sc", "case",
    "sups", "subs", "sinf", "numr", "dnom", "lnum", "onum", "tnum", "pnum", "zero", "ordn", "salt",
    "swsh", "titl",
];

/// The feature source a font compiles with: its authored code, then the
/// features its glyphs' relationships generate, except those switched off.
/// `glyphs` is in glyph order.
pub fn assembled_feature_source(
    glyphs: &[&Glyph],
    authored: Option<&str>,
    off: &BTreeSet<String>,
) -> String {
    let authored = authored.unwrap_or_default();
    let generated = generated_feature_code(glyphs, authored, off);
    match (authored.trim().is_empty(), generated.is_empty()) {
        (_, true) => authored.to_string(),
        (true, false) => generated,
        (false, false) => format!("{authored}\n\n{generated}"),
    }
}

/// One feature generated from glyph relationships.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GeneratedFeature {
    pub tag: String,
    /// The complete `feature tag { … } tag;` block.
    pub code: String,
    /// How many substitutions it makes.
    pub rules: usize,
    /// Whether it compiles; a feature switched off is still generated, to show.
    pub on: bool,
}

/// The feature code `glyphs`' relationships generate, leaving out every
/// feature `authored` defines and every feature in `off`. Empty when nothing
/// is generated.
pub fn generated_feature_code(glyphs: &[&Glyph], authored: &str, off: &BTreeSet<String>) -> String {
    generated_features(glyphs, authored, off)
        .into_iter()
        .filter(|feature| feature.on)
        .map(|feature| feature.code)
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// The features `glyphs`' relationships generate, in the order they are
/// written, leaving out every feature `authored` defines; those in `off` are
/// marked as switched off.
pub fn generated_features(
    glyphs: &[&Glyph],
    authored: &str,
    off: &BTreeSet<String>,
) -> Vec<GeneratedFeature> {
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

    ordered(features)
        .into_iter()
        .map(|(tag, mut rules)| {
            let ligatures = rules.iter().any(|rule| rule.input.len() > 1);
            // Longer ligatures first, so f_f_i wins over f_f.
            rules.sort_by_key(|rule| std::cmp::Reverse(rule.input.len()));
            let mut code = String::new();
            let _ = writeln!(code, "feature {tag} {{");
            if ligatures {
                let _ = writeln!(code, "    lookupflag IgnoreMarks;");
            }
            for rule in &rules {
                let _ = writeln!(code, "    sub {} by {};", rule.input.join(" "), rule.output);
            }
            let _ = write!(code, "}} {tag};");
            GeneratedFeature {
                on: !off.contains(&tag),
                tag,
                code,
                rules: rules.len(),
            }
        })
        .collect()
}

/// Where each switched-on feature in `features` sits in the source
/// [`assembled_feature_source`] builds from `authored`, as UTF-16 ranges, so
/// problems the compiler finds there can be pointed at their feature.
pub fn generated_feature_ranges(
    authored: &str,
    features: &[GeneratedFeature],
) -> Vec<(String, std::ops::Range<usize>)> {
    let units = |text: &str| text.encode_utf16().count();
    let mut start = if authored.trim().is_empty() {
        0
    } else {
        units(authored) + units("\n\n")
    };
    features
        .iter()
        .filter(|feature| feature.on)
        .map(|feature| {
            let end = start + units(&feature.code);
            let range = (feature.tag.clone(), start..end);
            start = end + units("\n\n");
            range
        })
        .collect()
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
        generated_feature_code(
            &glyphs.iter().collect::<Vec<_>>(),
            authored,
            &BTreeSet::new(),
        )
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
            assembled_feature_source(&refs, Some(authored), &BTreeSet::new()),
            format!("{authored}\n\n{generated}")
        );
    }

    #[test]
    fn a_feature_switched_off_is_listed_but_not_compiled() {
        let glyphs = glyphs(&["a", "a.ss01", "one", "one.tf"]);
        let refs: Vec<_> = glyphs.iter().collect();
        let off = BTreeSet::from(["ss01".to_string()]);

        let features = generated_features(&refs, "", &off);
        let source = assembled_feature_source(&refs, None, &off);

        let ss01 = features
            .iter()
            .find(|feature| feature.tag == "ss01")
            .unwrap();
        assert!(!ss01.on);
        assert!(!source.contains("feature ss01"));
        assert!(source.contains("feature tnum"));
    }

    #[test]
    fn feature_ranges_point_into_the_assembled_source() {
        let glyphs = glyphs(&["a", "a.ss01", "one", "one.tf", "b", "b.ss02"]);
        let refs: Vec<_> = glyphs.iter().collect();
        let authored = "# ✓ notes\nfeature liga { sub f i by f_i; } liga;";
        let off = BTreeSet::from(["ss02".to_string()]);
        let source: Vec<u16> = assembled_feature_source(&refs, Some(authored), &off)
            .encode_utf16()
            .collect();
        let features = generated_features(&refs, authored, &off);

        let ranges = generated_feature_ranges(authored, &features);

        let tags: Vec<_> = ranges.iter().map(|(tag, _)| tag.as_str()).collect();
        assert_eq!(
            tags,
            ["tnum", "ss01"],
            "switched-off features take no space"
        );
        for (tag, range) in ranges {
            let code = String::from_utf16(&source[range]).unwrap();
            assert!(code.starts_with(&format!("feature {tag} {{")));
            assert!(code.ends_with(&format!("}} {tag};")));
        }
    }

    #[test]
    fn authored_tags_ignore_feature_references_and_comments() {
        let tags = authored_feature_tags(
            "feature aalt { feature locl; } aalt;\nfeature ss01{\n} ss01;\n# feature cv01 {",
        );
        assert_eq!(tags.into_iter().collect::<Vec<_>>(), ["aalt", "ss01"]);
    }
}
