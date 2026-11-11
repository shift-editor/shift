//! Metrics keys glyphsLib stores in GLIF libs open as Shift's keys and are
//! written back under the same names when the font is saved as a UFO.

use std::path::Path;

use shift_backends::font_loader::FontLoader;
use shift_font::{Font, MetricsKey, MetricsKeySide, MetricsKeys};

const GLYPH_LEFT: &str = "com.schriftgestaltung.glyph.leftMetricsKey";
const GLYPH_RIGHT: &str = "com.schriftgestaltung.glyph.rightMetricsKey";
const LAYER_WIDTH: &str = "com.schriftgestaltung.layer.widthMetricsKey";
const MARK_COLOR: &str = "public.markColor";

fn text(value: &str) -> plist::Value {
    plist::Value::String(value.to_owned())
}

fn keys(entries: &[(MetricsKeySide, &str)]) -> MetricsKeys {
    entries
        .iter()
        .map(|(side, text)| (*side, MetricsKey::new(*text).unwrap()))
        .collect()
}

/// A UFO with an `o` whose GLIF lib holds glyphsLib's keys: both sides
/// linked to `n` for the whole glyph, and a width for this master only.
fn write_keyed_ufo(path: &Path) {
    let mut glyph = norad::Glyph::new("o");
    glyph.width = 560.0;
    glyph.codepoints.insert('o');
    glyph.lib.insert(GLYPH_LEFT.to_owned(), text("=n"));
    glyph.lib.insert(GLYPH_RIGHT.to_owned(), text("=|n+10"));
    glyph.lib.insert(LAYER_WIDTH.to_owned(), text("==o*1.2"));
    glyph.lib.insert(MARK_COLOR.to_owned(), text("1,0,0,1"));

    let mut font = norad::Font::new();
    font.font_info.units_per_em = Some(1000_u32.into());
    font.layers.default_layer_mut().insert_glyph(glyph);
    font.save(path).expect("fixture UFO should save");
}

fn read(path: &Path) -> Font {
    FontLoader::new().read_font(path.to_str().unwrap()).unwrap()
}

#[test]
fn glyphslib_keys_open_as_glyph_and_layer_keys() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Keys.ufo");
    write_keyed_ufo(&path);

    let font = read(&path);

    let glyph = font.glyph_by_name("o").unwrap();
    let layer = glyph.layers().values().next().unwrap();
    assert_eq!(
        glyph.metrics_keys(),
        &keys(&[
            (MetricsKeySide::Left, "=n"),
            (MetricsKeySide::Right, "=|n+10"),
        ])
    );
    assert_eq!(
        layer.metrics_keys(),
        &keys(&[(MetricsKeySide::Width, "==o*1.2")])
    );
    // The keys moved out of the libs; other lib data stays.
    assert!(layer.lib().get(GLYPH_LEFT).is_none());
    assert!(layer.lib().get(LAYER_WIDTH).is_none());
    assert!(glyph.lib().get(GLYPH_RIGHT).is_none());
    assert!(layer.lib().get(MARK_COLOR).is_some());
}

#[test]
fn saving_as_ufo_writes_the_keys_back_under_glyphslib_names() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("Keys.ufo");
    let saved = temp.path().join("Saved.ufo");
    write_keyed_ufo(&source);

    FontLoader::new()
        .write_font(&read(&source), saved.to_str().unwrap())
        .unwrap();

    let saved_ufo = norad::Font::load(&saved).unwrap();
    let lib = &saved_ufo.layers.default_layer().get_glyph("o").unwrap().lib;
    assert_eq!(lib.get(GLYPH_LEFT), Some(&text("=n")));
    assert_eq!(lib.get(GLYPH_RIGHT), Some(&text("=|n+10")));
    assert_eq!(lib.get(LAYER_WIDTH), Some(&text("==o*1.2")));
    assert_eq!(lib.get(MARK_COLOR), Some(&text("1,0,0,1")));

    let reopened = read(&saved);
    let original = read(&source);
    let reopened_o = reopened.glyph_by_name("o").unwrap();
    let original_o = original.glyph_by_name("o").unwrap();
    assert_eq!(reopened_o.metrics_keys(), original_o.metrics_keys());
    assert_eq!(
        reopened_o.layers().values().next().unwrap().metrics_keys(),
        original_o.layers().values().next().unwrap().metrics_keys()
    );
}

#[test]
fn a_lazily_opened_ufo_lists_layer_keys_before_loading_layers() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("Keys.ufo");
    write_keyed_ufo(&path);

    let opened = shift_backends::AuthoredSource::open(path.to_str().unwrap()).unwrap();
    let directory = opened.directory;

    let glyph = directory.glyph_by_name("o").unwrap();
    let placeholder = glyph.layers().values().next().unwrap();
    assert_eq!(
        placeholder.metrics_keys(),
        &keys(&[(MetricsKeySide::Width, "==o*1.2")])
    );
}
