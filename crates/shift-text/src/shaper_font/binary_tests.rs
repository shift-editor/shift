//! A compiled font shaping as its own shaper font: its `cmap`, advances and
//! every lookup it ships.

use std::path::PathBuf;
use std::sync::Arc;

use shift_backends::font_loader::FontLoader;
use shift_backends::font_source::FontSource;
use shift_font::{ExternalLocation, Font, GlyphId};

use crate::shape::Tag;

use super::*;

/// Inter's variable TTF, the font imported from it, and its glyph ids in
/// the binary's glyph order.
struct Compiled {
    bytes: Vec<u8>,
    font: Font,
    glyph_ids: Vec<Option<GlyphId>>,
}

fn inter() -> Compiled {
    compiled("packages/editor/src/ui/assets/fonts/Inter-VariableFont.ttf")
}

/// Noto Naskh Arabic: joining forms, lam-alef ligatures and mark attachment
/// in its own `GSUB` and `GPOS`.
fn naskh() -> Compiled {
    compiled("fixtures/fonts/noto-naskh-arabic/NotoNaskhArabic-Regular.ttf")
}

/// The compiled font at `path`, from the repository root.
fn compiled(path: &str) -> Compiled {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(path);
    let bytes = std::fs::read(&path).unwrap();
    let font = FontLoader::new().read_font(path.to_str().unwrap()).unwrap();
    let opened = FontLoader::new().open_source(&path).unwrap();
    let glyph_ids = opened
        .directory()
        .glyphs()
        .iter()
        .map(|glyph| font.glyph_by_name(&glyph.name).map(shift_font::Glyph::id))
        .collect();
    Compiled {
        bytes,
        font,
        glyph_ids,
    }
}

fn shaper(compiled: &Compiled) -> LiveShaper {
    let shaper_font = ShaperFont::from_binary(
        compiled.bytes.clone(),
        compiled.glyph_ids.clone(),
        compiled.font.axes(),
        compiled.font.axis_mappings(),
    )
    .unwrap();
    LiveShaper::new(Arc::new(shaper_font), []).unwrap()
}

/// `text` shaped at `location` with `features`, each glyph's name and
/// advance.
fn shaped_at(
    compiled: &Compiled,
    shaper: &LiveShaper,
    text: &str,
    location: &ExternalLocation,
    features: &[FeatureSetting],
) -> Vec<(String, i32)> {
    let units: Vec<ShapeUnit> = text.chars().map(ShapeUnit::Character).collect();
    let request = ShapeRequest {
        units: &units,
        location,
        direction: None,
        script: None,
        language: None,
        features,
    };
    shaper
        .shape(&request)
        .unwrap()
        .iter()
        .map(|glyph| {
            let name = glyph.glyph_id.map_or_else(
                || ".notdef".to_string(),
                |id| compiled.font.glyph(id).unwrap().name().to_string(),
            );
            (name, glyph.x_advance)
        })
        .collect()
}

fn shaped(
    compiled: &Compiled,
    shaper: &LiveShaper,
    text: &str,
    features: &[FeatureSetting],
) -> Vec<(String, i32)> {
    shaped_at(compiled, shaper, text, &ExternalLocation::new(), features)
}

fn off(tag: &str) -> FeatureSetting {
    FeatureSetting::parse(tag, 0).unwrap()
}

fn names(glyphs: &[(String, i32)]) -> Vec<&str> {
    glyphs.iter().map(|(name, _)| name.as_str()).collect()
}

#[test]
fn lists_the_features_the_font_ships() {
    let compiled = inter();
    let tags: Vec<String> = shaper(&compiled)
        .features()
        .unwrap()
        .into_iter()
        .map(|feature| feature.tag)
        .collect();

    for tag in ["calt", "kern", "mark", "ss01", "frac", "tnum"] {
        assert!(tags.iter().any(|listed| listed == tag), "{tag} in {tags:?}");
    }
}

#[test]
fn substitutes_with_the_font_s_own_gsub_unless_turned_off() {
    let compiled = inter();
    let shaper = shaper(&compiled);

    assert_eq!(
        names(&shaped(&compiled, &shaper, "->", &[])),
        ["arrowright"]
    );
    assert_eq!(
        names(&shaped(&compiled, &shaper, "->", &[off("calt")])),
        ["hyphen", "greater"]
    );
}

#[test]
fn advances_glyphs_by_the_font_s_hmtx_and_kerns_by_its_gpos() {
    let compiled = inter();
    let shaper = shaper(&compiled);

    let unkerned = shaped(&compiled, &shaper, "AV", &[off("kern")]);
    let kerned = shaped(&compiled, &shaper, "AV", &[]);

    assert_eq!(unkerned, [("A".to_string(), 1413), ("V".to_string(), 1413)]);
    assert_eq!(names(&kerned), ["A", "V"]);
    assert!(kerned[0].1 < unkerned[0].1, "{kerned:?}");
}

#[test]
fn advances_vary_with_the_location_through_the_font_s_axes() {
    let compiled = inter();
    let shaper = shaper(&compiled);
    let weight = compiled
        .font
        .axes()
        .iter()
        .find(|axis| axis.tag() == "wght")
        .unwrap();
    let at = |value| ExternalLocation::from_map([(weight.id(), value)]);

    let thin = shaped_at(&compiled, &shaper, "a", &at(100.0), &[]);
    let black = shaped_at(&compiled, &shaper, "a", &at(900.0), &[]);

    assert!(thin[0].1 < black[0].1, "{thin:?} {black:?}");
}

#[test]
fn maps_characters_through_the_font_s_own_cmap() {
    let compiled = inter();
    let shaper = shaper(&compiled);
    let a = compiled.font.glyph_by_name("a").unwrap().id();

    assert_eq!(shaper.character_glyph(u32::from('a')), Some(a));
}

#[test]
fn a_whole_font_has_no_insert_markers_and_its_own_line_metrics() {
    let compiled = inter();
    let shaper = shaper(&compiled);
    let font = shaper.font();

    assert!(font.is_whole());
    assert!(font.insert_markers().is_empty());
    assert!(!shaper.runs_generated(Tag::new(b"kern"), &[]));
    let metrics = font.line_metrics().unwrap();
    assert_eq!(metrics.units_per_em, 2048.0);
    assert!(
        metrics.ascender > 0.0 && metrics.descender < 0.0,
        "{metrics:?}"
    );
}

#[test]
fn refuses_glyph_ids_that_do_not_number_the_font_s_glyphs() {
    let compiled = inter();
    let mut glyph_ids = compiled.glyph_ids.clone();
    glyph_ids.pop();

    let error = ShaperFont::from_binary(
        compiled.bytes.clone(),
        glyph_ids,
        compiled.font.axes(),
        compiled.font.axis_mappings(),
    )
    .unwrap_err();

    assert!(
        matches!(
            error,
            ShaperFontError::Binary(BinaryShaperError::GlyphCount { .. })
        ),
        "{error}"
    );
}

#[test]
fn refuses_axes_that_are_not_the_font_s() {
    let compiled = inter();

    let error = ShaperFont::from_binary(
        compiled.bytes.clone(),
        compiled.glyph_ids.clone(),
        &compiled.font.axes()[..1],
        &[],
    )
    .unwrap_err();

    assert!(
        matches!(
            error,
            ShaperFontError::Binary(BinaryShaperError::Axes { .. })
        ),
        "{error}"
    );
}

#[test]
fn refuses_bytes_that_are_not_a_font() {
    let error = ShaperFont::from_binary(b"not a font".to_vec(), Vec::new(), &[], &[]).unwrap_err();

    assert!(
        matches!(
            error,
            ShaperFontError::Binary(BinaryShaperError::Unreadable(_))
        ),
        "{error}"
    );
}

#[test]
fn joins_arabic_with_the_font_s_own_forms_and_ligatures() {
    let compiled = naskh();
    let shaper = shaper(&compiled);

    // Right to left, so the final form comes first.
    assert_eq!(
        names(&shaped(&compiled, &shaper, "ببب", &[])),
        ["uniFE90", "uniFE92", "uniFE91"]
    );
    assert_eq!(
        names(&shaped(&compiled, &shaper, "لا", &[])),
        ["uniFE8E.rlig", "uniFEDF.rlig"]
    );
}

#[test]
fn attaches_a_mark_by_the_font_s_own_gpos() {
    let compiled = naskh();
    let shaper = shaper(&compiled);
    let units: Vec<ShapeUnit> = "بَ".chars().map(ShapeUnit::Character).collect();
    let location = ExternalLocation::new();
    let request = ShapeRequest {
        units: &units,
        location: &location,
        direction: None,
        script: None,
        language: None,
        features: &[],
    };

    let shaped = shaper.shape(&request).unwrap();
    let fatha = shaped.iter().find(|glyph| glyph.is_mark).unwrap();

    assert_eq!(fatha.x_advance, 0);
    assert_ne!((fatha.x_offset, fatha.y_offset), (0, 0));
}

/// `text` shaped at `location` with `features`, written as `hb-shape` writes
/// a buffer: `[name=cluster@x,y+advance|…]`, the offset left out when zero.
fn hb_shape(
    compiled: &Compiled,
    text: &str,
    location: &ExternalLocation,
    features: &[FeatureSetting],
) -> String {
    let shaper = shaper(compiled);
    let units: Vec<ShapeUnit> = text.chars().map(ShapeUnit::Character).collect();
    let request = ShapeRequest {
        units: &units,
        location,
        direction: None,
        script: None,
        language: None,
        features,
    };
    let glyphs: Vec<String> = shaper
        .shape(&request)
        .unwrap()
        .iter()
        .map(|glyph| {
            let name = glyph.glyph_id.map_or_else(
                || ".notdef".to_string(),
                |id| compiled.font.glyph(id).unwrap().name().to_string(),
            );
            let offset = if (glyph.x_offset, glyph.y_offset) == (0, 0) {
                String::new()
            } else {
                format!("@{},{}", glyph.x_offset, glyph.y_offset)
            };
            format!("{name}={}{offset}+{}", glyph.cluster, glyph.x_advance)
        })
        .collect();
    format!("[{}]", glyphs.join("|"))
}

/// Inter at `wght` `value`.
fn weight(compiled: &Compiled, value: f64) -> ExternalLocation {
    let axis = compiled
        .font
        .axes()
        .iter()
        .find(|axis| axis.tag() == "wght")
        .unwrap();
    ExternalLocation::from_map([(axis.id(), value)])
}

// Expected values are HarfBuzz 14.5.1's, from `hb-shape <font> <text>
// [--variations=wght=…] [--features=-kern]` (nixpkgs `harfbuzz.dev`), with
// the fonts as committed. Shaping the binary must match HarfBuzz exactly.

#[test]
fn shapes_inter_as_harfbuzz_does() {
    let inter = inter();
    let default = ExternalLocation::new();

    assert_eq!(hb_shape(&inter, "AV", &default, &[]), "[A=0+1273|V=1+1413]");
    assert_eq!(
        hb_shape(&inter, "AV", &weight(&inter, 700.0), &[]),
        "[A=0+1367|V=1+1529]"
    );
    assert_eq!(
        hb_shape(&inter, "AV", &weight(&inter, 700.0), &[off("kern")]),
        "[A=0+1529|V=1+1529]"
    );
    assert_eq!(
        hb_shape(&inter, "office", &weight(&inter, 900.0), &[]),
        "[o=0+1280|f=1+774|f=2+896|i=3+606|c=4+1235|e=5+1242]"
    );
}

#[test]
fn shapes_arabic_as_harfbuzz_does() {
    let naskh = naskh();
    let default = ExternalLocation::new();

    assert_eq!(
        hb_shape(&naskh, "ببب", &default, &[]),
        "[uniFE90=2+817|uniFE92=1+292|uniFE91=0+275]"
    );
    assert_eq!(
        hb_shape(&naskh, "بَ", &default, &[]),
        "[uni064E=0@275,26+0|uni0628=0+772]"
    );
    assert_eq!(
        hb_shape(&naskh, "لا", &default, &[]),
        "[uniFE8E.rlig=1+0|uniFEDF.rlig=0+518]"
    );
}
