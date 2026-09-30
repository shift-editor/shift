use super::*;

fn repo_font(path: &str) -> Vec<u8> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    std::fs::read(root.join(path)).expect("fixture font should exist")
}

fn coverage(letters: &[(Script, usize)], symbols: usize) -> Coverage {
    let letters_by_script: HashMap<Script, Vec<char>> = letters
        .iter()
        .map(|(script, count)| (*script, vec!['x'; *count]))
        .collect();
    let letter_count: usize = letters.iter().map(|(_, count)| count).sum();
    Coverage {
        characters: letter_count + symbols,
        symbols,
        letters_by_script,
    }
}

#[test]
fn shows_ag_for_a_latin_font_with_both_cases() {
    let specimen = specimen(&repo_font(
        "packages/editor/src/ui/assets/fonts/Inter-VariableFont.ttf",
    ))
    .expect("Inter draws Ag");

    assert_eq!(specimen.text, "Ag");
    assert!(!specimen.right_to_left);
    assert!(specimen.outline.starts_with('M'));
}

#[test]
fn shows_capitals_when_the_font_has_only_one_case() {
    let specimen = specimen(&repo_font("fixtures/fonts/mutatorsans/MutatorSans.ttf"))
        .expect("MutatorSans draws AG");

    assert_eq!(specimen.text, "AG");
}

#[test]
fn fits_the_viewport_to_the_ink_with_a_minimum_height() {
    let data = repo_font("fixtures/fonts/mutatorsans/MutatorSans.ttf");
    let font = SpecimenFont::new(&data).unwrap();
    let dot = Bounds {
        min_x: 100.0,
        min_y: -50.0,
        max_x: 150.0,
        max_y: 0.0,
    };

    let view_box = font.fit(dot);

    assert_eq!(view_box.height, font.units_per_em * MIN_VIEW_HEIGHT_EM);
    assert!(view_box.x < dot.min_x && view_box.x + view_box.width > dot.max_x);
    assert!(view_box.y < dot.min_y && view_box.y + view_box.height > dot.max_y);
}

#[test]
fn returns_nothing_for_bytes_that_are_not_a_font() {
    assert_eq!(specimen(b"not a font"), None);
}

#[test]
fn a_non_latin_script_is_found_even_when_the_font_has_more_latin() {
    let arabic_with_latin = coverage(&[(Script::Latin, 200), (Script::Arabic, 40)], 10);

    assert_eq!(
        arabic_with_latin.main_script(),
        Some(SpecimenScript::Arabic)
    );
}

#[test]
fn a_script_needs_twenty_letters_to_lead() {
    let a_few_hebrew_letters = coverage(&[(Script::Latin, 52), (Script::Hebrew, 19)], 0);

    assert_eq!(a_few_hebrew_letters.main_script(), None);
}

#[test]
fn kana_marks_a_japanese_font_even_with_many_han_characters() {
    let japanese = coverage(
        &[
            (Script::Han, 6000),
            (Script::Hiragana, 80),
            (Script::Katakana, 90),
        ],
        0,
    );
    let chinese = coverage(&[(Script::Han, 6000)], 0);

    assert_eq!(japanese.main_script(), Some(SpecimenScript::Japanese));
    assert_eq!(chinese.main_script(), Some(SpecimenScript::Chinese));
}

#[test]
fn a_font_that_is_mostly_symbols_is_a_symbol_font() {
    assert!(coverage(&[(Script::Latin, 10)], 11).is_symbol_font());
    assert!(!coverage(&[(Script::Latin, 10)], 10).is_symbol_font());
}

#[test]
fn resolves_a_design_language_by_script_subtag_or_language() {
    let script = |tag| match SpecimenScript::from_language_tag(tag) {
        DeclaredScript::Specimen(script) => Some(script),
        DeclaredScript::Other => None,
    };

    assert_eq!(script("fa-Arab"), Some(SpecimenScript::Arabic));
    assert_eq!(script("zh-Hant"), Some(SpecimenScript::Chinese));
    assert_eq!(script("ko"), Some(SpecimenScript::Korean));
    assert_eq!(script("th"), Some(SpecimenScript::Thai));
    assert_eq!(script("sr-Latn"), None);
    assert_eq!(script("en"), None);
}
