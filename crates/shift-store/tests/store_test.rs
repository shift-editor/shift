use shift_store::{
    AxisId, ComponentId, FontInfo, GlyphId, LayerId, NewAxis, NewGlyph, NewGlyphComponent,
    NewGlyphLayer, NewSource, ShiftStore, SourceId, SourceKind,
};

#[test]
fn opens_memory_store() {
    ShiftStore::open_memory_for_test().expect("memory store should open");
}

#[test]
fn writes_and_reads_font_info() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let font_info = open_sans_font_info();

    store
        .set_font_info(font_info.clone())
        .expect("font info should be written");

    let loaded = store
        .get_font_info()
        .expect("font info query should succeed")
        .expect("font info should exist");

    assert_eq!(loaded, font_info);
}

#[test]
fn overwrites_font_info() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");

    store
        .set_font_info(open_sans_font_info())
        .expect("font info should be written");

    store
        .set_font_info(FontInfo {
            family_name: Some("Shift Sans".to_string()),
            units_per_em: 1000,
            ..empty_font_info()
        })
        .expect("font info should be overwritten");

    let loaded = store
        .get_font_info()
        .expect("font info query should succeed")
        .expect("font info should exist");

    assert_eq!(loaded.family_name.as_deref(), Some("Shift Sans"));
    assert_eq!(loaded.units_per_em, 1000);
    assert_eq!(loaded.copyright, None);
}

#[test]
fn font_info_requires_positive_units_per_em() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");

    let result = store.set_font_info(FontInfo {
        units_per_em: 0,
        ..empty_font_info()
    });

    assert!(result.is_err());
}

#[test]
fn creates_and_reads_glyph() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let glyph_id = GlyphId::new("glyph-A");

    store
        .create_glyph(NewGlyph {
            id: glyph_id.clone(),
            name: Some("A".to_string()),
        })
        .expect("glyph should be created");

    let glyph = store
        .get_glyph(&glyph_id)
        .expect("glyph query should succeed")
        .expect("glyph should exist");

    assert_eq!(glyph.id, glyph_id);
    assert_eq!(glyph.name.as_deref(), Some("A"));
}

#[test]
fn creates_and_reads_axis() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");

    let axis_id = create_weight_axis(&mut store);

    let axis = store
        .get_axis(&axis_id)
        .expect("axis query should succeed")
        .expect("axis should exist");

    assert_eq!(axis.id, axis_id);
    assert_eq!(axis.tag, "wght");
    assert_eq!(axis.name, "Weight");
    assert_eq!(axis.min_value, 100.0);
    assert_eq!(axis.default_value, 400.0);
    assert_eq!(axis.max_value, 800.0);
    assert!(!axis.hidden);
}

#[test]
fn creates_and_reads_source() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let source_id = create_regular_source(&mut store);

    let source = store
        .get_source(&source_id)
        .expect("source query should succeed")
        .expect("source should exist");

    assert_eq!(source.id, source_id);
    assert_eq!(source.name.as_deref(), Some("Regular"));
    assert_eq!(source.family_name.as_deref(), Some("Shift Sans"));
    assert_eq!(source.style_name.as_deref(), Some("Regular"));
    assert_eq!(source.kind, SourceKind::Master);
}

#[test]
fn sets_and_reads_source_location() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let axis_id = create_weight_axis(&mut store);
    let source_id = create_regular_source(&mut store);

    store
        .set_source_location(&source_id, &axis_id, 400.0)
        .expect("source location should be set");

    let locations = store
        .get_source_locations(&source_id)
        .expect("source locations query should succeed");

    assert_eq!(locations.len(), 1);
    assert_eq!(locations[0].source_id, source_id);
    assert_eq!(locations[0].axis_id, axis_id);
    assert_eq!(locations[0].value, 400.0);
}

#[test]
fn source_location_requires_existing_source_and_axis() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");

    let result = store.set_source_location(
        &SourceId::new("source-missing"),
        &AxisId::new("axis-wght"),
        400.0,
    );

    assert!(result.is_err());
}

#[test]
fn creates_and_reads_glyph_layer() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let glyph_id = create_glyph_a(&mut store);
    let source_id = create_regular_source(&mut store);
    let layer_id = create_default_glyph_layer(&mut store, &glyph_id, &source_id);

    let layer = store
        .get_glyph_layer(&layer_id)
        .expect("glyph layer query should succeed")
        .expect("glyph layer should exist");

    assert_eq!(layer.id, layer_id);
    assert_eq!(layer.glyph_id, glyph_id);
    assert_eq!(layer.source_id, source_id);
    assert_eq!(layer.name.as_deref(), Some("Regular"));
}

#[test]
fn glyph_layer_requires_existing_glyph_and_source() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");

    let result = store.create_glyph_layer(NewGlyphLayer {
        id: LayerId::new("layer-A-regular"),
        glyph_id: GlyphId::new("glyph-missing"),
        source_id: SourceId::new("source-missing"),
        name: Some("Regular".to_string()),
    });

    assert!(result.is_err());
}

#[test]
fn lists_glyph_layers_for_glyph() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let glyph_id = create_glyph_a(&mut store);
    let source_id = create_regular_source(&mut store);
    let layer_id = create_default_glyph_layer(&mut store, &glyph_id, &source_id);

    let layers = store
        .list_glyph_layers_for_glyph(&glyph_id)
        .expect("glyph layers query should succeed");

    assert_eq!(layers.len(), 1);
    assert_eq!(layers[0].id, layer_id);
    assert_eq!(layers[0].glyph_id, glyph_id);
    assert_eq!(layers[0].source_id, source_id);
}

#[test]
fn creates_and_reads_glyph_component() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let glyph_id = create_glyph_a(&mut store);
    let base_glyph_id = create_glyph_b(&mut store);
    let source_id = create_regular_source(&mut store);
    let layer_id = create_default_glyph_layer(&mut store, &glyph_id, &source_id);
    let component_id = create_default_component(&mut store, &layer_id, &base_glyph_id);

    let component = store
        .get_glyph_component(&component_id)
        .expect("glyph component query should succeed")
        .expect("glyph component should exist");

    assert_eq!(component.id, component_id);
    assert_eq!(component.layer_id, layer_id);
    assert_eq!(component.base_glyph_id, base_glyph_id);
    assert_eq!(component.order_index, 0);
}

#[test]
fn glyph_component_requires_existing_layer_and_base_glyph() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");

    let result = store.create_glyph_component(NewGlyphComponent {
        id: ComponentId::new("component-A-B"),
        layer_id: LayerId::new("layer-missing"),
        base_glyph_id: GlyphId::new("glyph-missing"),
        order_index: 0,
    });

    assert!(result.is_err());
}

#[test]
fn lists_glyph_components_for_layer() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let glyph_id = create_glyph_a(&mut store);
    let base_glyph_id = create_glyph_b(&mut store);
    let source_id = create_regular_source(&mut store);
    let layer_id = create_default_glyph_layer(&mut store, &glyph_id, &source_id);
    let component_id = create_default_component(&mut store, &layer_id, &base_glyph_id);

    let components = store
        .list_glyph_components_for_layer(&layer_id)
        .expect("glyph components query should succeed");

    assert_eq!(components.len(), 1);
    assert_eq!(components[0].id, component_id);
    assert_eq!(components[0].layer_id, layer_id);
    assert_eq!(components[0].base_glyph_id, base_glyph_id);
    assert_eq!(components[0].order_index, 0);
}

#[test]
fn applies_glyph_identity_change_set() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let glyph = shift_font::Glyph::with_unicode("A", 65);
    let glyph_id = glyph.id();

    store
        .apply_change_set(&shift_font::FontChangeSet::new(vec![
            shift_font::FontChange::GlyphCreated(shift_font::GlyphCreated::from(&glyph)),
            shift_font::FontChange::GlyphIdentityChanged(shift_font::GlyphIdentityChanged {
                glyph_id,
                from_name: shift_font::GlyphName::from("A"),
                to_name: shift_font::GlyphName::from("A.alt"),
                from_unicodes: vec![65],
                to_unicodes: vec![0x00c1],
            }),
        ]))
        .expect("change set should apply");

    let stored = store
        .get_glyph(&GlyphId::new(glyph_id.to_string()))
        .expect("glyph query should succeed")
        .expect("glyph should exist");
    let unicodes = store
        .list_glyph_unicodes(&stored.id)
        .expect("unicode query should succeed");

    assert_eq!(stored.name.as_deref(), Some("A.alt"));
    assert_eq!(unicodes, vec![0x00c1]);
}

#[test]
fn applies_layer_metrics_and_contour_point_changes() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let (target, contour, point_id) = store_change_target_with_contour();
    let store_layer_id = store_layer_id(&target);

    store
        .apply_change_set(&shift_font::FontChangeSet::new(vec![
            shift_font::FontChange::LayerMetricsChanged(shift_font::LayerMetricsChanged {
                target: target.clone(),
                width: 720.0,
                height: None,
            }),
            shift_font::FontChange::ContourAdded(shift_font::ContourAdded {
                target: target.clone(),
                contour,
            }),
            shift_font::FontChange::PointPositionsChanged(shift_font::PointPositionsChanged {
                target,
                points: vec![shift_font::PointPosition {
                    point_id,
                    x: 40.0,
                    y: 50.0,
                }],
            }),
        ]))
        .expect("change set should apply");

    let layer = store
        .get_glyph_layer(&store_layer_id)
        .expect("layer query should succeed")
        .expect("layer should exist");
    let contours = store
        .list_contours_for_layer(&store_layer_id)
        .expect("contour query should succeed");
    let points = store
        .list_points_for_contour(&contours[0].id)
        .expect("point query should succeed");

    assert_eq!(layer.width, 720.0);
    assert_eq!(contours.len(), 1);
    assert!(!contours[0].closed);
    assert_eq!(points.len(), 1);
    assert_eq!(points[0].id, point_id.to_string());
    assert_eq!((points[0].x, points[0].y), (40.0, 50.0));
    assert_eq!(points[0].point_type, "onCurve");
}

#[test]
fn applies_layer_geometry_replacement() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let (target, first_contour, _) = store_change_target_with_contour();
    let store_layer_id = store_layer_id(&target);
    let mut layer = shift_font::GlyphLayer::with_width(500.0);
    layer.add_contour(contour_with_point(10.0, 20.0));

    store
        .apply_change_set(&shift_font::FontChangeSet::new(vec![
            shift_font::FontChange::ContourAdded(shift_font::ContourAdded {
                target: target.clone(),
                contour: first_contour,
            }),
            shift_font::FontChange::LayerGeometryReplaced(shift_font::LayerGeometryReplaced {
                target: target.clone(),
                layer: shift_font::GlyphLayerValue::from(&layer),
            }),
        ]))
        .expect("change set should apply");

    let contours = store
        .list_contours_for_layer(&store_layer_id)
        .expect("contour query should succeed");
    let points = store
        .list_points_for_contour(&contours[0].id)
        .expect("point query should succeed");

    assert_eq!(contours.len(), 1);
    assert_eq!(points.len(), 1);
    assert_eq!((points[0].x, points[0].y), (10.0, 20.0));
}

#[test]
fn rejects_incremental_change_for_missing_point_row() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let (target, _, _) = store_change_target_with_contour();
    let missing_point_id = shift_font::PointId::new();

    let result = store.apply_change_set(&shift_font::FontChangeSet::new(vec![
        shift_font::FontChange::PointPositionsChanged(shift_font::PointPositionsChanged {
            target,
            points: vec![shift_font::PointPosition {
                point_id: missing_point_id,
                x: 1.0,
                y: 2.0,
            }],
        }),
    ]));

    assert!(
        result
            .expect_err("missing point should reject")
            .to_string()
            .contains(&missing_point_id.to_string())
    );
}

fn create_glyph_a(store: &mut ShiftStore) -> GlyphId {
    let glyph_id = GlyphId::new("glyph-A");

    store
        .create_glyph(NewGlyph {
            id: glyph_id.clone(),
            name: Some("A".to_string()),
        })
        .expect("glyph should be created");

    glyph_id
}

fn open_sans_font_info() -> FontInfo {
    FontInfo {
        family_name: Some("Open Sans".to_string()),
        copyright: Some(
            "Copyright 2020 The Open Sans Project Authors (https://github.com/googlefonts/opensans)"
                .to_string(),
        ),
        trademark: Some(
            "Open Sans is a trademark of Google and may be registered in certain jurisdictions."
                .to_string(),
        ),
        description: Some("Designed by Monotype design team.".to_string()),
        sample_text: None,
        designer: Some("Monotype Design Team".to_string()),
        designer_url: Some("http://www.monotype.com/studio".to_string()),
        manufacturer: Some("Monotype Imaging Inc.".to_string()),
        manufacturer_url: Some("http://www.google.com/get/noto/".to_string()),
        license_description: Some(
            "This Font Software is licensed under the SIL Open Font License, Version 1.1."
                .to_string(),
        ),
        license_info_url: Some("http://scripts.sil.org/OFL".to_string()),
        vendor_id: None,
        version_major: Some(3),
        version_minor: Some(3),
        units_per_em: 2048,
    }
}

fn empty_font_info() -> FontInfo {
    FontInfo {
        family_name: None,
        copyright: None,
        trademark: None,
        description: None,
        sample_text: None,
        designer: None,
        designer_url: None,
        manufacturer: None,
        manufacturer_url: None,
        license_description: None,
        license_info_url: None,
        vendor_id: None,
        version_major: None,
        version_minor: None,
        units_per_em: 1000,
    }
}

fn create_glyph_b(store: &mut ShiftStore) -> GlyphId {
    let glyph_id = GlyphId::new("glyph-B");

    store
        .create_glyph(NewGlyph {
            id: glyph_id.clone(),
            name: Some("B".to_string()),
        })
        .expect("glyph should be created");

    glyph_id
}

fn create_default_glyph_layer(
    store: &mut ShiftStore,
    glyph_id: &GlyphId,
    source_id: &SourceId,
) -> LayerId {
    let layer_id = LayerId::new("layer-A-regular");

    store
        .create_glyph_layer(NewGlyphLayer {
            id: layer_id.clone(),
            glyph_id: glyph_id.clone(),
            source_id: source_id.clone(),
            name: Some("Regular".to_string()),
        })
        .expect("glyph layer should be created");

    layer_id
}

fn create_default_component(
    store: &mut ShiftStore,
    layer_id: &LayerId,
    base_glyph_id: &GlyphId,
) -> ComponentId {
    let component_id = ComponentId::new("component-A-B");

    store
        .create_glyph_component(NewGlyphComponent {
            id: component_id.clone(),
            layer_id: layer_id.clone(),
            base_glyph_id: base_glyph_id.clone(),
            order_index: 0,
        })
        .expect("glyph component should be created");

    component_id
}

fn create_weight_axis(store: &mut ShiftStore) -> AxisId {
    let axis_id = AxisId::new("axis-wght");

    store
        .create_axis(NewAxis {
            id: axis_id.clone(),
            tag: "wght".to_string(),
            name: "Weight".to_string(),
            min_value: 100.0,
            default_value: 400.0,
            max_value: 800.0,
            hidden: false,
        })
        .expect("axis should be created");

    axis_id
}

fn create_regular_source(store: &mut ShiftStore) -> SourceId {
    let source_id = SourceId::new("source-regular");

    store
        .create_source(NewSource {
            id: source_id.clone(),
            name: Some("Regular".to_string()),
            family_name: Some("Shift Sans".to_string()),
            style_name: Some("Regular".to_string()),
            kind: SourceKind::Master,
        })
        .expect("source should be created");

    source_id
}

fn store_change_target_with_contour() -> (
    shift_font::GlyphLayerChangeTarget,
    shift_font::ContourValue,
    shift_font::PointId,
) {
    let glyph = shift_font::Glyph::with_unicode("A", 65);
    let layer_id = shift_font::LayerId::new();
    let source_id = shift_font::SourceId::new();
    let contour = contour_with_point(10.0, 20.0);
    let point_id = contour.points()[0].id();

    (
        shift_font::GlyphLayerChangeTarget {
            glyph_id: glyph.id(),
            glyph_name: glyph.glyph_name().clone(),
            source_id,
            layer_id,
        },
        shift_font::ContourValue::from(&contour),
        point_id,
    )
}

fn contour_with_point(x: f64, y: f64) -> shift_font::Contour {
    let mut contour = shift_font::Contour::new();
    contour.add_point(x, y, shift_font::PointType::OnCurve, false);
    contour
}

fn store_layer_id(target: &shift_font::GlyphLayerChangeTarget) -> LayerId {
    LayerId::new(format!("{}:{}", target.glyph_id, target.layer_id))
}
