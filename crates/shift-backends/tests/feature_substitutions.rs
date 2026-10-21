//! The glyphs a feature brings in, read from the `GSUB` of the shaper font
//! the editor shapes with: one test per kind of substitution lookup, then
//! the cases with nothing to list and a `GSUB` that cannot be read.

use shift_backends::shaper_font::{ShaperFont, ShaperFontRequest};
use shift_font::{Font, Glyph};
use shift_shape::{FontGlyphs, ShapeError, Shaper, Substitution, Tag};

/// A shaper font with one glyph per name, compiled from `feature_source`.
fn shaper_font(names: &[&str], feature_source: &str) -> ShaperFont {
    let mut font = Font::new();
    for name in names {
        font.insert_glyph(Glyph::new(*name)).unwrap();
    }
    font.features_mut()
        .set_fea_source(Some(feature_source.to_string()));
    let compilation = ShaperFont::compile(&ShaperFontRequest::from_font(&font).unwrap()).unwrap();
    assert!(
        compilation.diagnostics.is_empty(),
        "{:?}",
        compilation.diagnostics
    );
    compilation.font.unwrap()
}

/// Each substitution a feature makes as `input names -> output name`.
fn rules(font: &ShaperFont, tag: [u8; 4]) -> Vec<String> {
    let shaper = Shaper::new(font.bytes().to_vec()).unwrap();
    let substitutions = shaper
        .feature_substitutions(&FontGlyphs, Tag::new(&tag))
        .unwrap();
    named(font, &substitutions)
}

fn named(font: &ShaperFont, substitutions: &[Substitution<u32>]) -> Vec<String> {
    let name = |glyph: &u32| font.glyph_names()[usize::try_from(*glyph).unwrap()].clone();
    substitutions
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
    let font = shaper_font(
        &["a", "b", "a.ss01", "b.ss01"],
        "feature ss01 { sub a by a.ss01; sub b by b.ss01; } ss01;",
    );

    assert_eq!(rules(&font, *b"ss01"), ["a -> a.ss01", "b -> b.ss01"]);
}

#[test]
fn a_single_substitution_by_a_list_lists_each_glyph() {
    // Different distances compile to format 2.
    let font = shaper_font(
        &["a", "b", "a.ss01", "b.ss01"],
        "feature ss01 { sub a by b.ss01; sub b by a.ss01; } ss01;",
    );

    assert_eq!(rules(&font, *b"ss01"), ["b -> a.ss01", "a -> b.ss01"]);
}

#[test]
fn a_multiple_substitution_lists_each_glyph_of_the_sequence() {
    let font = shaper_font(&["f", "i", "f_i"], "feature ccmp { sub f_i by f i; } ccmp;");

    assert_eq!(rules(&font, *b"ccmp"), ["f_i -> f", "f_i -> i"]);
}

#[test]
fn an_alternate_substitution_lists_each_alternate() {
    let font = shaper_font(
        &["a", "a.alt1", "a.alt2"],
        "feature salt { sub a from [a.alt1 a.alt2]; } salt;",
    );

    assert_eq!(rules(&font, *b"salt"), ["a -> a.alt1", "a -> a.alt2"]);
}

#[test]
fn a_ligature_lists_every_glyph_it_replaces() {
    let font = shaper_font(&["f", "i", "f_i"], "feature liga { sub f i by f_i; } liga;");

    assert_eq!(rules(&font, *b"liga"), ["f i -> f_i"]);
}

#[test]
fn a_reverse_substitution_lists_each_glyph() {
    let font = shaper_font(
        &["a", "b", "a.fina"],
        "feature rclt { rsub a' b by a.fina; } rclt;",
    );

    assert_eq!(rules(&font, *b"rclt"), ["a -> a.fina"]);
}

#[test]
fn a_contextual_rule_lists_what_the_lookup_it_calls_substitutes() {
    let font = shaper_font(
        &["a", "b", "a.alt"],
        "feature calt { sub a' b by a.alt; } calt;",
    );

    assert_eq!(rules(&font, *b"calt"), ["a -> a.alt"]);
}

#[test]
fn glyphs_no_character_reaches_still_list() {
    let font = shaper_font(
        &["one", "one.osf", "one.tf", "one.osf.tf"],
        "feature onum { sub one by one.osf; } onum;
         feature tnum { sub one by one.tf; sub one.osf by one.osf.tf; } tnum;",
    );

    assert_eq!(
        rules(&font, *b"tnum"),
        ["one -> one.tf", "one.osf -> one.osf.tf"]
    );
}

#[test]
fn a_positioning_feature_or_an_undefined_tag_lists_nothing() {
    let font = shaper_font(
        &["a", "b", "a.ss01"],
        "feature ss01 { sub a by a.ss01; } ss01;
         feature kern { pos a b -20; } kern;",
    );

    assert!(rules(&font, *b"kern").is_empty());
    assert!(rules(&font, *b"smcp").is_empty());
}

#[test]
fn a_font_without_gsub_lists_nothing() {
    let font = shaper_font(&["a", "b"], "feature kern { pos a b -20; } kern;");
    assert!(table_range(font.bytes(), *b"GSUB").is_none());

    assert!(rules(&font, *b"liga").is_empty());
}

#[test]
fn a_gsub_that_cannot_be_read_is_an_error_not_an_absent_table() {
    let font = shaper_font(&["f", "i", "f_i"], "feature liga { sub f i by f_i; } liga;");
    let mut bytes = font.bytes().to_vec();
    let (record, _) = table_range(&bytes, *b"GSUB").unwrap();
    // Two bytes are too few for the table's header.
    bytes[record + 12..record + 16].copy_from_slice(&2_u32.to_be_bytes());
    let shaper = Shaper::new(bytes).unwrap();

    let result = shaper.feature_substitutions(&FontGlyphs, Tag::new(b"liga"));

    assert!(
        matches!(result, Err(ShapeError::InvalidFont(_))),
        "{result:?}"
    );
}

/// Where a table's record sits in the table directory, and the table's
/// offset; `None` when the font has no such table.
fn table_range(bytes: &[u8], tag: [u8; 4]) -> Option<(usize, usize)> {
    let count = usize::from(u16::from_be_bytes([bytes[4], bytes[5]]));
    (0..count).map(|index| 12 + index * 16).find_map(|record| {
        let offset = u32::from_be_bytes(bytes[record + 8..record + 12].try_into().unwrap());
        (bytes[record..record + 4] == tag).then(|| (record, usize::try_from(offset).unwrap()))
    })
}
