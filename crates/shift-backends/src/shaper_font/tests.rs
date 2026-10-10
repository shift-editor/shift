use std::collections::HashMap;
use std::str::FromStr;

use harfrust::font::{BuiltinFontFuncs, FontFuncs};
use harfrust::{
    FontRef, GlyphId, ShapeOptions, ShaperData, ShaperInstance, UnicodeBuffer, Variation,
};
use shift_font::test_support::sample_variable_font;

use super::*;

/// Shapes `text` the way Shift shapes live text: characters map through the
/// font's glyph names and every base advance is zero, so positions carry only
/// what `GPOS` contributes.
fn shape(font: &ShaperFont, text: &str, variations: &[&str]) -> Vec<(String, u32, i32)> {
    let binary = FontRef::new(font.bytes()).unwrap();
    let data = ShaperData::new(&binary);
    let variations = variations
        .iter()
        .map(|variation| Variation::from_str(variation).unwrap())
        .collect::<Vec<_>>();
    let instance = ShaperInstance::from_variations(&binary, variations);
    let shaper = data.shaper(&binary).instance(Some(&instance)).build();
    let mut buffer = UnicodeBuffer::new();
    buffer.push_str(text);
    buffer.guess_segment_properties();
    let mut funcs = LiveFuncs::new(font);

    let shaped = shaper.shape(buffer, ShapeOptions::new().font_funcs(Some(&mut funcs)));

    shaped
        .glyph_infos()
        .iter()
        .zip(shaped.glyph_positions())
        .map(|(info, position)| {
            let name = font.glyph_names()[info.glyph_id as usize].clone();
            (name, info.cluster, position.x_advance)
        })
        .collect()
}

/// Maps each single-character glyph name to its character, with zero
/// advances.
struct LiveFuncs {
    glyphs: HashMap<u32, GlyphId>,
}

impl LiveFuncs {
    fn new(font: &ShaperFont) -> Self {
        let glyphs = font
            .glyph_names()
            .iter()
            .enumerate()
            .filter_map(|(glyph_id, name)| {
                let mut characters = name.chars();
                let character = characters.next()?;
                characters
                    .next()
                    .is_none()
                    .then(|| (u32::from(character), GlyphId::new(glyph_id as u32)))
            })
            .collect();
        Self { glyphs }
    }
}

impl FontFuncs for LiveFuncs {
    fn nominal_glyph(&mut self, _builtin: &BuiltinFontFuncs, c: u32) -> Option<GlyphId> {
        self.glyphs.get(&c).copied()
    }

    fn advance_width(&mut self, _builtin: &BuiltinFontFuncs, _glyph: GlyphId) -> i32 {
        0
    }
}

fn request(glyph_names: &[&str], feature_source: &str) -> ShaperFontRequest {
    ShaperFontRequest {
        units_per_em: 1000,
        glyph_names: glyph_names.iter().map(|name| name.to_string()).collect(),
        feature_source: feature_source.to_string(),
        axes: Vec::new(),
    }
}

fn compiled(request: &ShaperFontRequest) -> ShaperFont {
    let compilation = compile_shaper_font(request).unwrap();
    assert!(compilation.diagnostics.is_empty(), "{}", compilation.report);
    compilation.font.unwrap()
}

const LIGATURE: &str = "feature liga { sub f i by f_i; } liga;";

#[test]
fn authored_ligature_substitutes_through_live_character_mapping() {
    let font = compiled(&request(&[".notdef", "f", "i", "f_i"], LIGATURE));

    assert_eq!(shape(&font, "fi", &[]), vec![("f_i".to_string(), 0, 0)]);
}

#[test]
fn variable_kerning_resolves_at_the_shaped_location() {
    let mut font = sample_variable_font();
    font.features_mut().set_fea_source(Some(
        "feature kern { pos A A (wght=400:-50 wght=900:-90); } kern;".to_string(),
    ));
    let shaper_font = compiled(&ShaperFontRequest::from_font(&font).unwrap());

    let kern_at = |variation| shape(&shaper_font, "AA", &[variation])[0].2;

    assert_eq!(kern_at("wght=400"), -50);
    assert_eq!(kern_at("wght=900"), -90);
}

#[test]
fn source_errors_report_utf16_ranges_without_a_font() {
    let source = "# café ☕\nfeature liga { sub f i by missing; } liga;";

    let compilation = compile_shaper_font(&request(&[".notdef", "f", "i"], source)).unwrap();

    assert!(compilation.font.is_none());
    let error = compilation
        .diagnostics
        .iter()
        .find(|diagnostic| diagnostic.severity == DiagnosticSeverity::Error)
        .unwrap();
    let utf16: Vec<u16> = source.encode_utf16().collect();
    assert_eq!(
        String::from_utf16(&utf16[error.range.clone()]).unwrap(),
        "missing"
    );
    assert!(!compilation.report.is_empty());
}

#[test]
fn include_statements_are_reported_as_errors() {
    let compilation = compile_shaper_font(&request(&[".notdef"], "include(other.fea);")).unwrap();

    assert!(compilation.font.is_none());
    assert!(compilation
        .diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity == DiagnosticSeverity::Error));
}

#[test]
fn generated_features_get_markers_unless_authored() {
    let font = compiled(&request(
        &[".notdef", "A"],
        "feature kern { pos A A -10; } kern;",
    ));

    assert_eq!(
        font.insert_markers(),
        [
            InsertMarker {
                tag: "curs".to_string(),
                lookup_index: None,
            },
            InsertMarker {
                tag: "mark".to_string(),
                lookup_index: None,
            },
            InsertMarker {
                tag: "mkmk".to_string(),
                lookup_index: None,
            },
        ]
    );
}

#[test]
fn request_puts_notdef_first_and_reads_the_font() {
    let mut font = sample_variable_font();
    font.features_mut()
        .set_fea_source(Some(LIGATURE.to_string()));

    let request = ShaperFontRequest::from_font(&font).unwrap();

    assert_eq!(request.glyph_names[0], NOTDEF);
    assert_eq!(
        request
            .glyph_names
            .iter()
            .filter(|name| *name == NOTDEF)
            .count(),
        1
    );
    assert!(request.glyph_names.iter().any(|name| name == "A"));
    assert_eq!(request.feature_source, LIGATURE);
    assert_eq!(request.axes.len(), font.axes().len());
}

#[test]
fn state_keeps_the_last_valid_font_while_source_has_errors() {
    let glyphs = [".notdef", "f", "i", "f_i"];
    let mut state = ShaperFontState::default();

    assert!(state.update(request(&glyphs, LIGATURE)).unwrap());
    let valid = state.font().cloned().unwrap();
    assert_eq!(state.revision(), 1);

    assert!(!state.update(request(&glyphs, "feature liga {")).unwrap());
    assert!(Arc::ptr_eq(state.font().unwrap(), &valid));
    assert!(!state.diagnostics().is_empty());
    assert_eq!(state.revision(), 1);

    assert!(state.update(request(&glyphs, LIGATURE)).unwrap());
    assert!(state.diagnostics().is_empty());
    assert_eq!(state.revision(), 2);
}

#[test]
fn state_skips_an_unchanged_request() {
    let glyphs = [".notdef", "f", "i", "f_i"];
    let mut state = ShaperFontState::default();
    state.update(request(&glyphs, LIGATURE)).unwrap();
    let first = state.font().cloned().unwrap();

    assert!(!state.update(request(&glyphs, LIGATURE)).unwrap());

    assert!(Arc::ptr_eq(state.font().unwrap(), &first));
    assert_eq!(state.revision(), 1);
}
