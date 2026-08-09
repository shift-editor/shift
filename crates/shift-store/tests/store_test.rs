use shift_font::{FontMetadata, test_support::sample_font};
use shift_store::{
    AxisId, Evidence, FileIdentity, FontInfo, GlyphId, NewAxis, NewGlyph, NewSource,
    SHIFT_APPLICATION_ID, ShiftStore, SourceId, SourceIdentitySnapshot, SourceKind, WorkspaceState,
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

    let directory = store
        .list_glyph_layer_directory()
        .expect("glyph layer directory query should succeed");
    let layer = directory
        .iter()
        .find(|entry| entry.layer_id == layer_id)
        .expect("glyph layer should exist");

    assert_eq!(layer.glyph_id.as_str(), glyph_id.as_str());
    assert_eq!(layer.source_id.as_str(), source_id.as_str());
    assert_eq!(layer.name.as_ref().map(|name| name.as_str()), Some("A"));
}

#[test]
fn glyph_layer_requires_existing_glyph_and_source() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");

    let layer = shift_font::GlyphLayer::with_width(
        shift_font::LayerId::from_raw("layer-A-regular"),
        shift_font::SourceId::from_raw("source-missing"),
        0.0,
    );
    let result = store.apply_change_set(&shift_font::FontChangeSet::new(vec![
        shift_font::FontChange::glyph_layer_created(
            shift_font::GlyphId::from_raw("glyph-missing"),
            &layer,
        ),
    ]));

    assert!(result.is_err());
}

#[test]
fn lists_glyph_layers_for_glyph() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let glyph_id = create_glyph_a(&mut store);
    let source_id = create_regular_source(&mut store);
    let layer_id = create_default_glyph_layer(&mut store, &glyph_id, &source_id);

    let layers = store
        .list_glyph_layer_directory()
        .expect("glyph layers query should succeed")
        .into_iter()
        .filter(|entry| entry.glyph_id.as_str() == glyph_id.as_str())
        .collect::<Vec<_>>();

    assert_eq!(layers.len(), 1);
    assert_eq!(layers[0].layer_id, layer_id);
    assert_eq!(layers[0].source_id.as_str(), source_id.as_str());
}

#[test]
fn creates_and_reads_glyph_component() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let glyph_id = create_glyph_a(&mut store);
    let base_glyph_id = create_glyph_b(&mut store);
    let source_id = create_regular_source(&mut store);
    let layer_id = create_default_glyph_layer(&mut store, &glyph_id, &source_id);
    let component_id = create_default_component(&mut store, &layer_id, &base_glyph_id);

    let layer = store
        .load_glyph_layer(&layer_id)
        .expect("glyph layer query should succeed")
        .expect("glyph layer should exist");
    let component = layer
        .components_iter()
        .next()
        .expect("glyph component should exist");

    assert_eq!(component.id(), component_id);
    assert_eq!(component.base_glyph_id().as_str(), base_glyph_id.as_str());
}

#[test]
fn glyph_component_replacement_requires_existing_layer() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let mut layer = shift_font::GlyphLayer::with_width(
        shift_font::LayerId::from_raw("layer-missing"),
        shift_font::SourceId::from_raw("source-missing"),
        0.0,
    );
    layer.add_component(shift_font::Component::with_id(
        shift_font::ComponentId::from_raw("component-A-missing"),
        shift_font::GlyphId::from_raw("glyph-missing"),
        "Missing",
        shift_font::DecomposedTransform::identity(),
    ));

    let result = store.replace_glyph_layer(&layer);

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

    let layer = store
        .load_glyph_layer(&layer_id)
        .expect("glyph layer query should succeed")
        .expect("glyph layer should exist");
    let components = layer.components();
    let (_, component) = components.iter().next().expect("component should exist");

    assert_eq!(components.len(), 1);
    assert_eq!(component.id(), component_id);
    assert_eq!(component.base_glyph_id().as_str(), base_glyph_id.as_str());
}

#[test]
fn applies_glyph_identity_change_set() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let glyph = shift_font::Glyph::with_unicode("A", 65);
    let glyph_id = glyph.id();
    let source_id = shift_font::SourceId::new();
    let layer =
        shift_font::GlyphLayer::with_width(shift_font::LayerId::new(), source_id.clone(), 500.0);
    create_regular_source_with_id(&mut store, source_id);

    store
        .apply_change_set(&shift_font::FontChangeSet::new(vec![
            shift_font::FontChange::GlyphCreated(shift_font::GlyphCreated::from(&glyph)),
            shift_font::FontChange::glyph_layer_created(glyph.id(), &layer),
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

    let directory = store.list_glyph_layer_directory().unwrap();

    assert_eq!(stored.name.as_deref(), Some("A.alt"));
    assert_eq!(unicodes, vec![0x00c1]);
    assert_eq!(directory.len(), 1);
    assert_eq!(directory[0].name.as_deref(), Some("A.alt"));
}

#[test]
fn glyph_rename_preserves_authored_order() {
    let mut font = shift_font::Font::new();
    let first = shift_font::Glyph::new("first");
    let second = shift_font::Glyph::new("second");
    let second_id = second.id();
    font.insert_glyph(first).unwrap();
    font.insert_glyph(second).unwrap();
    let mut store = ShiftStore::open_memory_for_test().unwrap();
    store.replace_font_state(&font).unwrap();

    store
        .apply_change_set(&shift_font::FontChangeSet::new(vec![
            shift_font::FontChange::GlyphIdentityChanged(shift_font::GlyphIdentityChanged {
                glyph_id: second_id,
                from_name: shift_font::GlyphName::from("second"),
                to_name: shift_font::GlyphName::from("second.alt"),
                from_unicodes: vec![],
                to_unicodes: vec![],
            }),
        ]))
        .unwrap();

    assert_eq!(
        store
            .load_font_directory()
            .unwrap()
            .glyphs()
            .map(|glyph| glyph.name().to_string())
            .collect::<Vec<_>>(),
        vec!["first", "second.alt"]
    );
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
            shift_font::FontChange::glyph_layer_created(glyph.id(), &layer),
            shift_font::FontChange::glyph_deleted(glyph.id()),
        ]))
        .expect("change set should apply");

    let stored = store
        .get_glyph(&GlyphId::new(glyph_id.to_string()))
        .expect("glyph query should succeed");
    let layers = store
        .list_glyph_layer_directory()
        .expect("layer query should succeed")
        .into_iter()
        .filter(|entry| entry.glyph_id == glyph_id)
        .collect::<Vec<_>>();
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
            shift_font::FontChange::glyph_layer_created(glyph.id(), &layer),
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
        .load_glyph_layer(&layer.id())
        .expect("layer query should succeed")
        .expect("layer should exist");
    let contours = layer.contours();
    let (_, contour) = contours.iter().next().expect("contour should exist");
    let points = contour.points();

    assert_eq!(layer.width(), 720.0);
    assert_eq!(contours.len(), 1);
    assert!(!contour.is_closed());
    assert_eq!(points.len(), 1);
    assert_eq!(points[0].id(), point_id);
    assert_eq!((points[0].x(), points[0].y()), (40.0, 50.0));
    assert_eq!(points[0].point_type(), shift_font::PointType::OnCurve);
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
            shift_font::FontChange::glyph_layer_created(glyph.id(), &layer),
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

    let layer = store
        .load_glyph_layer(&layer.id())
        .expect("layer query should succeed")
        .expect("layer should exist");
    let contours = layer.contours();
    let (_, contour) = contours.iter().next().expect("contour should exist");
    let points = contour.points();

    assert_eq!(contours.len(), 1);
    assert_eq!(points.len(), 1);
    assert_eq!((points[0].x(), points[0].y()), (10.0, 20.0));
}

#[test]
fn layer_geometry_replacement_round_trips_anchors() {
    let mut store = ShiftStore::open_memory_for_test().expect("memory store should open");
    let (glyph, layer, anchor_id) = store_layer_with_anchor();
    create_regular_source_with_id(&mut store, layer.source_id());

    store
        .apply_change_set(&anchored_layer_change_set(&glyph, &layer))
        .expect("change set should apply");

    let layer = store
        .load_glyph_layer(&layer.id())
        .expect("anchor query should succeed")
        .expect("layer should exist");
    let anchors = layer.anchors();

    assert_eq!(anchors.len(), 1);
    assert_eq!(anchors[0].id(), anchor_id);
    assert_eq!(anchors[0].name(), Some("top"));
    assert_eq!((anchors[0].x(), anchors[0].y()), (250.0, 700.0));
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

    let layer = store
        .load_glyph_layer(&layer.id())
        .expect("anchor query should succeed")
        .expect("layer should exist");
    let anchors = layer.anchors();
    assert_eq!((anchors[0].x(), anchors[0].y()), (300.0, 650.0));
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
    let layer = store
        .load_glyph_layer(&layer.id())
        .expect("anchor query should succeed")
        .expect("layer should exist");
    let anchors = layer.anchors();

    assert_eq!(anchors.len(), 1);
    assert_eq!(anchors[0].id(), anchor_id);
    assert_eq!(anchors[0].name(), Some("top"));
    assert_eq!((anchors[0].x(), anchors[0].y()), (250.0, 700.0));

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
        shift_font::FontChange::glyph_layer_created(glyph.id(), &layer),
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
    let glyph_id = GlyphId::new(shift_font::GlyphId::from_raw("A").to_string());

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
        default_source_id: None,
    }
}

fn create_glyph_b(store: &mut ShiftStore) -> GlyphId {
    let glyph_id = GlyphId::new(shift_font::GlyphId::from_raw("B").to_string());

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
) -> shift_font::LayerId {
    let layer = shift_font::GlyphLayer::with_width(
        shift_font::LayerId::from_raw("A-regular"),
        shift_font::SourceId::from_raw(source_id.as_str()),
        0.0,
    );

    store
        .apply_change_set(&shift_font::FontChangeSet::new(vec![
            shift_font::FontChange::glyph_layer_created(
                shift_font::GlyphId::from_raw(glyph_id.as_str()),
                &layer,
            ),
        ]))
        .expect("glyph layer should be created");

    layer.id()
}

fn create_default_component(
    store: &mut ShiftStore,
    layer_id: &shift_font::LayerId,
    base_glyph_id: &GlyphId,
) -> shift_font::ComponentId {
    let component_id = shift_font::ComponentId::from_raw("A-B");
    let mut layer = store
        .load_glyph_layer(layer_id)
        .expect("glyph layer query should succeed")
        .expect("glyph layer should exist");
    layer.add_component(shift_font::Component::with_id(
        component_id.clone(),
        shift_font::GlyphId::from_raw(base_glyph_id.as_str()),
        "B",
        shift_font::DecomposedTransform::identity(),
    ));

    store
        .replace_glyph_layer(&layer)
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
    let source_id = SourceId::new(shift_font::SourceId::from_raw("regular").to_string());

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
        shift_font::FontChange::glyph_layer_created(glyph.id(), layer),
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

fn sqlite_sidecar_path(path: &std::path::Path, suffix: &str) -> std::path::PathBuf {
    let mut sidecar = std::ffi::OsString::from(path.as_os_str());
    sidecar.push(suffix);
    std::path::PathBuf::from(sidecar)
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
fn canonical_document_round_trip_preserves_kitchen_sink_font_for_export() {
    let temp = tempfile::tempdir().expect("temp dir");
    let path = temp.path().join("Dogfood.shift");
    let original = sample_font();

    let store = ShiftStore::create_document(&path, &original).expect("create document");
    let metadata = store.document_metadata().expect("document metadata");
    assert!(metadata.document_id.as_str().starts_with("document_"));
    assert_eq!(metadata.document_id.as_str().len(), 41);
    assert_eq!(store.load_font_state().expect("load document"), original);
    drop(store);

    let magic = std::fs::read(&path).expect("read document");
    assert_eq!(&magic[..16], b"SQLite format 3\0");
    assert!(!sqlite_sidecar_path(&path, "-journal").exists());
    assert!(!sqlite_sidecar_path(&path, "-wal").exists());
    assert!(!sqlite_sidecar_path(&path, "-shm").exists());

    let conn = rusqlite::Connection::open(&path).expect("raw reopen");
    let application_id: i64 = conn
        .query_row("PRAGMA application_id", [], |row| row.get(0))
        .expect("application_id");
    assert_eq!(application_id, SHIFT_APPLICATION_ID);
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("user_version");
    assert_eq!(version, 1);
    let journal: String = conn
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .expect("journal_mode");
    assert_eq!(journal, "delete");
    let has_workspace_state: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'workspace_state')",
            [],
            |row| row.get(0),
        )
        .expect("workspace schema check");
    assert!(!has_workspace_state);
    drop(conn);

    let reopened = ShiftStore::open_document(&path).expect("reopen document");
    assert_eq!(
        reopened.document_metadata().expect("reopened metadata"),
        metadata
    );
    assert_eq!(reopened.load_font_state().expect("reloaded font"), original);
}

#[test]
fn raw_document_copy_preserves_document_identity() {
    let temp = tempfile::tempdir().expect("temp dir");
    let original_path = temp.path().join("Original.shift");
    let copy_path = temp.path().join("Copy.shift");
    let font = sample_font();
    let original = ShiftStore::create_document(&original_path, &font).expect("create document");
    let metadata = original.document_metadata().expect("document metadata");
    drop(original);

    std::fs::copy(&original_path, &copy_path).expect("copy document");

    assert_eq!(
        ShiftStore::verify_document(&copy_path).expect("verify copy"),
        metadata
    );
}

#[test]
fn save_as_document_snapshots_working_store_without_workspace_state() {
    let temp = tempfile::tempdir().expect("temp dir");
    let working_path = temp.path().join("Working.sqlite");
    let document_path = temp.path().join("Saved.shift");
    let font = sample_font();
    let mut working = ShiftStore::open(&working_path).expect("open working store");
    working
        .replace_font_state(&font)
        .expect("write complete font state");
    let private_marker = "PRIVATE_WORKSPACE_ORIGIN_MARKER_9f4902c5";
    let mut state = WorkspaceState::imported(private_marker, Some("workspace-1".to_string()));
    state.dirty = true;
    state.revision = 7;
    working
        .set_workspace_state(state.clone())
        .expect("write workspace state");

    let metadata = working
        .save_as_document(&document_path)
        .expect("save document snapshot");

    assert_eq!(
        working.workspace_state().expect("read source state"),
        Some(state)
    );
    let document = ShiftStore::open_document(&document_path).expect("open saved document");
    assert_eq!(
        document.document_metadata().expect("document metadata"),
        metadata
    );
    assert_eq!(document.load_font_state().expect("load saved font"), font);
    drop(document);
    assert!(!sqlite_sidecar_path(&document_path, "-journal").exists());
    assert!(!sqlite_sidecar_path(&document_path, "-wal").exists());
    assert!(!sqlite_sidecar_path(&document_path, "-shm").exists());
    let document_bytes = std::fs::read(&document_path).expect("read document bytes");
    assert!(
        !document_bytes
            .windows(private_marker.len())
            .any(|bytes| bytes == private_marker.as_bytes())
    );
}

#[test]
fn save_as_document_from_document_mints_a_new_identity() {
    let temp = tempfile::tempdir().expect("temp dir");
    let original_path = temp.path().join("Original.shift");
    let saved_as_path = temp.path().join("SavedAs.shift");
    let font = sample_font();
    let original =
        ShiftStore::create_document(&original_path, &font).expect("create original document");
    let original_metadata = original.document_metadata().expect("original metadata");

    let saved_as_metadata = original
        .save_as_document(&saved_as_path)
        .expect("save document as new document");

    assert_ne!(saved_as_metadata, original_metadata);
    assert_eq!(
        original
            .document_metadata()
            .expect("unchanged source metadata"),
        original_metadata
    );
    let saved_as = ShiftStore::open_document(&saved_as_path).expect("open saved-as document");
    assert_eq!(
        saved_as.load_font_state().expect("load saved-as font"),
        font
    );
}

#[test]
fn save_as_document_never_clobbers_an_existing_destination() {
    let temp = tempfile::tempdir().expect("temp dir");
    let working_path = temp.path().join("Working.sqlite");
    let document_path = temp.path().join("Existing.shift");
    let working = ShiftStore::open(&working_path).expect("open working store");
    std::fs::write(&document_path, b"retain me").expect("write destination");

    let error = working
        .save_as_document(&document_path)
        .expect_err("existing destination must not be replaced");

    assert!(matches!(
        error,
        shift_store::StoreError::DocumentAlreadyExists(existing) if existing == document_path
    ));
    assert_eq!(
        std::fs::read(&document_path).expect("read destination"),
        b"retain me"
    );
}

#[test]
fn create_document_never_clobbers_an_existing_destination() {
    let temp = tempfile::tempdir().expect("temp dir");
    let path = temp.path().join("Existing.shift");
    std::fs::write(&path, b"retain me").expect("write destination");

    let error = match ShiftStore::create_document(&path, &sample_font()) {
        Ok(_) => panic!("existing destination must not be replaced"),
        Err(error) => error,
    };

    assert!(matches!(
        error,
        shift_store::StoreError::DocumentAlreadyExists(existing) if existing == path
    ));
    assert_eq!(
        std::fs::read(&path).expect("read destination"),
        b"retain me"
    );
}

#[test]
fn document_open_rejects_plain_corrupt_and_future_sqlite_files() {
    let temp = tempfile::tempdir().expect("temp dir");
    let plain_path = temp.path().join("Plain.shift");
    let corrupt_path = temp.path().join("Corrupt.shift");
    let future_path = temp.path().join("Future.shift");

    rusqlite::Connection::open(&plain_path).expect("create plain sqlite");
    let plain_error = match ShiftStore::open_document(&plain_path) {
        Ok(_) => panic!("plain SQLite must not open as Shift"),
        Err(error) => error,
    };
    assert!(matches!(
        plain_error,
        shift_store::StoreError::InvalidApplicationId { found: 0, expected }
            if expected == SHIFT_APPLICATION_ID
    ));

    std::fs::write(&corrupt_path, b"not sqlite").expect("write corrupt file");
    assert!(ShiftStore::open_document(&corrupt_path).is_err());

    drop(ShiftStore::create_document(&future_path, &sample_font()).expect("create future base"));
    let conn = rusqlite::Connection::open(&future_path).expect("open future raw");
    conn.pragma_update(None, "user_version", 999)
        .expect("stamp future schema");
    drop(conn);
    let future_error = match ShiftStore::open_document(&future_path) {
        Ok(_) => panic!("future document must be refused"),
        Err(error) => error,
    };
    assert!(matches!(
        future_error,
        shift_store::StoreError::UnsupportedDocumentSchemaVersion {
            found: 999,
            supported: 1
        }
    ));
}

#[test]
fn canonical_document_requires_document_open_posture() {
    let temp = tempfile::tempdir().expect("temp dir");
    let path = temp.path().join("Canonical.shift");
    drop(ShiftStore::create_document(&path, &sample_font()).expect("create document"));

    let error = match ShiftStore::open(&path) {
        Ok(_) => panic!("canonical document must not use working-store WAL posture"),
        Err(error) => error,
    };
    assert!(matches!(
        error,
        shift_store::StoreError::DocumentRequiresDocumentOpen
    ));

    let conn = rusqlite::Connection::open(&path).expect("raw reopen");
    let journal: String = conn
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .expect("journal mode");
    assert_eq!(journal, "delete");
    drop(conn);
    assert!(!sqlite_sidecar_path(&path, "-wal").exists());
    assert!(!sqlite_sidecar_path(&path, "-shm").exists());
}

#[test]
fn completed_import_store_restores_durable_wal_mode() {
    let path = temp_store_path("import-pragmas");
    let font = shift_font::test_support::sample_font();
    let mut store = ShiftStore::open_for_import(&path).expect("open import store");
    let mut writer = store.begin_import(&font).expect("begin import");
    for glyph in font.glyphs() {
        writer.write_glyph(glyph).expect("write glyph");
    }
    writer.finish().expect("commit import");
    store.finish_import().expect("finish import");
    drop(store);

    let conn = rusqlite::Connection::open(&path).expect("reopen raw");
    let journal: String = conn
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .expect("journal_mode");
    assert_eq!(journal, "wal");
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .expect("integrity_check");
    assert_eq!(integrity, "ok");

    std::fs::remove_dir_all(path.parent().unwrap()).ok();
}

#[test]
fn import_mode_refuses_a_published_workspace_destination() {
    let path = temp_store_path("occupied-import");
    let mut store = ShiftStore::open(&path).expect("open");
    store
        .set_workspace_state(WorkspaceState::untitled(None))
        .expect("publish workspace");
    drop(store);

    let error = match ShiftStore::open_for_import(&path) {
        Ok(_) => panic!("published store must be retained"),
        Err(error) => error,
    };
    assert!(matches!(
        error,
        shift_store::StoreError::ImportDestinationNotEmpty(existing) if existing == path
    ));

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
    let mut location = shift_font::DesignLocation::new();
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
    let mut location = shift_font::DesignLocation::new();
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
        shift_font::DesignLocation::new(),
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
