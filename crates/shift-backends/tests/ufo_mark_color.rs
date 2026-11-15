//! A UFO's per-layer `public.markColor` opens as one colour per glyph, is
//! saved back layer by layer while that colour is untouched, and is written
//! to every layer once the glyph is tagged in Shift.

use std::error::Error;
use std::path::Path;

use shift_backends::font_loader::FontLoader;
use shift_font::{Font, FontIntentSet, LibValue, MarkColor, NamedMarkColor, Rgba, SetMarkColor};

type TestResult<T = ()> = Result<T, Box<dyn Error>>;

const ENTRY: &str = "public.markColor";
const RED: &str = "0.85,0.26,0.06,1";
const PURPLE: &str = "0.5,0.09,0.79,1";
const TEAL: &str = "0,0.5,0.5,1";
const NOT_A_COLOR: &str = "reddish";

/// The fixture's glyphs, as (name, default layer's entry, `Bold`'s entry):
/// `a` is red then teal, `b` is tagged in `Bold` only, `c` in neither, `d`
/// has a colour outside the palette, and `e` an entry that is not a colour.
const GLYPHS: [(&str, Option<&str>, Option<&str>); 5] = [
    ("a", Some(RED), Some(TEAL)),
    ("b", None, Some(PURPLE)),
    ("c", None, None),
    ("d", Some(TEAL), Some(TEAL)),
    ("e", Some(NOT_A_COLOR), None),
];

/// Each glyph's entry in one layer, in [`GLYPHS`] order.
type LayerEntries = [Option<String>; 5];

fn glif(name: &str, color: Option<&str>) -> norad::Glyph {
    let mut glyph = norad::Glyph::new(name);
    glyph.width = 500.0;
    if let Some(color) = color {
        glyph
            .lib
            .insert(ENTRY.to_owned(), plist::Value::String(color.to_owned()));
    }
    glyph
}

/// Writes the [`GLYPHS`] fixture into `folder` and opens it.
fn open_mixed_ufo(folder: &Path) -> TestResult<Font> {
    let mut ufo = norad::Font::new();
    ufo.font_info.units_per_em = Some(1000_u32.into());
    for (name, default_entry, _) in GLYPHS {
        ufo.layers
            .default_layer_mut()
            .insert_glyph(glif(name, default_entry));
    }
    let bold = ufo.layers.new_layer("Bold")?;
    for (name, _, bold_entry) in GLYPHS {
        bold.insert_glyph(glif(name, bold_entry));
    }
    let path = folder.join("Mixed.ufo");
    ufo.save(&path)?;
    Ok(FontLoader::new().read_font(&path.to_string_lossy())?)
}

fn layer_entries(layer: &norad::Layer) -> TestResult<LayerEntries> {
    let mut entries = LayerEntries::default();
    for (entry, (name, ..)) in entries.iter_mut().zip(GLYPHS) {
        let glyph = layer.get_glyph(name).ok_or("glyph missing from layer")?;
        *entry = glyph
            .lib
            .get(ENTRY)
            .and_then(plist::Value::as_string)
            .map(str::to_owned);
    }
    Ok(entries)
}

/// Saves `font` as a UFO in `folder` and returns the default layer's entries
/// and then `Bold`'s.
fn saved_entries(font: &Font, folder: &Path) -> TestResult<[LayerEntries; 2]> {
    let path = folder.join("Saved.ufo");
    FontLoader::new().write_font(font, &path.to_string_lossy())?;
    let saved = norad::Font::load(&path)?;
    let bold = saved.layers.get("Bold").ok_or("Bold layer missing")?;
    Ok([
        layer_entries(saved.layers.default_layer())?,
        layer_entries(bold)?,
    ])
}

fn tag(font: &mut Font, names: &[&str], color: Option<MarkColor>) -> TestResult {
    let glyph_ids = names
        .iter()
        .filter_map(|name| font.glyph_by_name(name))
        .map(shift_font::Glyph::id)
        .collect();
    font.apply_intents(&FontIntentSet::from(SetMarkColor { glyph_ids, color }))?;
    Ok(())
}

fn fixture_colors(font: &Font) -> [Option<MarkColor>; 5] {
    GLYPHS.map(|(name, ..)| {
        font.glyph_by_name(name)
            .and_then(shift_font::Glyph::mark_color)
    })
}

fn expected(entries: [[Option<&str>; 5]; 2]) -> [LayerEntries; 2] {
    entries.map(|layer| layer.map(|entry| entry.map(str::to_owned)))
}

const NAMED_RED: Option<MarkColor> = Some(MarkColor::Named(NamedMarkColor::Red));
const NAMED_PURPLE: Option<MarkColor> = Some(MarkColor::Named(NamedMarkColor::Purple));
const CUSTOM_TEAL: Option<MarkColor> = Some(MarkColor::Custom(Rgba {
    red: 0.0,
    green: 0.5,
    blue: 0.5,
    alpha: 1.0,
}));

#[test]
fn a_glyph_opens_with_its_default_layers_colour_and_each_layer_keeps_its_own() {
    let temp = tempfile::tempdir().unwrap();

    let font = open_mixed_ufo(temp.path()).unwrap();

    assert_eq!(
        fixture_colors(&font),
        [NAMED_RED, None, None, CUSTOM_TEAL, None]
    );
    let a = font.glyph_by_name("a").unwrap();
    let default_source_id = font.default_source_id().unwrap();
    assert_eq!(a.layers().len(), 2);
    for layer in a.layers().values() {
        let entry = if layer.source_id() == default_source_id {
            RED
        } else {
            TEAL
        };
        assert_eq!(
            layer.lib().get(ENTRY),
            Some(&LibValue::String(entry.to_owned()))
        );
    }
    // The glyph's colour is its field, not a copy of the entry in its lib.
    assert!(a.lib().get(ENTRY).is_none());
}

#[test]
fn a_lazily_opened_ufo_lists_each_glyphs_colour_before_loading_layers() {
    let temp = tempfile::tempdir().unwrap();
    open_mixed_ufo(temp.path()).unwrap();
    let path = temp.path().join("Mixed.ufo");

    let opened = shift_backends::AuthoredSource::open(&path.to_string_lossy()).unwrap();

    assert_eq!(
        fixture_colors(&opened.directory),
        [NAMED_RED, None, None, CUSTOM_TEAL, None]
    );
}

#[test]
fn saving_untouched_glyphs_keeps_every_layers_own_entry() {
    let temp = tempfile::tempdir().unwrap();
    let font = open_mixed_ufo(temp.path()).unwrap();

    let saved = saved_entries(&font, temp.path()).unwrap();

    assert_eq!(
        saved,
        expected([
            GLYPHS.map(|(_, default_entry, _)| default_entry),
            GLYPHS.map(|(_, _, bold_entry)| bold_entry),
        ])
    );
}

#[test]
fn a_glyph_tagged_in_shift_is_saved_with_that_colour_in_every_layer() {
    let temp = tempfile::tempdir().unwrap();
    let mut font = open_mixed_ufo(temp.path()).unwrap();

    tag(&mut font, &["a", "c", "e"], NAMED_PURPLE).unwrap();
    let saved = saved_entries(&font, temp.path()).unwrap();

    assert_eq!(
        saved,
        expected([
            [Some(PURPLE), None, Some(PURPLE), Some(TEAL), Some(PURPLE)],
            [
                Some(PURPLE),
                Some(PURPLE),
                Some(PURPLE),
                Some(TEAL),
                Some(PURPLE)
            ],
        ])
    );
}

#[test]
fn a_glyph_cleared_in_shift_is_saved_with_no_colour_in_any_layer() {
    let temp = tempfile::tempdir().unwrap();
    let mut font = open_mixed_ufo(temp.path()).unwrap();

    tag(&mut font, &["a", "d"], None).unwrap();
    let saved = saved_entries(&font, temp.path()).unwrap();

    assert_eq!(
        saved,
        expected([
            [None, None, None, None, Some(NOT_A_COLOR)],
            [None, Some(PURPLE), None, None, None],
        ])
    );
}
