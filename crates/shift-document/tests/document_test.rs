use shift_document::{NewDocument, ShiftDocument};

#[test]
fn creates_new_document_with_default_font_info() {
    let dir = tempfile::tempdir().expect("tempdir should be created");
    let path = dir.path().join("font.shift.sqlite");

    let document =
        ShiftDocument::create_new(&path, NewDocument::new()).expect("document should be created");

    let loaded = document
        .font_info()
        .expect("font info query should succeed")
        .expect("font info should exist");

    assert_eq!(loaded.family_name.as_deref(), Some("Untitled Font"));
    assert_eq!(loaded.version_major, Some(1));
    assert_eq!(loaded.version_minor, Some(0));
    assert_eq!(loaded.units_per_em, 1000);
}

#[test]
fn creates_new_document_with_custom_family_name() {
    let dir = tempfile::tempdir().expect("tempdir should be created");
    let path = dir.path().join("font.shift.sqlite");

    let document = ShiftDocument::create_new(&path, NewDocument::with_family_name("Shift Sans"))
        .expect("document should be created");

    let loaded = document
        .font_info()
        .expect("font info query should succeed")
        .expect("font info should exist");

    assert_eq!(loaded.family_name.as_deref(), Some("Shift Sans"));
    assert_eq!(loaded.units_per_em, 1000);
}
