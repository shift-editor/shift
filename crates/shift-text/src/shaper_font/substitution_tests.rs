//! The glyphs a feature brings in, read from the `GSUB` of the shaper font
//! the editor shapes with: one test per kind of substitution lookup, then
//! the cases with nothing to list and a `GSUB` that cannot be read.

use std::sync::Arc;

use crate::shape::Tag;
use shift_font::{Font, Glyph};

use super::test_fonts::request_for;
use super::*;

/// A font with one glyph per name, and a shaper over the shaper font
/// compiled from `feature_source`.
fn shaper_with(names: &[&str], feature_source: &str) -> (Font, LiveShaper) {
    let mut font = Font::new();
    for name in names {
        font.insert_glyph(Glyph::new(*name)).unwrap();
    }
    font.features_mut()
        .set_fea_source(Some(feature_source.to_string()));
    let compilation = ShaperFont::compile(&request_for(&font).unwrap()).unwrap();
    assert!(
        compilation.diagnostics.is_empty(),
        "{:?}",
        compilation.diagnostics
    );
    let shaper =
        LiveShaper::new(Arc::new(compilation.font.unwrap()), font.character_map()).unwrap();
    (font, shaper)
}

/// Each substitution a feature makes, as `input names -> output name`.
fn rules(names: &[&str], feature_source: &str, tag: [u8; 4]) -> Vec<String> {
    let (font, shaper) = shaper_with(names, feature_source);
    let name = |glyph: &GlyphId| font.glyph(*glyph).unwrap().name().to_string();
    shaper
        .feature_substitutions(Tag::new(&tag))
        .unwrap()
        .iter()
        .map(|rule| {
            let input: Vec<String> = rule.input.iter().map(name).collect();
            format!("{} -> {}", input.join(" "), name(&rule.output))
        })
        .collect()
}

#[test]
fn a_single_substitution_by_a_shared_delta_lists_each_glyph() {
    // The same glyph-id distance for both rules compiles to format 1.
    let listed = rules(
        &["a", "b", "a.ss01", "b.ss01"],
        "feature ss01 { sub a by a.ss01; sub b by b.ss01; } ss01;",
        *b"ss01",
    );

    assert_eq!(listed, ["a -> a.ss01", "b -> b.ss01"]);
}

#[test]
fn a_single_substitution_by_a_list_lists_each_glyph() {
    // Different distances compile to format 2.
    let listed = rules(
        &["a", "b", "a.ss01", "b.ss01"],
        "feature ss01 { sub a by b.ss01; sub b by a.ss01; } ss01;",
        *b"ss01",
    );

    assert_eq!(listed, ["b -> a.ss01", "a -> b.ss01"]);
}

#[test]
fn a_multiple_substitution_lists_each_glyph_of_the_sequence() {
    let listed = rules(
        &["f", "i", "f_i"],
        "feature ccmp { sub f_i by f i; } ccmp;",
        *b"ccmp",
    );

    assert_eq!(listed, ["f_i -> f", "f_i -> i"]);
}

#[test]
fn an_alternate_substitution_lists_each_alternate() {
    let listed = rules(
        &["a", "a.alt1", "a.alt2"],
        "feature salt { sub a from [a.alt1 a.alt2]; } salt;",
        *b"salt",
    );

    assert_eq!(listed, ["a -> a.alt1", "a -> a.alt2"]);
}

#[test]
fn a_ligature_lists_every_glyph_it_replaces() {
    let listed = rules(
        &["f", "i", "f_i"],
        "feature liga { sub f i by f_i; } liga;",
        *b"liga",
    );

    assert_eq!(listed, ["f i -> f_i"]);
}

#[test]
fn a_reverse_substitution_lists_each_glyph() {
    let listed = rules(
        &["a", "b", "a.fina"],
        "feature rclt { rsub a' b by a.fina; } rclt;",
        *b"rclt",
    );

    assert_eq!(listed, ["a -> a.fina"]);
}

#[test]
fn a_contextual_rule_lists_what_the_lookup_it_calls_substitutes() {
    let listed = rules(
        &["a", "b", "a.alt"],
        "feature calt { sub a' b by a.alt; } calt;",
        *b"calt",
    );

    assert_eq!(listed, ["a -> a.alt"]);
}

#[test]
fn glyphs_no_character_reaches_still_list() {
    let listed = rules(
        &["one", "one.osf", "one.tf", "one.osf.tf"],
        "feature onum { sub one by one.osf; } onum;
         feature tnum { sub one by one.tf; sub one.osf by one.osf.tf; } tnum;",
        *b"tnum",
    );

    assert_eq!(listed, ["one -> one.tf", "one.osf -> one.osf.tf"]);
}

#[test]
fn a_positioning_feature_or_an_undefined_tag_lists_nothing() {
    let source = "feature ss01 { sub a by a.ss01; } ss01;
                  feature kern { pos a b -20; } kern;";
    let names = ["a", "b", "a.ss01"];

    assert!(rules(&names, source, *b"kern").is_empty());
    assert!(rules(&names, source, *b"smcp").is_empty());
}

#[test]
fn a_font_without_gsub_lists_nothing() {
    let (_, shaper) = shaper_with(&["a", "b"], "feature kern { pos a b -20; } kern;");
    assert!(table_record(shaper.font().bytes(), *b"GSUB").is_none());

    assert!(
        shaper
            .feature_substitutions(Tag::new(b"liga"))
            .unwrap()
            .is_empty()
    );
}

#[test]
fn a_gsub_that_cannot_be_read_is_an_error_not_an_absent_table() {
    let (_, shaper) = shaper_with(&["f", "i", "f_i"], "feature liga { sub f i by f_i; } liga;");
    let mut bytes = shaper.font().bytes().to_vec();
    let record = table_record(&bytes, *b"GSUB").unwrap();
    // Two bytes are too few for the table's header.
    bytes[record + 12..record + 16].copy_from_slice(&2_u32.to_be_bytes());
    let broken = crate::shape::Shaper::new(bytes).unwrap();

    let result = broken.feature_substitutions(&crate::shape::FontGlyphs, Tag::new(b"liga"));

    assert!(
        matches!(result, Err(ShapeError::InvalidFont(_))),
        "{result:?}"
    );
}

/// Where a table's record sits in the table directory; `None` when the font
/// has no such table.
fn table_record(bytes: &[u8], tag: [u8; 4]) -> Option<usize> {
    let count = usize::from(u16::from_be_bytes([bytes[4], bytes[5]]));
    (0..count)
        .map(|index| 12 + index * 16)
        .find(|&record| bytes[record..record + 4] == tag)
}
