//! UFO round-trip for `com.shift.stroke` on a glyph layer lib.

use std::collections::BTreeMap;

use shift_backends::font_loader::FontLoader;
use shift_font::{
    Contour, ContourId, Font, Glyph, GlyphLayer, LayerId, PointType,
    stroke::{
        ContourStrokeEntry, ContourStrokeRole, LayerStrokeLib, OutlineStrokeStyle, StrokeCap,
        StrokeJoin, STROKE_LIB_KEY,
    },
};

/// A font with a single glyph whose default layer has one two-point contour with a
/// style-id-only stroke lib entry (outline_style: None, as a preset reference would store).
fn preset_ref_font() -> Font {
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
                    outline_style: None,
                },
            )]),
        }
        .to_lib(),
    );
    glyph.set_layer(layer);
    font.insert_glyph(glyph).unwrap();
    font
}

/// A font with a single glyph whose default layer has one two-point contour with a
/// live inline stroke style (outline_style: Some(...)), ready for a preview solve.
fn live_stroke_font() -> (Font, ContourId) {
    let style = OutlineStrokeStyle {
        width: 40.0,
        cap: StrokeCap::Round,
        join: StrokeJoin::Round,
        miter_limit: OutlineStrokeStyle::DEFAULT_MITER_LIMIT,
        position: 0.0,
    };

    let mut font = Font::new();
    let source_id = font.default_source_id().unwrap();
    let mut glyph = Glyph::with_unicode("A", 0x0041);
    let mut layer = GlyphLayer::with_width(LayerId::from_raw("A_regular"), source_id, 600.0);
    let mut contour = Contour::new();
    contour.add_point(50.0, 50.0, PointType::OnCurve, false);
    contour.add_point(50.0, 150.0, PointType::OnCurve, false);
    layer.add_contour(contour);
    let contour_id = layer.contours_iter().next().unwrap().id();
    layer
        .set_live_stroke_contours(&[contour_id.clone()], style)
        .expect("set live stroke");
    glyph.set_layer(layer);
    font.insert_glyph(glyph).unwrap();
    (font, contour_id)
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

/// A style-id-only lib entry (no inline style) survives write→read; the preset reference is
/// preserved even though live_strokes() cannot use it without an outline_style.
#[test]
fn preserves_com_shift_stroke_on_glyph_layer_lib() {
    let reloaded = round_trip(&preset_ref_font());
    let glyph = reloaded.glyph_by_name("A").expect("reloaded glyph");
    let layer = glyph.layers().values().next().unwrap();
    let stroke_value = layer.lib().get(STROKE_LIB_KEY).expect("stroke lib key");
    let parsed = LayerStrokeLib::from_lib(stroke_value).expect("stroke lib shape");
    assert_eq!(parsed.contours.len(), 1);
    let entry = parsed.contours.values().next().unwrap();
    assert_eq!(entry.role, ContourStrokeRole::Skeleton);
    assert_eq!(entry.style_id.as_deref(), Some("stem"));
}

/// A live inline stroke style survives write→read and the preview solve works on the reloaded
/// layer.
///
/// UFO import replaces every contour id with a deterministic derived id via
/// `GlyphLayer::with_derived_entity_ids`.  Writing the original id as a UFO contour
/// `identifier` attribute lets the reader restore it temporarily so the import can correctly
/// remap stroke-lib keys from the original ids to the new derived ids.  Without the writer fix,
/// remapping misses (old-id from the lib vs. fresh random id from the reader) and the stroke lib
/// is pruned as orphaned.
#[test]
fn live_stroke_survives_ufo_round_trip() {
    let (font, _original_contour_id) = live_stroke_font();
    let reloaded = round_trip(&font);

    let glyph = reloaded.glyph_by_name("A").expect("reloaded glyph");
    let layer = glyph.layers().values().next().unwrap();

    // `live_strokes()` requires `outline_style` to be present, so a non-empty result proves
    // the inline style was serialised, the contour-id round-trip let the remap succeed, and
    // the stroke lib survived `prune_orphan_stroke_lib_entries`.
    let live = layer.live_strokes();
    assert_eq!(live.len(), 1, "one contour must carry a live stroke after reload");

    let stroke = &live[0];

    // The stroke lib key must point at the actual (derived) contour id on the reloaded layer.
    let reloaded_contour_id = layer.contours_iter().next().unwrap().id();
    assert_eq!(
        stroke.contour_id, reloaded_contour_id,
        "stroke lib key must name the contour that exists on the layer"
    );

    assert_eq!(stroke.style.width, 40.0);
    assert_eq!(stroke.style.cap, StrokeCap::Round);
    assert_eq!(stroke.style.join, StrokeJoin::Round);
    assert_eq!(stroke.style.position, 0.0);

    // A preview solve must succeed on the reloaded layer.
    let read = layer
        .stroke_outline_points_for_preview(0.5)
        .expect("preview solve must not error");
    assert!(
        read.failed.is_empty(),
        "no contours should fail to solve: {:?}",
        read.failed
            .iter()
            .map(|f| f.error.to_string())
            .collect::<Vec<_>>()
    );
    assert_eq!(read.solved.len(), 1, "one contour must produce a solved outline");
    assert!(
        !read.solved[0].outlines.is_empty(),
        "solved outline must have at least one subpath"
    );
}
