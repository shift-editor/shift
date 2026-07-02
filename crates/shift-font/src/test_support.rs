//! Shared test corpora for round-trip and persistence tests.

use crate::{
    Anchor, AnchorId, Axis, AxisId, Component, ComponentId, Contour, ContourId,
    DecomposedTransform, Font, Glyph, GlyphId, GlyphLayer, Guideline, GuidelineId, KerningPair,
    KerningSide, LayerId, LibValue, Location, Point, PointId, PointType, Source, SourceId,
};
use std::collections::HashMap;

/// Builds a kitchen-sink font corpus for semantic round-trip tests.
///
/// Checklist when adding a new `FontData` field: populate it here with a
/// non-default, distinguishable value before relying on equality round-trips.
pub fn sample_font() -> Font {
    let mut font = Font::empty();
    font.metadata_mut().family_name = Some("Dogfood Sans".to_string());
    font.metadata_mut().style_name = Some("Regular".to_string());
    font.metadata_mut().version_major = Some(2);
    font.metadata_mut().version_minor = Some(7);
    font.metadata_mut().copyright = Some("Copyright 2026 Shift".to_string());
    font.metadata_mut().trademark = Some("Dogfood Sans is a Shift mark".to_string());
    font.metadata_mut().designer = Some("Shift Test Lab".to_string());
    font.metadata_mut().designer_url = Some("https://shift.example/designer".to_string());
    font.metadata_mut().manufacturer = Some("Shift Foundry".to_string());
    font.metadata_mut().manufacturer_url = Some("https://shift.example/foundry".to_string());
    font.metadata_mut().license = Some("OFL-1.1".to_string());
    font.metadata_mut().license_url = Some("https://shift.example/license".to_string());
    font.metadata_mut().description = Some("Round-trip coverage corpus".to_string());
    font.metadata_mut().note = Some("Every persisted field should be represented.".to_string());

    font.metrics_mut().units_per_em = 2048.0;
    font.metrics_mut().ascender = 1500.0;
    font.metrics_mut().descender = -500.0;
    font.metrics_mut().cap_height = Some(1456.0);
    font.metrics_mut().x_height = Some(1012.0);
    font.metrics_mut().line_gap = Some(42.0);
    font.metrics_mut().italic_angle = Some(-9.5);
    font.metrics_mut().underline_position = Some(-175.0);
    font.metrics_mut().underline_thickness = Some(96.0);

    font.features_mut()
        .set_fea_source(Some("feature kern { pos A A -80; } kern;\n".to_string()));
    font.kerning_mut()
        .set_group1("public.kern1.A".to_string(), vec!["A".into()]);
    font.kerning_mut()
        .set_group2("public.kern2.A".to_string(), vec!["A".into()]);
    font.kerning_mut().add_pair(KerningPair::new(
        KerningSide::Group("public.kern1.A".to_string()),
        KerningSide::Group("public.kern2.A".to_string()),
        -80.0,
    ));

    let mut font_guideline = Guideline::with_id(
        GuidelineId::from_raw("cap_height"),
        Some(12.0),
        Some(700.0),
        Some(0.0),
        Some("Cap Height".to_string()),
        Some("blue".to_string()),
    );
    font_guideline.set_color(Some("green".to_string()));
    font.add_guideline(font_guideline);

    let mut nested = HashMap::new();
    nested.insert(
        "nestedString".to_string(),
        LibValue::String("value".to_string()),
    );
    nested.insert("nestedFloat".to_string(), LibValue::Float(3.25));
    font.lib_mut().set(
        "com.shift.note".to_string(),
        LibValue::String("font note".to_string()),
    );
    font.lib_mut().set(
        "com.shift.allLibVariants".to_string(),
        LibValue::Array(vec![
            LibValue::String("array string".to_string()),
            LibValue::Integer(12),
            LibValue::Integer(-12),
            LibValue::UnsignedInteger(u64::MAX),
            LibValue::Float(1.5),
            LibValue::Boolean(false),
            LibValue::Dict(nested),
            LibValue::Data(vec![0, 1, 2, 255]),
            LibValue::Date("2024-02-02T02:02:02Z".to_string()),
            LibValue::Uid(9),
        ]),
    );

    font.fontinfo_remainder_mut().set(
        "postscriptBlueValues".to_string(),
        LibValue::Array(vec![LibValue::Integer(-16), LibValue::Integer(0)]),
    );
    font.fontinfo_remainder_mut()
        .set("openTypeOS2WeightClass".to_string(), LibValue::Integer(700));
    let mut woff_metadata = HashMap::new();
    woff_metadata.insert(
        "id".to_string(),
        LibValue::String("dogfood-unique-id".to_string()),
    );
    font.fontinfo_remainder_mut().set(
        "woffMetadataUniqueID".to_string(),
        LibValue::Dict(woff_metadata),
    );

    font.data_files_mut().insert(
        "com.shift.testdata/nested/blob.bin".to_string(),
        vec![0x00, 0xFF, 0x10, 0x20],
    );
    font.data_files_mut()
        .insert("notes.txt".to_string(), b"dogfood data".to_vec());
    font.images_mut().insert(
        "swatch.png".to_string(),
        vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x01],
    );

    let weight_id = AxisId::from_raw("weight");
    let mut weight = Axis::with_id(
        weight_id.clone(),
        "wght".to_string(),
        "Weight".to_string(),
        100.0,
        400.0,
        900.0,
    );
    weight.set_hidden(true);
    font.add_axis(weight);

    let width_id = AxisId::from_raw("width");
    font.add_axis(Axis::with_id(
        width_id.clone(),
        "wdth".to_string(),
        "Width".to_string(),
        75.0,
        100.0,
        125.0,
    ));

    let regular_id = SourceId::from_raw("regular");
    let bold_id = SourceId::from_raw("bold");
    let mut regular_location = Location::new();
    regular_location.set(weight_id.clone(), 400.0);
    regular_location.set(width_id.clone(), 100.0);
    let mut bold_location = Location::new();
    bold_location.set(weight_id, 900.0);
    bold_location.set(width_id, 112.5);
    font.add_source(Source::with_id(
        regular_id.clone(),
        "Regular".to_string(),
        regular_location,
        Some("Regular.ufo".to_string()),
    ));
    let mut bold_source = Source::with_id(
        bold_id.clone(),
        "Bold".to_string(),
        bold_location,
        Some("Bold.ufo".to_string()),
    );
    bold_source.set_color(Some("1,0.75,0,0.7".to_string()));
    bold_source.lib_mut().set(
        "com.shift.sourceNote".to_string(),
        LibValue::String("bold layer note".to_string()),
    );
    font.add_source(bold_source);
    font.set_default_source_id(regular_id.clone());

    let acute_id = GlyphId::from_raw("acute");
    let mut acute = Glyph::with_id(acute_id.clone(), "acute");
    acute.set_layer(GlyphLayer::with_width(
        LayerId::from_raw("acute_regular"),
        regular_id.clone(),
        200.0,
    ));
    font.insert_glyph(acute).unwrap();

    let glyph_id = GlyphId::from_raw("A");
    let mut glyph = Glyph::with_id(glyph_id, "A");
    glyph.set_unicodes(vec![0x0041, 0x00C1]);

    let mut regular_layer =
        GlyphLayer::with_width(LayerId::from_raw("A_regular"), regular_id, 600.0);
    regular_layer.set_height(Some(700.0));
    let mut contour = Contour::with_id(ContourId::from_raw("A_outer"));
    contour.push_point(Point::new(
        PointId::from_raw("A_0"),
        100.0,
        0.0,
        PointType::OnCurve,
        false,
    ));
    contour.push_point(Point::new(
        PointId::from_raw("A_1"),
        300.0,
        700.0,
        PointType::OffCurve,
        true,
    ));
    contour.push_point(Point::new(
        PointId::from_raw("A_2"),
        500.0,
        0.0,
        PointType::QCurve,
        false,
    ));
    contour.close();
    regular_layer.add_contour(contour);
    regular_layer.add_anchor(Anchor::with_id(
        AnchorId::from_raw("A_top"),
        Some("top".to_string()),
        300.0,
        700.0,
    ));
    regular_layer.add_component(Component::with_id(
        ComponentId::from_raw("acute_component"),
        acute_id,
        "acute",
        DecomposedTransform {
            translate_x: 10.0,
            translate_y: 20.0,
            rotation: 5.0,
            scale_x: 1.1,
            scale_y: 0.9,
            skew_x: 2.0,
            skew_y: -1.5,
            t_center_x: 50.0,
            t_center_y: 75.0,
        },
    ));
    regular_layer.add_guideline(Guideline::with_id(
        GuidelineId::from_raw("baseline"),
        None,
        Some(0.0),
        None,
        Some("Baseline".to_string()),
        Some("baseline-blue".to_string()),
    ));
    regular_layer
        .lib_mut()
        .set("com.shift.layer".to_string(), LibValue::Integer(42));
    glyph.set_layer(regular_layer);

    let mut bold_layer = GlyphLayer::with_width(LayerId::from_raw("A_bold"), bold_id, 650.0);
    bold_layer.set_height(Some(720.0));
    let mut bold_contour = Contour::with_id(ContourId::from_raw("A_bold_outer"));
    bold_contour.push_point(Point::new(
        PointId::from_raw("A_bold_0"),
        90.0,
        0.0,
        PointType::OnCurve,
        false,
    ));
    bold_contour.push_point(Point::new(
        PointId::from_raw("A_bold_1"),
        310.0,
        720.0,
        PointType::OnCurve,
        false,
    ));
    bold_layer.add_contour(bold_contour);
    glyph.set_layer(bold_layer);
    glyph
        .lib_mut()
        .set("com.shift.glyph".to_string(), LibValue::Boolean(true));

    font.insert_glyph(glyph).unwrap();
    font
}
