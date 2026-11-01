use write_fonts::FontBuilder;
use write_fonts::read::FontRef as WriteFontRef;
use write_fonts::tables::name::{Name, NameRecord};
use write_fonts::types::NameId;

use super::*;
use crate::specimen;

const INTER: &str = "packages/editor/src/ui/assets/fonts/Inter-VariableFont.ttf";

fn inter() -> Vec<u8> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    std::fs::read(root.join(INTER)).expect("Inter fixture should exist")
}

/// Inter with its `name` table replaced by a family (ID 1) and, optionally, a
/// typographic family (ID 16).
fn inter_named(family: &str, typographic_family: Option<&str>) -> Vec<u8> {
    let data = inter();
    let record = |id: u16, text: &str| {
        NameRecord::new(3, 1, 0x409, NameId::new(id), text.to_string().into())
    };
    let mut records = vec![record(1, family), record(2, "Regular")];
    records.extend(typographic_family.map(|text| record(16, text)));

    FontBuilder::new()
        .add_table(&Name::new(records))
        .expect("name table should compile")
        .copy_missing_tables(WriteFontRef::new(&data).expect("Inter should parse"))
        .build()
}

fn family_name_of(data: &[u8]) -> Option<NameSpecimen> {
    specimen(data).expect("Inter draws Ag").family_name
}

fn fit(one_line_em: f64, two_lines_em: Option<f64>) -> Option<Fitted> {
    choose_fit(one_line_em, two_lines_em, NameBox { width: 320.0 })
}

#[test]
fn a_short_name_is_set_at_full_size() {
    assert_eq!(
        fit(5.0, None),
        Some(Fitted {
            fit: NameFit::Full,
            type_size: FULL,
        })
    );
}

#[test]
fn a_wide_name_shrinks_to_fit_down_to_48px() {
    let scaled = fit(320.0 / 50.0, None).expect("fits at 50 px");

    assert_eq!(scaled.fit, NameFit::Scaled);
    assert_eq!(scaled.type_size.size, 50.0);
    assert!(scaled.type_size.line_height > 50.0);
    assert_eq!(
        fit(320.0 / 48.0, None).map(|fitted| fitted.fit),
        Some(NameFit::Scaled)
    );
}

#[test]
fn a_name_too_long_for_48px_breaks_onto_two_lines_at_34px() {
    let two_lines = fit(12.0, Some(6.0)).expect("each line fits at 34 px");

    assert_eq!(
        two_lines,
        Fitted {
            fit: NameFit::TwoLines,
            type_size: TWO_LINES,
        }
    );
}

#[test]
fn two_lines_shrink_to_fit_down_to_32px() {
    let two_lines = fit(20.0, Some(320.0 / 33.0)).expect("fits at 33 px");

    assert_eq!(two_lines.fit, NameFit::TwoLines);
    assert_eq!(two_lines.type_size.size, 33.0);
}

#[test]
fn a_name_under_32px_on_two_lines_falls_back() {
    assert_eq!(fit(20.0, Some(320.0 / 31.0)), None);
}

#[test]
fn a_long_name_without_a_word_break_falls_back() {
    assert_eq!(fit(20.0, None), None);
}

#[test]
fn draws_a_short_family_name_in_the_font_on_one_line() {
    let name = family_name_of(&inter()).expect("Inter fits its name");

    assert_eq!(name.text, "Inter");
    assert_eq!(name.fit, NameFit::Full);
    assert_eq!(name.height, FULL.line_height);
    assert!(name.outline.starts_with('M'));
    assert!(name.width <= NameBox::WIDE_TILE.width);
}

#[test]
fn aligns_the_ink_with_the_left_edge_of_the_box() {
    let name = family_name_of(&inter()).expect("Inter fits its name");

    let first_x: f64 = name.outline[1..]
        .split(' ')
        .next()
        .and_then(|x| x.parse().ok())
        .expect("outline starts with a move");
    assert!(name.view_box.x <= first_x);
    assert!(
        name.view_box.x > 0.0,
        "Inter's I has a left sidebearing to skip"
    );
}

#[test]
fn scales_a_wide_name_to_the_box() {
    let name = family_name_of(&inter_named("Interconnected", None)).expect("fits on one line");

    assert_eq!(name.fit, NameFit::Scaled);
    assert!((name.width - NameBox::WIDE_TILE.width).abs() < 0.01);
    assert!(name.height >= SCALED_FLOOR.line_height);
}

#[test]
fn breaks_a_long_name_at_a_word_into_two_balanced_lines() {
    let name = family_name_of(&inter_named("Bricolage Grotesque Condensed", None))
        .expect("fits on two lines");

    assert_eq!(name.fit, NameFit::TwoLines);
    assert_eq!(name.height, 2.0 * TWO_LINES.line_height);
    assert!(name.width <= NameBox::WIDE_TILE.width);
}

#[test]
fn falls_back_when_the_name_is_too_long_for_two_lines() {
    let unbreakable = inter_named("Supercalifragilisticexpialidocious", None);
    let too_long = inter_named(
        "Noto Sans Canadian Aboriginal Syllabics Extended Condensed",
        None,
    );

    assert_eq!(family_name_of(&unbreakable), None);
    assert_eq!(family_name_of(&too_long), None);
}

#[test]
fn falls_back_when_the_font_cannot_draw_its_name() {
    assert_eq!(family_name_of(&inter_named("名前", None)), None);
}

#[test]
fn prefers_the_typographic_family_name() {
    let data = inter_named("Inter Display SemiBold", Some("Inter Display"));

    assert_eq!(
        family_name_of(&data).map(|name| name.text),
        Some("Inter Display".to_string())
    );
}

#[test]
fn uses_the_family_name_without_a_typographic_one() {
    let data = inter_named("Inter Tight", None);

    assert_eq!(
        family_name_of(&data).map(|name| name.text),
        Some("Inter Tight".to_string())
    );
}
