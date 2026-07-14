use shift_font::{FontMetadata, test_support::sample_font};
use shift_store::{
    AxisId, ComponentId, Evidence, FileIdentity, FontInfo, GlyphId, LayerId, NewAxis, NewGlyph,
    NewGlyphComponent, NewGlyphLayer, NewSource, ShiftStore, SourceId, SourceIdentitySnapshot,
    SourceKind, WorkspaceState,
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
fn metadata_change_set_preserves_metrics_and_store_only_font_info() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let mut original = open_sans_font_info();
    original.sample_text = Some("Hamburgefontsiv".to_string());
    original.vendor_id = Some("SHFT".to_string());
    store
        .set_font_info(original.clone())
        .expect("font info should be written");
    let metadata = FontMetadata {
        family_name: Some("Shift Sans".to_string()),
        style_name: Some("Text".to_string()),
        version_major: Some(4),
        version_minor: Some(2),
        copyright: None,
        trademark: None,
        designer: Some("Shift Type".to_string()),
        designer_url: Some("https://shift-editor.dev".to_string()),
        manufacturer: Some("Shift".to_string()),
        manufacturer_url: None,
        license: Some("SIL Open Font License 1.1".to_string()),
        license_url: Some("https://openfontlicense.org".to_string()),
        description: Some("A dogfood family".to_string()),
        note: None,
    };

    store
        .apply_change_set(&shift_font::FontChangeSet::new(vec![
            shift_font::FontChange::font_metadata_updated(&metadata),
        ]))
        .expect("metadata change should apply");

    let loaded = store
        .get_font_info()
        .expect("font info query should succeed")
        .expect("font info should exist");
    assert_eq!(loaded.family_name, metadata.family_name);
    assert_eq!(loaded.style_name, metadata.style_name);
    assert_eq!(loaded.designer, metadata.designer);
    assert_eq!(loaded.license_description, metadata.license);
    assert_eq!(loaded.version_major, metadata.version_major.map(i64::from));
    assert_eq!(loaded.version_minor, metadata.version_minor.map(i64::from));
    assert_eq!(loaded.sample_text, original.sample_text);
    assert_eq!(loaded.vendor_id, original.vendor_id);
    assert_eq!(loaded.units_per_em, original.units_per_em);
    assert_eq!(loaded.ascender, original.ascender);
    assert_eq!(loaded.default_source_id, original.default_source_id);
}

#[test]
fn writes_and_reads_workspace_state() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let state = WorkspaceState::untitled(Some("doc-1".to_string()));

    store
        .set_workspace_state(state.clone())
        .expect("workspace state should be written");

    let loaded = store
        .workspace_state()
        .expect("workspace state query should succeed")
        .expect("workspace state should exist");

    assert_eq!(loaded, state);
}

#[test]
fn applying_change_set_marks_workspace_state_dirty() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let glyph = shift_font::Glyph::with_unicode("A", 65);
    store
        .set_workspace_state(WorkspaceState::untitled(Some("doc-1".to_string())))
        .expect("workspace state should be written");

    store
        .apply_change_set(&shift_font::FontChangeSet::new(vec![
            shift_font::FontChange::glyph_created(&glyph),
        ]))
        .expect("change set should apply");

    let loaded = store
        .workspace_state()
        .expect("workspace state query should succeed")
        .expect("workspace state should exist");

    assert!(loaded.dirty);
    assert_eq!(loaded.revision, 1);
    assert_eq!(loaded.saved_revision, 0);
}

#[test]
fn source_identity_snapshot_separates_exact_equality_from_match_evidence() {
    let left = SourceIdentitySnapshot {
        source_path: Some("Family.shift".into()),
        canonical_source_path: Some("/fonts/Family.shift".into()),
        source_package_id: None,
        source_file_identity: Some(FileIdentity {
            kind: "unix-dev-inode".to_string(),
            value: "1:2".to_string(),
        }),
        source_size: Some(128),
        source_mtime_ms: Some(1_000),
        source_fingerprint: Some("fnv1a64:abc".to_string()),
    };
    let moved = SourceIdentitySnapshot {
        source_path: Some("Renamed.shift".into()),
        canonical_source_path: Some("/fonts/Renamed.shift".into()),
        ..left.clone()
    };
    let unknown = SourceIdentitySnapshot {
        source_file_identity: None,
        source_fingerprint: None,
        ..left.clone()
    };

    assert_ne!(left, moved);
    assert_eq!(left.file_identity_match(&moved), Evidence::Same);
    assert_eq!(left.canonical_path_match(&moved), Evidence::Different);
    assert_eq!(left.fingerprint_match(&unknown), Evidence::Unknown);
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
            units_per_em: 1000.0,
            ..empty_font_info()
        })
        .expect("font info should be overwritten");

    let loaded = store
        .get_font_info()
        .expect("font info query should succeed")
        .expect("font info should exist");

    assert_eq!(loaded.family_name.as_deref(), Some("Shift Sans"));
    assert_eq!(loaded.units_per_em, 1000.0);
    assert_eq!(loaded.copyright, None);
}

#[test]
fn font_info_requires_positive_units_per_em() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");

    let result = store.set_font_info(FontInfo {
        units_per_em: 0.0,
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
        base_glyph_name: "Missing".to_string(),
        transform: shift_font::DecomposedTransform::identity(),
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
                glyph_id: glyph_id.clone(),
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
fn applies_glyph_delete_change_set_and_cascades_layers() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let glyph = shift_font::Glyph::with_unicode("A", 65);
    let glyph_id = glyph.id();
    let source_id = shift_font::SourceId::new();
    let layer =
        shift_font::GlyphLayer::with_width(shift_font::LayerId::new(), source_id.clone(), 500.0);
    create_regular_source_with_id(&mut store, source_id);

    store
        .apply_change_set(&shift_font::FontChangeSet::new(vec![
            shift_font::FontChange::glyph_created(&glyph),
            shift_font::FontChange::glyph_layer_created(
                glyph.id(),
                Some(glyph.glyph_name().clone()),
                &layer,
            ),
            shift_font::FontChange::glyph_deleted(glyph.id()),
        ]))
        .expect("change set should apply");

    let stored = store
        .get_glyph(&GlyphId::new(glyph_id.to_string()))
        .expect("glyph query should succeed");
    let layers = store
        .list_glyph_layers_for_glyph(&GlyphId::new(glyph_id.to_string()))
        .expect("layer query should succeed");
    let unicodes = store
        .list_glyph_unicodes(&GlyphId::new(glyph_id.to_string()))
        .expect("unicode query should succeed");

    assert!(stored.is_none());
    assert!(layers.is_empty());
    assert!(unicodes.is_empty());
}

#[test]
fn applies_layer_metrics_and_contour_point_changes() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let (glyph, layer, contour, point_id) = store_layer_with_contour();
    create_regular_source_with_id(&mut store, layer.source_id());

    store
        .apply_change_set(&shift_font::FontChangeSet::new(vec![
            shift_font::FontChange::glyph_created(&glyph),
            shift_font::FontChange::glyph_layer_created(
                glyph.id(),
                Some(glyph.glyph_name().clone()),
                &layer,
            ),
            shift_font::FontChange::LayerMetricsChanged(shift_font::LayerMetricsChanged {
                layer_id: layer.id(),
                width: 720.0,
                height: None,
            }),
            shift_font::FontChange::ContourAdded(shift_font::ContourAdded {
                layer_id: layer.id(),
                contour,
            }),
            shift_font::FontChange::PointPositionsChanged(shift_font::PointPositionsChanged {
                layer_id: layer.id(),
                points: vec![shift_font::PointPosition {
                    point_id: point_id.clone(),
                    x: 40.0,
                    y: 50.0,
                }],
            }),
        ]))
        .expect("change set should apply");

    let layer = store
        .get_glyph_layer(&LayerId::new(layer.id().to_string()))
        .expect("layer query should succeed")
        .expect("layer should exist");
    let contours = store
        .list_contours_for_layer(&layer.id)
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
    let (glyph, layer, first_contour, _) = store_layer_with_contour();
    create_regular_source_with_id(&mut store, layer.source_id());
    let mut replacement = shift_font::GlyphLayer::with_width(layer.id(), layer.source_id(), 500.0);
    replacement.add_contour(contour_with_point(10.0, 20.0));

    store
        .apply_change_set(&shift_font::FontChangeSet::new(vec![
            shift_font::FontChange::glyph_created(&glyph),
            shift_font::FontChange::glyph_layer_created(
                glyph.id(),
                Some(glyph.glyph_name().clone()),
                &layer,
            ),
            shift_font::FontChange::ContourAdded(shift_font::ContourAdded {
                layer_id: layer.id(),
                contour: first_contour,
            }),
            shift_font::FontChange::LayerGeometryReplaced(shift_font::LayerGeometryReplaced {
                layer_id: layer.id(),
                layer: shift_font::GlyphLayerValue::from(&replacement),
            }),
        ]))
        .expect("change set should apply");

    let contours = store
        .list_contours_for_layer(&LayerId::new(layer.id().to_string()))
        .expect("contour query should succeed");
    let points = store
        .list_points_for_contour(&contours[0].id)
        .expect("point query should succeed");

    assert_eq!(contours.len(), 1);
    assert_eq!(points.len(), 1);
    assert_eq!((points[0].x, points[0].y), (10.0, 20.0));
}

#[test]
fn layer_geometry_replacement_round_trips_anchors() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let (glyph, layer, anchor_id) = store_layer_with_anchor();
    create_regular_source_with_id(&mut store, layer.source_id());

    store
        .apply_change_set(&anchored_layer_change_set(&glyph, &layer))
        .expect("change set should apply");

    let anchors = store
        .list_anchors_for_layer(&LayerId::new(layer.id().to_string()))
        .expect("anchor query should succeed");

    assert_eq!(anchors.len(), 1);
    assert_eq!(anchors[0].id, anchor_id.to_string());
    assert_eq!(anchors[0].name.as_deref(), Some("top"));
    assert_eq!((anchors[0].x, anchors[0].y), (250.0, 700.0));
    assert_eq!(anchors[0].order_index, 0);
}

#[test]
fn applies_anchor_position_changes() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let (glyph, layer, anchor_id) = store_layer_with_anchor();
    create_regular_source_with_id(&mut store, layer.source_id());
    store
        .apply_change_set(&anchored_layer_change_set(&glyph, &layer))
        .expect("change set should apply");

    store
        .apply_change_set(&shift_font::FontChangeSet::new(vec![
            shift_font::FontChange::anchor_positions_changed(
                layer.id(),
                vec![shift_font::AnchorPosition {
                    anchor_id: anchor_id.clone(),
                    x: 300.0,
                    y: 650.0,
                }],
            ),
        ]))
        .expect("anchor positions should apply");

    let anchors = store
        .list_anchors_for_layer(&LayerId::new(layer.id().to_string()))
        .expect("anchor query should succeed");
    assert_eq!((anchors[0].x, anchors[0].y), (300.0, 650.0));
}

#[test]
fn rejects_anchor_position_change_for_missing_anchor_row() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let (glyph, layer, _) = store_layer_with_anchor();
    create_regular_source_with_id(&mut store, layer.source_id());
    store
        .apply_change_set(&anchored_layer_change_set(&glyph, &layer))
        .expect("change set should apply");
    let missing_anchor_id = shift_font::AnchorId::new();

    let result = store.apply_change_set(&shift_font::FontChangeSet::new(vec![
        shift_font::FontChange::anchor_positions_changed(
            layer.id(),
            vec![shift_font::AnchorPosition {
                anchor_id: missing_anchor_id.clone(),
                x: 1.0,
                y: 2.0,
            }],
        ),
    ]));

    assert!(
        result
            .expect_err("missing anchor should reject")
            .to_string()
            .contains(&missing_anchor_id.to_string())
    );
}

#[test]
fn reopen_preserves_layer_anchors() {
    let path = temp_store_path("anchors-reopen");
    let (glyph, layer, anchor_id) = store_layer_with_anchor();

    {
        let mut store = ShiftStore::open(&path).expect("open");
        create_regular_source_with_id(&mut store, layer.source_id());
        store
            .apply_change_set(&anchored_layer_change_set(&glyph, &layer))
            .expect("change set should apply");
    }

    let store = ShiftStore::open(&path).expect("reopen");
    let anchors = store
        .list_anchors_for_layer(&LayerId::new(layer.id().to_string()))
        .expect("anchor query should succeed");

    assert_eq!(anchors.len(), 1);
    assert_eq!(anchors[0].id, anchor_id.to_string());
    assert_eq!(anchors[0].name.as_deref(), Some("top"));
    assert_eq!((anchors[0].x, anchors[0].y), (250.0, 700.0));

    std::fs::remove_dir_all(path.parent().unwrap()).ok();
}

#[test]
fn rejects_incremental_change_for_missing_point_row() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let (glyph, layer, _, _) = store_layer_with_contour();
    create_regular_source_with_id(&mut store, layer.source_id());
    let missing_point_id = shift_font::PointId::new();

    let result = store.apply_change_set(&shift_font::FontChangeSet::new(vec![
        shift_font::FontChange::glyph_created(&glyph),
        shift_font::FontChange::glyph_layer_created(
            glyph.id(),
            Some(glyph.glyph_name().clone()),
            &layer,
        ),
        shift_font::FontChange::PointPositionsChanged(shift_font::PointPositionsChanged {
            layer_id: layer.id(),
            points: vec![shift_font::PointPosition {
                point_id: missing_point_id.clone(),
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

#[test]
fn rejects_layer_edit_for_missing_layer_row() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let missing_layer_id = shift_font::LayerId::new();

    let result = store.apply_change_set(&shift_font::FontChangeSet::new(vec![
        shift_font::FontChange::LayerMetricsChanged(shift_font::LayerMetricsChanged {
            layer_id: missing_layer_id.clone(),
            width: 600.0,
            height: None,
        }),
    ]));

    assert!(
        result
            .expect_err("missing layer should reject")
            .to_string()
            .contains(&missing_layer_id.to_string())
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
        style_name: Some("Regular".to_string()),
        copyright: Some(
            "Copyright 2020 The Open Sans Project Authors (https://github.com/googlefonts/opensans)"
                .to_string(),
        ),
        trademark: Some(
            "Open Sans is a trademark of Google and may be registered in certain jurisdictions."
                .to_string(),
        ),
        description: Some("Designed by Monotype design team.".to_string()),
        note: Some("source-format fixture".to_string()),
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
        units_per_em: 2048.0,
        ascender: 1500.0,
        descender: -500.0,
        cap_height: Some(1456.0),
        x_height: Some(1012.0),
        line_gap: Some(42.0),
        italic_angle: Some(-9.5),
        underline_position: Some(-175.0),
        underline_thickness: Some(96.0),
        default_source_id: Some("source_regular".to_string()),
    }
}

fn empty_font_info() -> FontInfo {
    let metrics = shift_font::FontMetrics::default();
    FontInfo {
        family_name: None,
        style_name: None,
        copyright: None,
        trademark: None,
        description: None,
        note: None,
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
        units_per_em: metrics.units_per_em,
        ascender: metrics.ascender,
        descender: metrics.descender,
        cap_height: metrics.cap_height,
        x_height: metrics.x_height,
        line_gap: metrics.line_gap,
        italic_angle: metrics.italic_angle,
        underline_position: metrics.underline_position,
        underline_thickness: metrics.underline_thickness,
        default_source_id: None,
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
            base_glyph_name: "B".to_string(),
            transform: shift_font::DecomposedTransform::identity(),
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
            filename: Some("Regular.ufo".to_string()),
            kind: SourceKind::Master,
        })
        .expect("source should be created");

    source_id
}

fn create_regular_source_with_id(store: &mut ShiftStore, source_id: shift_font::SourceId) {
    store
        .create_source(NewSource {
            id: SourceId::new(source_id.to_string()),
            name: Some("Regular".to_string()),
            family_name: Some("Shift Sans".to_string()),
            style_name: Some("Regular".to_string()),
            filename: Some("Regular.ufo".to_string()),
            kind: SourceKind::Master,
        })
        .expect("source should be created");
}

fn store_layer_with_contour() -> (
    shift_font::Glyph,
    shift_font::GlyphLayer,
    shift_font::ContourValue,
    shift_font::PointId,
) {
    let glyph = shift_font::Glyph::with_unicode("A", 65);
    let source_id = shift_font::SourceId::new();
    let layer = shift_font::GlyphLayer::with_width(shift_font::LayerId::new(), source_id, 500.0);
    let contour = contour_with_point(10.0, 20.0);
    let point_id = contour.points()[0].id();

    (
        glyph,
        layer,
        shift_font::ContourValue::from(&contour),
        point_id,
    )
}

fn store_layer_with_anchor() -> (
    shift_font::Glyph,
    shift_font::GlyphLayer,
    shift_font::AnchorId,
) {
    let glyph = shift_font::Glyph::with_unicode("A", 65);
    let source_id = shift_font::SourceId::new();
    let mut layer =
        shift_font::GlyphLayer::with_width(shift_font::LayerId::new(), source_id, 500.0);
    let anchor_id = layer.add_anchor(shift_font::Anchor::new(
        Some("top".to_string()),
        250.0,
        700.0,
    ));

    (glyph, layer, anchor_id)
}

fn anchored_layer_change_set(
    glyph: &shift_font::Glyph,
    layer: &shift_font::GlyphLayer,
) -> shift_font::FontChangeSet {
    shift_font::FontChangeSet::new(vec![
        shift_font::FontChange::glyph_created(glyph),
        shift_font::FontChange::glyph_layer_created(
            glyph.id(),
            Some(glyph.glyph_name().clone()),
            layer,
        ),
        shift_font::FontChange::layer_geometry_replaced(layer),
    ])
}

fn contour_with_point(x: f64, y: f64) -> shift_font::Contour {
    let mut contour = shift_font::Contour::new();
    contour.add_point(x, y, shift_font::PointType::OnCurve, false);
    contour
}

fn temp_store_path(label: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("shift-store-{label}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir.join("store.sqlite")
}

#[test]
fn file_stores_run_wal_with_verified_pragmas() {
    let path = temp_store_path("pragmas");
    let _store = ShiftStore::open(&path).expect("file store should open");

    let conn = rusqlite::Connection::open(&path).expect("reopen raw");
    let journal: String = conn
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .expect("journal_mode");
    assert_eq!(journal, "wal");

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("user_version");
    assert_eq!(version, 1);

    std::fs::remove_dir_all(path.parent().unwrap()).ok();
}

#[test]
fn reopen_preserves_written_contents_and_integrity() {
    let path = temp_store_path("reopen");

    {
        let mut store = ShiftStore::open(&path).expect("open");
        store
            .set_font_info(open_sans_font_info())
            .expect("write font info");
    }

    let store = ShiftStore::open(&path).expect("reopen");
    let loaded = store
        .get_font_info()
        .expect("query")
        .expect("font info must survive reopen");
    assert_eq!(loaded, open_sans_font_info());

    let conn = rusqlite::Connection::open(&path).expect("raw open");
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .expect("integrity_check");
    assert_eq!(integrity, "ok");

    std::fs::remove_dir_all(path.parent().unwrap()).ok();
}

#[test]
fn applies_axis_and_source_created_change_set_and_survives_reopen() {
    let path = temp_store_path("axis-source-reopen");

    let font_axis_id = shift_font::AxisId::from_raw("axis_weight");
    let mut location = shift_font::Location::new();
    location.set(font_axis_id.clone(), 700.0);
    let source = shift_font::Source::new("Bold".to_string(), location);
    let source_id = SourceId::new(source.id().to_string());

    {
        let mut store = ShiftStore::open(&path).expect("open");
        let axis = shift_font::Axis::with_id(
            font_axis_id,
            "wght".to_string(),
            "Weight".to_string(),
            100.0,
            400.0,
            900.0,
        );
        let change_set = shift_font::FontChangeSet::new(vec![
            shift_font::FontChange::axis_created(&axis),
            shift_font::FontChange::source_created(&source),
        ]);
        store
            .apply_change_set(&change_set)
            .expect("apply change set");
    }

    let store = ShiftStore::open(&path).expect("reopen");

    let axis = store
        .get_axis(&AxisId::new("axis_weight"))
        .expect("axis query should succeed")
        .expect("axis must survive reopen");
    assert_eq!(axis.tag, "wght");
    assert_eq!(axis.name, "Weight");
    assert_eq!(axis.min_value, 100.0);
    assert_eq!(axis.default_value, 400.0);
    assert_eq!(axis.max_value, 900.0);
    assert!(!axis.hidden);

    let sources = store.list_sources().expect("sources query should succeed");
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].id, source_id);
    assert_eq!(sources[0].name.as_deref(), Some("Bold"));

    let locations = store
        .get_source_locations(&source_id)
        .expect("locations query should succeed");
    assert_eq!(locations.len(), 1);
    assert_eq!(locations[0].axis_id, AxisId::new("axis_weight"));
    assert_eq!(locations[0].value, 700.0);

    std::fs::remove_dir_all(path.parent().unwrap()).ok();
}

#[test]
fn replace_font_state_persists_axes_and_source_locations() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");

    let mut font = shift_font::Font::new();
    let font_axis_id = shift_font::AxisId::from_raw("axis_weight");
    font.add_axis(shift_font::Axis::with_id(
        font_axis_id.clone(),
        "wght".to_string(),
        "Weight".to_string(),
        100.0,
        400.0,
        900.0,
    ))
    .unwrap();
    let mut location = shift_font::Location::new();
    location.set(font_axis_id, 700.0);
    let source = shift_font::Source::new("Bold".to_string(), location);
    let source_id = SourceId::new(source.id().to_string());
    font.add_source(source);

    store.replace_font_state(&font).expect("replace font state");

    let axis = store
        .get_axis(&AxisId::new("axis_weight"))
        .expect("axis query should succeed")
        .expect("axis should be persisted");
    assert_eq!(axis.tag, "wght");

    let locations = store
        .get_source_locations(&source_id)
        .expect("locations query should succeed");
    assert_eq!(locations.len(), 1);
    assert_eq!(locations[0].axis_id, AxisId::new("axis_weight"));
    assert_eq!(locations[0].value, 700.0);
}

#[test]
fn replace_and_load_font_state_preserves_whole_font() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let original = sample_font();

    store
        .replace_font_state(&original)
        .expect("replace font state");
    let loaded = store.load_font_state().expect("load font state");

    assert_eq!(loaded, original);
}

#[test]
fn refuses_stores_from_newer_schema_versions() {
    let path = temp_store_path("future");

    {
        let conn = rusqlite::Connection::open(&path).expect("raw create");
        conn.pragma_update(None, "user_version", 999)
            .expect("stamp future");
    }

    let result = ShiftStore::open(&path);
    assert!(result.is_err(), "a future-versioned store must be refused");

    std::fs::remove_dir_all(path.parent().unwrap()).ok();
}

#[test]
fn replace_and_load_font_state_preserves_source_roles_and_layer_names() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");

    let mut font = shift_font::Font::new();
    let mut medium = shift_font::Source::with_filename(
        "Medium".to_string(),
        shift_font::Location::new(),
        "Family-Bold.ufo".to_string(),
    );
    medium.set_layer_name(Some("Medium".to_string()));
    font.add_source(medium);
    font.add_source(shift_font::Source::layer("background".to_string()));

    store.replace_font_state(&font).expect("replace font state");
    let loaded = store.load_font_state().expect("load font state");

    let medium = loaded
        .sources()
        .iter()
        .find(|source| source.name() == "Medium")
        .expect("Medium source should survive");
    assert_eq!(medium.role(), shift_font::SourceRole::Master);
    assert_eq!(medium.layer_name(), Some("Medium"));
    assert_eq!(medium.filename(), Some("Family-Bold.ufo"));

    let background = loaded
        .sources()
        .iter()
        .find(|source| source.name() == "background")
        .expect("background source should survive");
    assert_eq!(background.role(), shift_font::SourceRole::Layer);
    assert_eq!(background.layer_name(), None);
}
