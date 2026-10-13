mod support;

use std::path::Path;

use shift_backends::font_loader::FontLoader;
use support::{load_font, shift, shift_with_stdin};

fn mutatorsans() -> String {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/fonts/mutatorsans-variable/MutatorSans.designspace")
        .to_string_lossy()
        .into_owned()
}

#[test]
fn a_font_created_from_another_takes_its_structure_but_no_glyphs() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let path = path.to_str().unwrap();
    let source = FontLoader::new().read_font(&mutatorsans()).unwrap();

    let output = shift(&["font", "create", path, "--from", &mutatorsans()]);

    assert!(
        output.status.success(),
        "{:?}",
        String::from_utf8_lossy(&output.stderr)
    );
    let created = load_font(path);
    assert_eq!(created.glyph_count(), 0);
    assert_eq!(created.metadata(), source.metadata());
    assert_eq!(created.metrics(), source.metrics());
    let tags = |font: &shift_font::Font| {
        font.axes()
            .iter()
            .map(|axis| axis.tag().to_string())
            .collect::<Vec<_>>()
    };
    assert_eq!(tags(&created), tags(&source));
    let names = |font: &shift_font::Font| {
        font.sources()
            .iter()
            .map(|source| source.name().to_string())
            .collect::<Vec<_>>()
    };
    assert_eq!(names(&created), names(&source));
    assert!(created.features().fea_source().is_none());
}

#[test]
fn glyphs_set_by_master_name_land_in_the_matching_masters() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Lab.shift");
    let path = path.to_str().unwrap();
    assert!(
        shift(&["font", "create", path, "--from", &mutatorsans()])
            .status
            .success()
    );
    let created = load_font(path);
    let masters: Vec<String> = created
        .sources()
        .iter()
        .map(|source| source.name().to_string())
        .collect();
    let entries: Vec<String> = masters
        .iter()
        .map(|master| format!(r#"{{"name":"I","source":"{master}","layer":{{"advance":300}}}}"#))
        .collect();

    let output = shift_with_stdin(
        &["glyph", "set", path, "--input", "-"],
        &format!(r#"{{"glyphs":[{}]}}"#, entries.join(",")),
    );

    assert!(
        output.status.success(),
        "{:?}",
        String::from_utf8_lossy(&output.stderr)
    );
    let font = load_font(path);
    assert_eq!(
        font.glyph_by_name("I").unwrap().layers().len(),
        masters.len()
    );
}
