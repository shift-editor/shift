//! UFO round-trip for `com.shift.stroke` on a glyph layer lib.

use std::collections::BTreeMap;

use shift_backends::font_loader::FontLoader;
use shift_font::{
    Contour, Font, Glyph, GlyphLayer, LayerId, PointType,
    stroke::{ContourStrokeEntry, ContourStrokeRole, LayerStrokeLib, STROKE_LIB_KEY},
};

fn single_layer_font() -> Font {
    let mut font = Font::new();
    let source_id = font.default_source_id().unwrap();
    let mut glyph = Glyph::with_unicode("A", 0x0041);
    let mut layer = GlyphLayer::with_width(LayerId::from_raw("A_regular"), source_id, 600.0);
    let mut contour = Contour::new();
    contour.add_point(50.0, 50.0, PointType::OnCurve, false);
    contour.add_point(50.0, 150.0, PointType::OnCurve, false);
    layer.add_contour(contour);
    let contour_id = layer.contours_iter().next().unwrap().id().to_string();
    layer.lib_mut().set(
        STROKE_LIB_KEY.to_string(),
        LayerStrokeLib {
            contours: BTreeMap::from([(
                contour_id,
                ContourStrokeEntry {
                    role: ContourStrokeRole::Skeleton,
                    style_id: Some("stem".to_string()),
                },
            )]),
        }
        .to_lib(),
    );
    glyph.set_layer(layer);
    font.insert_glyph(glyph).unwrap();
    font
}

fn round_trip(font: &Font) -> Font {
    let temp_dir = tempfile::tempdir().expect("tempdir");
    let output_path = temp_dir.path().join("stroke-lib.ufo");
    let loader = FontLoader::new();
    loader
        .write_font(font, output_path.to_str().unwrap())
        .expect("UFO write");
    loader
        .read_font(output_path.to_str().unwrap())
        .expect("UFO read")
}

#[test]
fn preserves_com_shift_stroke_on_glyph_layer_lib() {
    let reloaded = round_trip(&single_layer_font());
    let glyph = reloaded.glyph_by_name("A").expect("reloaded glyph");
    let layer = glyph.layers().values().next().unwrap();
    let stroke_value = layer.lib().get(STROKE_LIB_KEY).expect("stroke lib key");
    let parsed = LayerStrokeLib::from_lib(stroke_value).expect("stroke lib shape");
    assert_eq!(parsed.contours.len(), 1);
    let entry = parsed.contours.values().next().unwrap();
    assert_eq!(entry.role, ContourStrokeRole::Skeleton);
    assert_eq!(entry.style_id.as_deref(), Some("stem"));
}
