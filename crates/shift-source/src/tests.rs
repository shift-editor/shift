use crate::package::*;
use crate::{
    ShiftAxisMappingDiagnostic, ShiftAxisMappingDiagnosticKind, ShiftAxisMappingUpdate,
    ShiftComponentActivity, ShiftComponentLoweringCapability,
    ShiftComponentLoweringCapabilityCount, ShiftComponentLoweringHint,
    ShiftComponentLoweringTarget, ShiftComponentRecipeKind, ShiftComponentRecipeSummary,
    ShiftComponentResolveContext, ShiftComponentVariationParentAxisValue,
    ShiftComponentVariationParentAxisValueSource, ShiftComponentVariationResolution,
    ShiftComponentVariationSourceUpdate, ShiftComponentVariationTransformSource,
    ShiftConditionEvaluation, ShiftCreateAxisMapping, ShiftCreateComponentVariationSource,
    ShiftCreateGlyph, ShiftCreateGlyphSourceLayer, ShiftCreateGlyphVariationSource,
    ShiftCreateSource, ShiftGlyphRelinkReplacementBlocker, ShiftGlyphVariationAxisValue,
    ShiftGlyphVariationAxisValueSource, ShiftGlyphVariationSourceUpdate,
    ShiftGlyphVariationSourceUse, ShiftMappedAxisValue, ShiftMappedAxisValueSource,
    ShiftResolvedAxisValue, ShiftResolvedAxisValueSource, ShiftSourceAxisValue,
    ShiftSourceAxisValueSource, ShiftSourceError, ShiftSourceUpdate,
    ShiftStaticComponentExportDisposition, ShiftWorkingSource, ShiftWorkingSourceSavePreviewStatus,
    ShiftWorkingSourceSaveStatus,
};
use shift_ir::{
    Axis, AxisId, AxisInheritance, Component, ComponentCondition, ComponentId, Contour,
    DecomposedTransform, Font, FontMetadata, FontMetrics, GlyphAxis, GlyphId, Layer, Location,
    Source, SourceId,
};
use shift_ir::{Glyph, GlyphLayer, PointType};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

#[test]
fn package_uses_stable_glyph_ids_for_files_and_component_refs() {
    let mut font = Font::new();
    font.metadata_mut().family_name = Some("Spike Sans".to_string());
    font.add_axis(Axis::weight());

    let default_layer_id = font.default_layer_id();
    let mut base = Glyph::with_unicode("A", 0x0041);
    base.set_layer(default_layer_id, GlyphLayer::with_width(610.0));
    font.insert_glyph(base);

    let mut composite_layer = GlyphLayer::with_width(620.0);
    composite_layer.add_component(Component::new("A"));
    let mut composite = Glyph::with_unicode("Aacute", 0x00C1);
    composite.set_layer(default_layer_id, composite_layer);
    font.insert_glyph(composite);

    let package = ShiftPackage::from_font(&font);
    let aacute = package
        .glyphs
        .iter()
        .find(|glyph| glyph.name == "Aacute")
        .expect("Aacute should be serialized");
    let regular_layer = aacute
        .layers
        .get("source_Regular")
        .expect("default source layer should be serialized");

    assert_eq!(aacute.id, "glyph_Aacute");
    assert_eq!(regular_layer.components[0].base_glyph_id, "glyph_A");
    assert_eq!(regular_layer.components[0].base_glyph_name, "A");
}

#[test]
fn package_from_font_sorts_glyphs_by_stable_id() {
    let mut font = Font::new();
    font.insert_glyph(Glyph::new("B"));
    font.insert_glyph(Glyph::new("A"));

    let package = ShiftPackage::from_font(&font);
    let glyph_ids: Vec<_> = package
        .glyphs
        .iter()
        .map(|glyph| glyph.id.as_str())
        .collect();

    assert_eq!(glyph_ids, vec!["glyph_A", "glyph_B"]);
}

#[test]
fn package_roundtrip_preserves_component_identity_and_base_glyph_id() {
    let base_glyph_id = GlyphId::from_stable("glyph_base_A").unwrap();
    let component_id = ComponentId::from_stable("component_Aacute_base").unwrap();
    let axis_id = AxisId::from_stable("axis_weight_public").unwrap();

    let mut font = Font::new();
    font.add_axis(Axis::with_id(
        axis_id.clone(),
        "wght".to_string(),
        "Weight".to_string(),
        100.0,
        400.0,
        900.0,
    ));
    let mut base_glyph = Glyph::with_id(base_glyph_id.clone(), "A.renamed");
    base_glyph.add_local_axis(GlyphAxis::new(
        AxisId::from_stable("axis_stemWidth").unwrap(),
        "Stem Width".to_string(),
        20.0,
        40.0,
        80.0,
    ));
    font.insert_glyph(base_glyph);

    let mut composite_layer = GlyphLayer::with_width(610.0);
    let mut component = Component::with_base_glyph_id(
        component_id.clone(),
        base_glyph_id.clone(),
        "A.old",
        DecomposedTransform::identity(),
    );
    component.set_location_axis(axis_id.clone(), 700.0);
    component.set_axis_inheritance(AxisInheritance::ResetUnspecifiedToFont);
    component.set_condition(Some(ComponentCondition::AxisRange {
        axis_id: axis_id.clone(),
        min: Some(600.0),
        max: None,
    }));
    composite_layer.add_component(component);
    let mut composite = Glyph::new("Aacute");
    composite.set_layer(font.default_layer_id(), composite_layer);
    font.insert_glyph(composite);

    let package = ShiftPackage::from_font(&font);
    let component = &package
        .glyphs
        .iter()
        .find(|glyph| glyph.name == "Aacute")
        .expect("composite glyph should be serialized")
        .layers
        .get("source_Regular")
        .expect("default layer should be serialized")
        .components[0];

    assert_eq!(component.id, "component_Aacute_base");
    assert_eq!(component.base_glyph_id, "glyph_base_A");
    assert_eq!(component.base_glyph_name, "A.renamed");
    assert_eq!(
        component.location,
        BTreeMap::from([("axis_weight_public".to_string(), 700.0)])
    );
    assert_eq!(
        component.axis_inheritance,
        ShiftAxisInheritance::ResetUnspecifiedToFont
    );
    assert!(matches!(
        component.condition,
        Some(ShiftCondition::AxisRange {
            ref axis_id,
            min: Some(600.0),
            max: None,
        }) if axis_id == "axis_weight_public"
    ));
    assert_eq!(
        package
            .glyphs
            .iter()
            .find(|glyph| glyph.id == "glyph_base_A")
            .expect("base glyph should be serialized")
            .local_axes[0]
            .id,
        "axis_stemWidth"
    );

    let loaded = package.into_font().expect("package should load");
    assert_eq!(
        loaded
            .glyph("A.renamed")
            .expect("base glyph should load")
            .local_axes()[0]
            .name(),
        "Stem Width"
    );
    let loaded_component = loaded
        .glyph("Aacute")
        .expect("composite glyph should load")
        .layer(loaded.default_layer_id())
        .expect("default layer should load")
        .components_iter()
        .next()
        .expect("component should load");

    assert_eq!(loaded_component.id_ref(), &component_id);
    assert_eq!(loaded_component.base_glyph_id_ref(), &base_glyph_id);
    assert_eq!(loaded_component.base_glyph().as_str(), "A.renamed");
    assert_eq!(loaded_component.location().get(&axis_id), Some(700.0));
    assert_eq!(
        loaded_component.axis_inheritance(),
        AxisInheritance::ResetUnspecifiedToFont
    );
    assert!(matches!(
        loaded_component.condition(),
        Some(ComponentCondition::AxisRange {
            axis_id: loaded_axis_id,
            min: Some(600.0),
            max: None,
        }) if loaded_axis_id == &axis_id
    ));
}

#[test]
fn save_and_load_package_roundtrips_font_basics() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");

    let mut font = Font::new();
    font.metadata_mut().family_name = Some("Spike Sans".to_string());
    font.metadata_mut().style_name = Some("Regular".to_string());
    font.metrics_mut().units_per_em = 2048.0;

    let default_layer_id = font.default_layer_id();
    let mut glyph = Glyph::with_unicode("A", 0x0041);
    let mut layer = GlyphLayer::with_width(600.0);
    let mut contour = Contour::new();
    contour.add_point(0.0, 0.0, PointType::OnCurve, false);
    contour.add_point(100.0, 0.0, PointType::OnCurve, false);
    contour.close();
    layer.add_contour(contour);
    glyph.set_layer(default_layer_id, layer);
    font.insert_glyph(glyph);

    save_font(&font, &package_path).expect("package should save");

    assert!(package_path.join("manifest.json").exists());
    assert!(package_path.join("glyphs").join("glyph_A.json").exists());

    let loaded = load_font(&package_path).expect("package should load");
    let loaded_glyph = loaded.glyph("A").expect("glyph should roundtrip");

    assert_eq!(loaded.metadata().family_name.as_deref(), Some("Spike Sans"));
    assert_eq!(loaded.metrics().units_per_em, 2048.0);
    assert_eq!(
        loaded
            .default_source()
            .expect("default source should roundtrip")
            .id_ref()
            .as_str(),
        "source_Regular"
    );
    assert_eq!(loaded_glyph.id_ref().as_str(), "glyph_A");
    assert_eq!(loaded_glyph.unicodes(), &[0x0041]);
    assert_eq!(
        loaded_glyph
            .layer(loaded.default_layer_id())
            .map(GlyphLayer::width),
        Some(600.0)
    );
}

#[test]
fn source_locations_use_axis_ids_in_package_and_axis_tags_in_ir() {
    let mut font = Font::new();
    let weight_axis_id = AxisId::from_stable("axis_public_weight").unwrap();
    font.add_axis(Axis::with_id(
        weight_axis_id.clone(),
        "wght".to_string(),
        "Weight".to_string(),
        100.0,
        400.0,
        900.0,
    ));
    let bold_layer_id = font.add_layer(Layer::new("Bold".to_string()));
    let mut bold_location = Location::new();
    bold_location.set("wght".to_string(), 900.0);
    let bold_source_id = SourceId::from_stable("source_weight_max").unwrap();
    font.add_source(Source::with_id(
        bold_source_id.clone(),
        "Bold".to_string(),
        bold_location,
        bold_layer_id,
    ));

    let package = ShiftPackage::from_font(&font);
    let weight_axis = package
        .axes
        .iter()
        .find(|axis| axis.tag == "wght")
        .expect("weight axis should be serialized");
    let bold_source = package
        .sources
        .iter()
        .find(|source| source.name == "Bold")
        .expect("bold source should be serialized");

    assert_eq!(weight_axis.id, "axis_public_weight");
    assert_eq!(bold_source.id, "source_weight_max");
    assert_eq!(bold_source.location.get("axis_public_weight"), Some(&900.0));
    package
        .validate()
        .expect("package source axes should validate");

    let loaded = package.into_font().expect("package should convert to IR");
    let loaded_bold = loaded
        .sources()
        .iter()
        .find(|source| source.name() == "Bold")
        .expect("bold source should roundtrip");

    assert_eq!(
        loaded
            .axis_by_id(&weight_axis_id)
            .expect("weight axis id should roundtrip")
            .tag(),
        "wght"
    );
    assert_eq!(loaded_bold.id_ref(), &bold_source_id);
    assert_eq!(loaded_bold.location().get("wght"), Some(900.0));
}

#[test]
fn save_removes_stale_glyph_files_from_prior_package_state() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");

    let mut font = Font::new();
    font.insert_glyph(Glyph::new("A"));
    font.insert_glyph(Glyph::new("B"));
    save_font(&font, &package_path).expect("initial package should save");

    let mut edited_package = load_package(&package_path).expect("initial package should load");
    edited_package.glyphs.retain(|glyph| glyph.name != "B");
    save_package(&edited_package, &package_path).expect("edited package should save");

    assert!(package_path.join("glyphs").join("glyph_A.json").exists());
    assert!(!package_path.join("glyphs").join("glyph_B.json").exists());

    let loaded = load_font(&package_path).expect("edited package should load");
    assert!(loaded.glyph("A").is_some());
    assert!(loaded.glyph("B").is_none());
}

#[test]
fn load_rejects_glyph_file_id_mismatch() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");

    let mut font = Font::new();
    font.insert_glyph(Glyph::new("A"));
    save_font(&font, &package_path).expect("package should save");

    let glyph_path = package_path.join("glyphs").join("glyph_A.json");
    let glyph_json = fs::read_to_string(&glyph_path).expect("glyph should be readable");
    fs::write(
        &glyph_path,
        glyph_json.replace(r#""id": "glyph_A""#, r#""id": "glyph_B""#),
    )
    .expect("glyph id should be editable for fixture");

    let error = load_package(&package_path)
        .expect_err("file name and stable glyph id mismatch should fail load");

    assert!(matches!(
        error,
        ShiftSourceError::GlyphFileIdMismatch {
            path,
            expected_glyph_id,
            actual_glyph_id,
        } if path == glyph_path
            && expected_glyph_id == "glyph_A"
            && actual_glyph_id == "glyph_B"
    ));
}

#[test]
fn load_validates_the_package_graph_before_returning() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();
    save_package(&package, &package_path).expect("package should save");

    let glyph_path = package_path.join("glyphs").join("glyph_Aacute.json");
    let glyph_json = fs::read_to_string(&glyph_path).expect("glyph should be readable");
    fs::write(
        &glyph_path,
        glyph_json.replace(
            r#""baseGlyphId": "glyph_A""#,
            r#""baseGlyphId": "glyph_Missing""#,
        ),
    )
    .expect("glyph component should be editable for fixture");

    let error = load_package(&package_path)
        .expect_err("load should reject invalid package graph before returning");

    assert!(matches!(
        error,
        ShiftSourceError::MissingComponentBase {
            glyph_name,
            base_glyph_id,
        } if glyph_name == "Aacute" && base_glyph_id == "glyph_Missing"
    ));
}

#[test]
fn save_removes_stale_optional_axis_mapping_file() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let mut package = package_with_axes(
        vec![
            ShiftAxis {
                id: "axis_wght".to_string(),
                tag: "wght".to_string(),
                name: "Weight".to_string(),
                minimum: 100.0,
                default: 400.0,
                maximum: 900.0,
                hidden: false,
                role: ShiftAxisRole::UserFacing,
            },
            ShiftAxis {
                id: "axis_stem".to_string(),
                tag: "STEM".to_string(),
                name: "Stem".to_string(),
                minimum: 0.0,
                default: 0.0,
                maximum: 1.0,
                hidden: true,
                role: ShiftAxisRole::Internal,
            },
        ],
        Vec::new(),
    );
    package.axis_mappings = vec![ShiftAxisMapping {
        id: "mapping_weight_to_stem".to_string(),
        name: "Weight drives stem".to_string(),
        input_axes: vec!["axis_wght".to_string()],
        output_axes: vec!["axis_stem".to_string()],
        samples: vec![ShiftAxisMappingSample {
            input_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
            output_location: BTreeMap::from([("axis_stem".to_string(), 1.0)]),
        }],
    }];
    save_package(&package, &package_path).expect("package with mapping should save");

    package.axis_mappings.clear();
    save_package(&package, &package_path).expect("package without mappings should save");

    assert!(!package_path.join("axis-mappings.json").exists());
    assert!(load_package(&package_path)
        .expect("package should load")
        .axis_mappings
        .is_empty());
}

#[test]
fn save_writes_disposable_dependency_index() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();

    save_package(&package, &package_path).expect("package should save");

    let index_path = package_path.join("derived").join("dependencies.json");
    let index_json = fs::read_to_string(index_path).expect("dependency index should be written");

    assert!(index_json.contains("\"glyph_Aacute\""));
    assert!(index_json.contains("\"componentDependents\""));
}

#[test]
fn save_writes_disposable_interpolation_compatibility_index() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_compatible_two_layer_glyph();

    save_package(&package, &package_path).expect("package should save");

    let index_path = package_path
        .join("derived")
        .join("interpolation-compatibility.json");
    let index_json = fs::read_to_string(index_path).expect("compatibility index should be written");

    assert!(index_json.contains("\"glyph_A\""));
    assert!(index_json.contains("\"compatible\": true"));
}

#[test]
fn interpolation_compatibility_index_accepts_matching_layer_topology() {
    let package = package_with_compatible_two_layer_glyph();

    let index =
        build_interpolation_compatibility_index(&package).expect("compatibility should build");
    let glyph = index
        .glyphs
        .get("glyph_A")
        .expect("glyph should be indexed");

    assert!(glyph.compatible);
    assert!(glyph.issues.is_empty());
    assert_eq!(glyph.layer_signatures.len(), 2);
}

#[test]
fn interpolation_compatibility_index_reports_contour_topology_mismatch() {
    let mut package = package_with_compatible_two_layer_glyph();
    package
        .glyphs
        .iter_mut()
        .find(|glyph| glyph.id == "glyph_A")
        .expect("glyph should exist")
        .layers
        .get_mut("source_Bold")
        .expect("bold layer should exist")
        .contours[0]
        .points
        .push(ShiftPoint {
            x: 50.0,
            y: 50.0,
            point_type: ShiftPointType::OffCurve,
            smooth: false,
        });

    let index =
        build_interpolation_compatibility_index(&package).expect("compatibility should build");
    let glyph = index
        .glyphs
        .get("glyph_A")
        .expect("glyph should be indexed");

    assert!(!glyph.compatible);
    assert_eq!(
        glyph.issues,
        vec![ShiftInterpolationCompatibilityIssue {
            kind: ShiftInterpolationCompatibilityIssueKind::ContourTopologyMismatch,
            reference_layer_id: "source_Bold".to_string(),
            layer_id: "source_Regular".to_string(),
            expected: "on-on-off:closed".to_string(),
            actual: "on-on:closed".to_string(),
        }]
    );
}

#[test]
fn interpolation_compatibility_index_reports_component_mismatch() {
    let mut package = package_with_single_source(vec![
        ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::from([
                (
                    "source_Regular".to_string(),
                    layer_with_component("glyph_stem", "stem"),
                ),
                (
                    "source_Bold".to_string(),
                    layer_with_component("glyph_bar", "bar"),
                ),
            ]),
        },
        ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
        ShiftGlyph {
            id: "glyph_bar".to_string(),
            name: "bar".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
    ]);
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::new(),
    });

    let index =
        build_interpolation_compatibility_index(&package).expect("compatibility should build");
    let glyph = index
        .glyphs
        .get("glyph_A")
        .expect("glyph should be indexed");

    assert!(!glyph.compatible);
    assert_eq!(
        glyph.issues,
        vec![ShiftInterpolationCompatibilityIssue {
            kind: ShiftInterpolationCompatibilityIssueKind::ComponentBaseMismatch,
            reference_layer_id: "source_Bold".to_string(),
            layer_id: "source_Regular".to_string(),
            expected: "component_26:glyph_bar".to_string(),
            actual: "component_26:glyph_stem".to_string(),
        }]
    );
}

#[test]
fn interpolation_compatibility_index_reports_component_identity_mismatch() {
    let mut regular = layer_with_component("glyph_stem", "stem");
    regular.components[0].id = "component_regular".to_string();
    let mut bold = layer_with_component("glyph_stem", "stem");
    bold.components[0].id = "component_bold".to_string();
    let mut package = package_with_single_source(vec![
        ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::from([
                ("source_Regular".to_string(), regular),
                ("source_Bold".to_string(), bold),
            ]),
        },
        ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
    ]);
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::new(),
    });

    let index =
        build_interpolation_compatibility_index(&package).expect("compatibility should build");
    let glyph = index
        .glyphs
        .get("glyph_A")
        .expect("glyph should be indexed");

    assert!(!glyph.compatible);
    assert_eq!(
        glyph.issues,
        vec![ShiftInterpolationCompatibilityIssue {
            kind: ShiftInterpolationCompatibilityIssueKind::ComponentIdMismatch,
            reference_layer_id: "source_Bold".to_string(),
            layer_id: "source_Regular".to_string(),
            expected: "component_bold".to_string(),
            actual: "component_regular".to_string(),
        }]
    );
}

#[test]
fn write_impact_for_rename_updates_dependency_labels() {
    let impact = plan_write_impact(&[ShiftPackageChange::RenameGlyph {
        glyph_id: "glyph_A".to_string(),
    }]);

    assert_eq!(
        impact,
        ShiftWriteImpact {
            canonical_paths: vec!["glyphs/glyph_A.json".to_string()],
            removed_canonical_paths: Vec::new(),
            derived_paths: vec![DEPENDENCY_INDEX_PATH.to_string()],
        }
    );
}

#[test]
fn write_impact_for_component_label_cache_update_skips_interpolation_cache() {
    let impact = plan_write_impact(&[ShiftPackageChange::UpdateGlyphLabels {
        glyph_id: "glyph_Aacute".to_string(),
    }]);

    assert_eq!(
        impact,
        ShiftWriteImpact {
            canonical_paths: vec!["glyphs/glyph_Aacute.json".to_string()],
            removed_canonical_paths: Vec::new(),
            derived_paths: vec![DEPENDENCY_INDEX_PATH.to_string()],
        }
    );
}

#[test]
fn write_impact_for_glyph_delete_marks_file_removal_and_cache_invalidation() {
    let impact = plan_write_impact(&[ShiftPackageChange::DeleteGlyph {
        glyph_id: "glyph_A".to_string(),
    }]);

    assert_eq!(
        impact,
        ShiftWriteImpact {
            canonical_paths: Vec::new(),
            removed_canonical_paths: vec!["glyphs/glyph_A.json".to_string()],
            derived_paths: vec![
                DEPENDENCY_INDEX_PATH.to_string(),
                INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
            ],
        }
    );
}

#[test]
fn write_impact_for_axis_mapping_keeps_export_mapping_explicit() {
    let impact = plan_write_impact(&[ShiftPackageChange::UpdateAxisMappings]);

    assert_eq!(
        impact,
        ShiftWriteImpact {
            canonical_paths: vec!["axis-mappings.json".to_string()],
            removed_canonical_paths: Vec::new(),
            derived_paths: vec![INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string()],
        }
    );
}

#[test]
fn package_diff_classifies_rename_as_label_only_change() {
    let before = package_with_component_dependency();
    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");

    let diff = diff_packages(&before, &after).expect("package diff should build");

    assert_eq!(
        diff,
        ShiftPackageDiff {
            changes: vec![
                ShiftPackageChange::RenameGlyph {
                    glyph_id: "glyph_A".to_string(),
                },
                ShiftPackageChange::UpdateGlyphLabels {
                    glyph_id: "glyph_Aacute".to_string(),
                },
            ],
            impact: ShiftWriteImpact {
                canonical_paths: vec![
                    "glyphs/glyph_A.json".to_string(),
                    "glyphs/glyph_Aacute.json".to_string(),
                ],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![DEPENDENCY_INDEX_PATH.to_string()],
            },
        }
    );
}

#[test]
fn package_diff_classifies_glyph_content_edits_as_update() {
    let before = package_with_component_dependency();
    let mut after = before.clone();
    after
        .glyphs
        .iter_mut()
        .find(|glyph| glyph.id == "glyph_Aacute")
        .expect("composite glyph should exist")
        .layers
        .get_mut("source_Regular")
        .expect("regular layer should exist")
        .advance_width = 777.0;

    let diff = diff_packages(&before, &after).expect("package diff should build");

    assert_eq!(
        diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::UpdateGlyph {
                glyph_id: "glyph_Aacute".to_string(),
            }],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["glyphs/glyph_Aacute.json".to_string()],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![
                    DEPENDENCY_INDEX_PATH.to_string(),
                    INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
                ],
            },
        }
    );
}

#[test]
fn package_diff_marks_glyph_variation_source_edits_as_glyph_updates() {
    let before = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: vec![ShiftGlyphAxis {
                id: "axis_stemWidth".to_string(),
                name: "Stem Width".to_string(),
                minimum: 20.0,
                default: 40.0,
                maximum: 80.0,
            }],
            variation_sources: vec![ShiftGlyphSource {
                id: "glyphSource_stem_default".to_string(),
                name: "Default".to_string(),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 40.0)]),
                layer_id: "source_Regular".to_string(),
            }],
            layers: BTreeMap::from([("source_Regular".to_string(), empty_layer(600.0))]),
        }],
    );
    let mut after = before.clone();
    after.glyphs[0].variation_sources[0]
        .location
        .insert("axis_stemWidth".to_string(), 42.0);

    let diff = diff_packages(&before, &after).expect("package diff should build");

    assert_eq!(
        diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::UpdateGlyph {
                glyph_id: "glyph_stem".to_string(),
            }],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["glyphs/glyph_stem.json".to_string()],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![
                    DEPENDENCY_INDEX_PATH.to_string(),
                    INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
                ],
            },
        }
    );
}

#[test]
fn package_diff_marks_component_variation_source_edits_as_glyph_updates() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_1".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_black".to_string(),
                name: "Black component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                transform: Some(DecomposedTransform {
                    translate_x: 12.0,
                    ..DecomposedTransform::identity()
                }),
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let before = package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    );
    let mut after = before.clone();
    after.glyphs[0]
        .layers
        .get_mut("source_Regular")
        .unwrap()
        .components[0]
        .variation_sources[0]
        .transform
        .as_mut()
        .unwrap()
        .translate_x = 20.0;

    let diff = diff_packages(&before, &after).expect("package diff should build");

    assert_eq!(
        diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::UpdateGlyph {
                glyph_id: "glyph_A".to_string(),
            }],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["glyphs/glyph_A.json".to_string()],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![
                    DEPENDENCY_INDEX_PATH.to_string(),
                    INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
                ],
            },
        }
    );
}

#[test]
fn package_diff_detects_created_and_deleted_glyphs_by_stable_id() {
    let before = package_with_single_source(vec![
        ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
        ShiftGlyph {
            id: "glyph_B".to_string(),
            name: "B".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
    ]);
    let after = package_with_single_source(vec![
        ShiftGlyph {
            id: "glyph_B".to_string(),
            name: "B".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
        ShiftGlyph {
            id: "glyph_C".to_string(),
            name: "C".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
    ]);

    let diff = diff_packages(&before, &after).expect("package diff should build");

    assert_eq!(
        diff.changes,
        vec![
            ShiftPackageChange::DeleteGlyph {
                glyph_id: "glyph_A".to_string(),
            },
            ShiftPackageChange::CreateGlyph {
                glyph_id: "glyph_C".to_string(),
            },
        ]
    );
    assert_eq!(
        diff.impact,
        ShiftWriteImpact {
            canonical_paths: vec!["glyphs/glyph_C.json".to_string()],
            removed_canonical_paths: vec!["glyphs/glyph_A.json".to_string()],
            derived_paths: vec![
                DEPENDENCY_INDEX_PATH.to_string(),
                INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
            ],
        }
    );
}

#[test]
fn package_diff_detects_axis_mapping_module_changes() {
    let before = package_with_axes(vec![weight_axis(), internal_stem_axis()], Vec::new());
    let mut after = before.clone();
    after.axis_mappings = vec![ShiftAxisMapping {
        id: "mapping_weight_to_stem".to_string(),
        name: "Weight drives stem".to_string(),
        input_axes: vec!["axis_wght".to_string()],
        output_axes: vec!["axis_stem".to_string()],
        samples: vec![ShiftAxisMappingSample {
            input_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
            output_location: BTreeMap::from([("axis_stem".to_string(), 1.0)]),
        }],
    }];

    let diff = diff_packages(&before, &after).expect("package diff should build");

    assert_eq!(
        diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::UpdateAxisMappings],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["axis-mappings.json".to_string()],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string()],
            },
        }
    );
}

#[test]
fn package_fingerprint_records_canonical_and_derived_files() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();
    save_package(&package, &package_path).expect("package should save");

    let fingerprint = fingerprint_package(&package_path).expect("fingerprint should build");

    assert!(fingerprint.files.contains_key("manifest.json"));
    assert!(fingerprint.files.contains_key("font.json"));
    assert!(fingerprint.files.contains_key("glyphs/glyph_A.json"));
    assert!(fingerprint.files.contains_key(DEPENDENCY_INDEX_PATH));
    assert!(
        fingerprint.files["glyphs/glyph_A.json"].exists,
        "glyph file should exist"
    );
    assert!(
        fingerprint.files["glyphs/glyph_A.json"]
            .hash
            .as_deref()
            .is_some_and(|hash| hash.len() == 16),
        "fingerprint should include a stable 64-bit hex hash"
    );
}

#[test]
fn write_impact_paths_include_every_file_needed_for_conflict_checks() {
    let impact = ShiftWriteImpact {
        canonical_paths: vec!["glyphs/glyph_A.json".to_string()],
        removed_canonical_paths: vec!["glyphs/glyph_B.json".to_string()],
        derived_paths: vec![
            DEPENDENCY_INDEX_PATH.to_string(),
            "glyphs/glyph_A.json".to_string(),
        ],
    };

    assert_eq!(
        impact.package_relative_paths(),
        vec![
            DEPENDENCY_INDEX_PATH.to_string(),
            "glyphs/glyph_A.json".to_string(),
            "glyphs/glyph_B.json".to_string(),
        ]
    );
}

#[test]
fn fingerprint_comparison_reports_external_modifies_creates_and_deletes() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let mut package = package_with_single_source(vec![
        ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
        ShiftGlyph {
            id: "glyph_B".to_string(),
            name: "B".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
    ]);
    save_package(&package, &package_path).expect("package should save");

    package.glyphs[0].name = "RenamedA".to_string();
    package.glyphs.push(ShiftGlyph {
        id: "glyph_C".to_string(),
        name: "C".to_string(),
        unicodes: Vec::new(),
        local_axes: Vec::new(),
        variation_sources: Vec::new(),
        layers: BTreeMap::new(),
    });
    package.glyphs.retain(|glyph| glyph.id != "glyph_B");
    let before = package_with_single_source(vec![
        ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
        ShiftGlyph {
            id: "glyph_B".to_string(),
            name: "B".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
    ]);
    let diff = diff_packages(&before, &package).expect("package diff should build");
    let impacted_paths = diff.impact.package_relative_paths();
    let expected = fingerprint_relative_paths(&package_path, &impacted_paths)
        .expect("baseline fingerprints should build");

    fs::write(
        package_path.join("glyphs/glyph_A.json"),
        "{\"externally\":\"modified\"}\n",
    )
    .expect("glyph A should be modified");
    fs::remove_file(package_path.join("glyphs/glyph_B.json")).expect("glyph B should delete");
    fs::write(package_path.join("glyphs/glyph_C.json"), "{}\n").expect("glyph C should appear");
    let actual = fingerprint_relative_paths(&package_path, &impacted_paths)
        .expect("current fingerprints should build");

    let conflicts = compare_fingerprints(&expected, &actual);

    assert_eq!(
        conflicts
            .iter()
            .map(|conflict| (conflict.path.as_str(), conflict.kind))
            .collect::<Vec<_>>(),
        vec![
            (
                "glyphs/glyph_A.json",
                ShiftFingerprintConflictKind::Modified
            ),
            ("glyphs/glyph_B.json", ShiftFingerprintConflictKind::Deleted),
            ("glyphs/glyph_C.json", ShiftFingerprintConflictKind::Created),
        ]
    );
}

#[test]
fn fingerprint_comparison_reports_missing_fingerprint_entries() {
    let expected = ShiftPackageFingerprint {
        files: BTreeMap::from([(
            "glyphs/glyph_A.json".to_string(),
            ShiftFileFingerprint {
                exists: true,
                size: Some(1),
                hash: Some("a".to_string()),
            },
        )]),
    };
    let actual = ShiftPackageFingerprint {
        files: BTreeMap::from([(
            "glyphs/glyph_B.json".to_string(),
            ShiftFileFingerprint {
                exists: true,
                size: Some(1),
                hash: Some("b".to_string()),
            },
        )]),
    };

    let conflicts = compare_fingerprints(&expected, &actual);

    assert_eq!(
        conflicts
            .iter()
            .map(|conflict| (conflict.path.as_str(), conflict.kind))
            .collect::<Vec<_>>(),
        vec![
            (
                "glyphs/glyph_A.json",
                ShiftFingerprintConflictKind::MissingActualFingerprint,
            ),
            (
                "glyphs/glyph_B.json",
                ShiftFingerprintConflictKind::MissingExpectedFingerprint,
            ),
        ]
    );
}

#[test]
fn prepared_commit_records_write_set_fingerprints_and_operations() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");

    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");

    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");

    assert!(prepared.conflicts.is_empty());
    assert_eq!(
        prepared.impacted_paths,
        vec![
            DEPENDENCY_INDEX_PATH.to_string(),
            "glyphs/glyph_A.json".to_string(),
            "glyphs/glyph_Aacute.json".to_string(),
        ]
    );
    assert_eq!(
        prepared
            .operations
            .iter()
            .map(|operation| match operation {
                ShiftCommitOperation::WriteFile { path, purpose, .. } => {
                    (path.as_str(), "write", *purpose)
                }
                ShiftCommitOperation::RemoveFile { path, purpose } => {
                    (path.as_str(), "remove", *purpose)
                }
                ShiftCommitOperation::InvalidateDerived { path } => {
                    (
                        path.as_str(),
                        "invalidate",
                        ShiftCommitOperationPurpose::Derived,
                    )
                }
            })
            .collect::<Vec<_>>(),
        vec![
            (
                "glyphs/glyph_A.json",
                "write",
                ShiftCommitOperationPurpose::Canonical,
            ),
            (
                "glyphs/glyph_Aacute.json",
                "write",
                ShiftCommitOperationPurpose::Canonical,
            ),
            (
                DEPENDENCY_INDEX_PATH,
                "write",
                ShiftCommitOperationPurpose::Derived,
            ),
        ]
    );
    assert!(
        prepared.operations.iter().all(|operation| match operation {
            ShiftCommitOperation::WriteFile { size, hash, .. } => *size > 0 && hash.len() == 16,
            ShiftCommitOperation::RemoveFile { .. }
            | ShiftCommitOperation::InvalidateDerived { .. } => true,
        }),
        "write operations should carry stageable payload fingerprints"
    );
}

#[test]
fn staged_commit_writes_marker_and_verified_payloads_without_live_mutation() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");
    let live_before =
        fs::read_to_string(package_path.join("glyphs/glyph_A.json")).expect("glyph is readable");

    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");

    let staged =
        stage_prepared_commit(&package_path, &after, &prepared).expect("commit should stage");

    assert!(staged.marker_path.exists());
    assert_eq!(
        staged.payload_paths,
        vec![
            "glyphs/glyph_A.json".to_string(),
            "glyphs/glyph_Aacute.json".to_string(),
            DEPENDENCY_INDEX_PATH.to_string(),
        ]
    );
    assert!(staged
        .transaction_path
        .join("payloads/glyphs/glyph_A.json")
        .exists());
    assert!(staged
        .transaction_path
        .join("payloads/glyphs/glyph_Aacute.json")
        .exists());
    assert!(staged
        .transaction_path
        .join(format!("payloads/{DEPENDENCY_INDEX_PATH}"))
        .exists());

    let staged_glyph =
        fs::read_to_string(staged.transaction_path.join("payloads/glyphs/glyph_A.json"))
            .expect("staged glyph should be readable");
    let live_after =
        fs::read_to_string(package_path.join("glyphs/glyph_A.json")).expect("glyph is readable");

    assert!(staged_glyph.contains("\"name\": \"RenamedBase\""));
    assert_eq!(live_after, live_before);
}

#[test]
fn staged_commit_rewrites_payloads_and_marker_through_temp_siblings() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");

    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");
    after
        .glyphs
        .iter_mut()
        .find(|glyph| glyph.id == "glyph_Aacute")
        .expect("dependent glyph should exist")
        .layers
        .get_mut("source_Regular")
        .expect("dependent layer should exist")
        .components[0]
        .base_glyph_name = "RenamedBase".to_string();
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");
    let staged =
        stage_prepared_commit(&package_path, &after, &prepared).expect("commit should stage");
    let glyph_payload_path = staged.transaction_path.join("payloads/glyphs/glyph_A.json");
    let glyph_temp_path = staged_payload_temp_path(&glyph_payload_path);
    let marker_temp_path = staged_payload_temp_path(&staged.marker_path);
    fs::write(&glyph_temp_path, "stale payload temp\n").expect("payload temp should be writable");
    fs::write(&marker_temp_path, "stale marker temp\n").expect("marker temp should be writable");

    let restaged =
        stage_prepared_commit(&package_path, &after, &prepared).expect("commit should restage");

    assert_eq!(restaged.transaction_id, staged.transaction_id);
    assert!(
        !glyph_temp_path.exists(),
        "payload staging should replace through the temp sibling"
    );
    assert!(
        !marker_temp_path.exists(),
        "marker staging should replace through the temp sibling"
    );
    assert!(fs::read_to_string(glyph_payload_path)
        .expect("payload should be readable")
        .contains("\"name\": \"RenamedBase\""));
    assert!(fs::read_to_string(restaged.marker_path)
        .expect("marker should be readable")
        .contains("\"impactedPaths\""));
}

fn stage_base_glyph_rename(
    package_path: &Path,
    new_name: &str,
) -> (ShiftPackage, ShiftStagedCommit) {
    let before = package_with_component_dependency();
    save_package(&before, package_path).expect("package should save");
    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, new_name);
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    let prepared = prepare_package_commit(package_path, &before, &after, expected)
        .expect("commit should prepare");
    let staged =
        stage_prepared_commit(package_path, &after, &prepared).expect("commit should stage");

    (after, staged)
}

fn copy_staged_payload_to_live(package_path: &Path, staged: &ShiftStagedCommit, path: &str) {
    fs::copy(
        staged.transaction_path.join("payloads").join(path),
        package_path.join(path),
    )
    .expect("staged payload should be copied to live file");
}

fn copy_staged_base_rename_payloads_to_live(package_path: &Path, staged: &ShiftStagedCommit) {
    copy_staged_payload_to_live(package_path, staged, "glyphs/glyph_A.json");
    copy_staged_payload_to_live(package_path, staged, "glyphs/glyph_Aacute.json");
    copy_staged_payload_to_live(package_path, staged, DEPENDENCY_INDEX_PATH);
}

#[test]
fn load_package_refuses_pending_staged_commit_before_trusting_files() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let (_after, _staged) = stage_base_glyph_rename(&package_path, "RenamedBase");

    let err = load_package(&package_path).expect_err("pending staged commit should block load");

    assert!(matches!(
        err,
        ShiftSourceError::UnresolvedStagedCommits {
            resume_count: 1,
            blocked_count: 0,
            invalid_count: 0,
        }
    ));
}

#[test]
fn recover_staged_commits_resumes_pending_transaction_then_package_loads() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let (_after, staged) = stage_base_glyph_rename(&package_path, "RenamedBase");

    let recovery =
        recover_staged_commits(&package_path).expect("pending transaction should recover");
    let package = load_package(&package_path).expect("package should load after recovery");

    assert_eq!(
        recovery.outcomes,
        vec![ShiftStagedCommitRecoveryOutcome {
            transaction_id: staged.transaction_id,
            action: ShiftStagedCommitRecoveryAction::Resume,
            applied_paths: vec![
                "glyphs/glyph_A.json".to_string(),
                "glyphs/glyph_Aacute.json".to_string(),
                DEPENDENCY_INDEX_PATH.to_string(),
            ],
            backup_paths: vec![
                "glyphs/glyph_A.json".to_string(),
                "glyphs/glyph_Aacute.json".to_string(),
            ],
        }]
    );
    assert_eq!(
        package
            .glyphs
            .iter()
            .find(|glyph| glyph.id == "glyph_A")
            .map(|glyph| glyph.name.as_str()),
        Some("RenamedBase")
    );
    assert!(!staged.transaction_path.exists());
}

#[test]
fn load_package_refuses_partially_applied_staged_commit_before_trusting_files() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let (_after, staged) = stage_base_glyph_rename(&package_path, "RenamedBase");
    fs::copy(
        staged.transaction_path.join("payloads/glyphs/glyph_A.json"),
        package_path.join("glyphs/glyph_A.json"),
    )
    .expect("one staged payload should be copied to live file");

    let err = load_package(&package_path).expect_err("partial staged commit should block load");

    assert!(matches!(
        err,
        ShiftSourceError::UnresolvedStagedCommits {
            resume_count: 1,
            blocked_count: 0,
            invalid_count: 0,
        }
    ));
}

#[test]
fn recover_staged_commits_resumes_partially_applied_transaction_then_package_loads() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let (_after, staged) = stage_base_glyph_rename(&package_path, "RenamedBase");
    fs::copy(
        staged.transaction_path.join("payloads/glyphs/glyph_A.json"),
        package_path.join("glyphs/glyph_A.json"),
    )
    .expect("one staged payload should be copied to live file");

    let recovery =
        recover_staged_commits(&package_path).expect("partial transaction should recover");
    let package = load_package(&package_path).expect("package should load after recovery");

    assert_eq!(recovery.outcomes.len(), 1);
    assert_eq!(
        recovery.outcomes[0].action,
        ShiftStagedCommitRecoveryAction::Resume
    );
    assert_eq!(
        recovery.outcomes[0].applied_paths,
        vec![
            "glyphs/glyph_A.json".to_string(),
            "glyphs/glyph_Aacute.json".to_string(),
            DEPENDENCY_INDEX_PATH.to_string(),
        ]
    );
    assert_eq!(
        recovery.outcomes[0].backup_paths,
        vec!["glyphs/glyph_Aacute.json".to_string()],
        "already-promoted canonical files should not be backed up again"
    );
    assert_eq!(
        package
            .glyphs
            .iter()
            .find(|glyph| glyph.id == "glyph_A")
            .map(|glyph| glyph.name.as_str()),
        Some("RenamedBase")
    );
    assert!(!staged.transaction_path.exists());
}

#[test]
fn load_package_refuses_diverged_staged_commit_before_trusting_files() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let (_after, _staged) = stage_base_glyph_rename(&package_path, "RenamedBase");
    fs::write(
        package_path.join("glyphs/glyph_A.json"),
        "{\"externally\":\"different\"}\n",
    )
    .expect("live file should be modified");

    let err = load_package(&package_path).expect_err("diverged staged commit should block load");

    assert!(matches!(
        err,
        ShiftSourceError::UnresolvedStagedCommits {
            resume_count: 0,
            blocked_count: 1,
            invalid_count: 0,
        }
    ));
}

#[test]
fn recover_staged_commits_refuses_diverged_transaction_without_mutation() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let (_after, staged) = stage_base_glyph_rename(&package_path, "RenamedBase");
    fs::write(
        package_path.join("glyphs/glyph_A.json"),
        "{\"externally\":\"different\"}\n",
    )
    .expect("live file should be modified");

    let err = recover_staged_commits(&package_path)
        .expect_err("diverged transaction should not auto-recover");

    assert!(matches!(
        err,
        ShiftSourceError::UnresolvedStagedCommits {
            resume_count: 0,
            blocked_count: 1,
            invalid_count: 0,
        }
    ));
    assert!(staged.transaction_path.exists());
    assert_eq!(
        fs::read_to_string(package_path.join("glyphs/glyph_A.json"))
            .expect("live glyph should be readable"),
        "{\"externally\":\"different\"}\n"
    );
}

#[test]
fn load_package_refuses_invalid_staged_commit_before_trusting_files() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let (_after, staged) = stage_base_glyph_rename(&package_path, "RenamedBase");
    fs::remove_file(&staged.marker_path).expect("marker should be removable");

    let err = load_package(&package_path).expect_err("invalid staged commit should block load");

    assert!(matches!(
        err,
        ShiftSourceError::UnresolvedStagedCommits {
            resume_count: 0,
            blocked_count: 0,
            invalid_count: 1,
        }
    ));
}

#[test]
fn recover_staged_commits_refuses_invalid_transaction_without_mutation() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let (_after, staged) = stage_base_glyph_rename(&package_path, "RenamedBase");
    fs::remove_file(&staged.marker_path).expect("marker should be removable");

    let err = recover_staged_commits(&package_path)
        .expect_err("invalid transaction should not auto-recover");

    assert!(matches!(
        err,
        ShiftSourceError::UnresolvedStagedCommits {
            resume_count: 0,
            blocked_count: 0,
            invalid_count: 1,
        }
    ));
    assert!(staged.transaction_path.exists());
}

#[test]
fn load_package_allows_cleanup_only_staged_commit() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let (_after, staged) = stage_base_glyph_rename(&package_path, "RenamedBase");
    copy_staged_base_rename_payloads_to_live(&package_path, &staged);

    let package = load_package(&package_path).expect("applied staged commit should not block load");

    assert_eq!(
        package
            .glyphs
            .iter()
            .find(|glyph| glyph.id == "glyph_A")
            .map(|glyph| glyph.name.as_str()),
        Some("RenamedBase")
    );
}

#[test]
fn recover_staged_commits_cleans_applied_transaction() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let (_after, staged) = stage_base_glyph_rename(&package_path, "RenamedBase");
    copy_staged_base_rename_payloads_to_live(&package_path, &staged);

    let recovery =
        recover_staged_commits(&package_path).expect("applied transaction should clean up");
    let package = load_package(&package_path).expect("package should load after cleanup");

    assert_eq!(
        recovery.outcomes,
        vec![ShiftStagedCommitRecoveryOutcome {
            transaction_id: staged.transaction_id,
            action: ShiftStagedCommitRecoveryAction::Cleanup,
            applied_paths: Vec::new(),
            backup_paths: Vec::new(),
        }]
    );
    assert_eq!(
        package
            .glyphs
            .iter()
            .find(|glyph| glyph.id == "glyph_A")
            .map(|glyph| glyph.name.as_str()),
        Some("RenamedBase")
    );
    assert!(!staged.transaction_path.exists());
}

#[test]
fn staged_commit_can_be_recreated_for_the_same_transaction_id() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");

    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");

    let first =
        stage_prepared_commit(&package_path, &after, &prepared).expect("commit should stage");
    fs::remove_file(first.transaction_path.join("payloads/glyphs/glyph_A.json"))
        .expect("payload should be removable");
    let second = stage_prepared_commit(&package_path, &after, &prepared)
        .expect("same commit should restage");
    let recoveries = inspect_staged_commits(&package_path).expect("staged commits should inspect");

    assert_eq!(second.transaction_id, first.transaction_id);
    assert!(second
        .transaction_path
        .join("payloads/glyphs/glyph_A.json")
        .exists());
    assert_eq!(recoveries.len(), 1);
    assert_eq!(recoveries[0].issues, Vec::new());
}

#[test]
fn staged_commit_refuses_distinct_active_transaction() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");

    let mut first_after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut first_after, "RenamedBase");
    let first_diff = diff_packages(&before, &first_after).expect("package diff should build");
    let first_expected =
        fingerprint_relative_paths(&package_path, &first_diff.impact.package_relative_paths())
            .expect("baseline fingerprint should build");
    let first_prepared =
        prepare_package_commit(&package_path, &before, &first_after, first_expected)
            .expect("first commit should prepare");
    let first_staged = stage_prepared_commit(&package_path, &first_after, &first_prepared)
        .expect("first commit should stage");

    let mut second_after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut second_after, "AnotherName");
    let second_diff = diff_packages(&before, &second_after).expect("package diff should build");
    let second_expected =
        fingerprint_relative_paths(&package_path, &second_diff.impact.package_relative_paths())
            .expect("baseline fingerprint should build");
    let second_prepared =
        prepare_package_commit(&package_path, &before, &second_after, second_expected)
            .expect("second commit should prepare");

    let err = stage_prepared_commit(&package_path, &second_after, &second_prepared)
        .expect_err("distinct active transaction should be refused");
    let recoveries = inspect_staged_commits(&package_path).expect("staged commits should inspect");

    assert!(matches!(
        err,
        ShiftSourceError::ActiveStagedCommitExists {
            existing_transaction_id,
            new_transaction_id,
        } if existing_transaction_id == first_staged.transaction_id
            && new_transaction_id != existing_transaction_id
    ));
    assert_eq!(recoveries.len(), 1);
    assert_eq!(recoveries[0].transaction_id, first_staged.transaction_id);
}

#[test]
fn staged_commit_refuses_unresolved_conflicts() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");

    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    fs::write(
        package_path.join("glyphs/glyph_A.json"),
        "{\"externally\":\"modified\"}\n",
    )
    .expect("glyph file should be modified externally");
    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare with conflicts");

    let err = stage_prepared_commit(&package_path, &after, &prepared)
        .expect_err("conflicted commit should not stage");

    assert!(matches!(
        err,
        ShiftSourceError::PreparedCommitHasConflicts { conflict_count: 1 }
    ));
    assert!(!package_path.join(".shift-txn").exists());
}

#[test]
fn inspect_staged_commits_reports_complete_transaction() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");
    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");
    let staged =
        stage_prepared_commit(&package_path, &after, &prepared).expect("commit should stage");

    let recoveries = inspect_staged_commits(&package_path).expect("staged commits should inspect");

    assert_eq!(recoveries.len(), 1);
    assert_eq!(recoveries[0].transaction_id, staged.transaction_id);
    assert_eq!(recoveries[0].issues, Vec::new());
    assert_eq!(
        recoveries[0].live_state,
        ShiftStagedCommitLiveState::Pending
    );
    assert!(recoveries[0]
        .paths
        .iter()
        .all(|path| path.live_state == ShiftStagedCommitLiveState::Pending));
    assert_eq!(recoveries[0].prepared.as_ref(), Some(&prepared));
}

#[test]
fn staged_recovery_plan_marks_pending_transaction_as_resumable() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");
    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");
    let staged =
        stage_prepared_commit(&package_path, &after, &prepared).expect("commit should stage");

    let plans = plan_staged_commit_recovery(&package_path).expect("staged recovery should plan");

    assert_eq!(
        plans,
        vec![ShiftStagedCommitRecoveryPlan {
            transaction_id: staged.transaction_id,
            action: ShiftStagedCommitRecoveryAction::Resume,
            live_state: ShiftStagedCommitLiveState::Pending,
            pending_path_count: 3,
            applied_path_count: 0,
            diverged_path_count: 0,
            issue_count: 0,
        }]
    );
}

#[test]
fn inspect_staged_commits_reports_applied_and_diverged_live_state() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");
    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");
    let staged =
        stage_prepared_commit(&package_path, &after, &prepared).expect("commit should stage");

    copy_staged_base_rename_payloads_to_live(&package_path, &staged);

    let applied = inspect_staged_commits(&package_path).expect("staged commits should inspect");
    assert_eq!(applied[0].live_state, ShiftStagedCommitLiveState::Applied);
    assert!(applied[0]
        .paths
        .iter()
        .all(|path| path.live_state == ShiftStagedCommitLiveState::Applied));

    fs::write(
        package_path.join("glyphs/glyph_A.json"),
        "{\"externally\":\"different\"}\n",
    )
    .expect("live file should be modified");
    let diverged = inspect_staged_commits(&package_path).expect("staged commits should inspect");

    assert_eq!(diverged[0].live_state, ShiftStagedCommitLiveState::Diverged);
    assert_eq!(
        diverged[0]
            .paths
            .iter()
            .map(|path| (path.path.as_str(), path.live_state))
            .collect::<Vec<_>>(),
        vec![
            (DEPENDENCY_INDEX_PATH, ShiftStagedCommitLiveState::Applied),
            ("glyphs/glyph_A.json", ShiftStagedCommitLiveState::Diverged),
            (
                "glyphs/glyph_Aacute.json",
                ShiftStagedCommitLiveState::Applied,
            ),
        ]
    );
}

#[test]
fn staged_recovery_plan_marks_partially_applied_transaction_as_resumable() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");
    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");
    let staged =
        stage_prepared_commit(&package_path, &after, &prepared).expect("commit should stage");

    fs::copy(
        staged.transaction_path.join("payloads/glyphs/glyph_A.json"),
        package_path.join("glyphs/glyph_A.json"),
    )
    .expect("one staged payload should be copied to live file");

    let recoveries =
        inspect_staged_commits(&package_path).expect("partial transaction should inspect");
    let plans = plan_staged_commit_recovery(&package_path).expect("partial recovery should plan");

    assert_eq!(
        recoveries[0].live_state,
        ShiftStagedCommitLiveState::PartiallyApplied
    );
    assert_eq!(
        plans,
        vec![ShiftStagedCommitRecoveryPlan {
            transaction_id: staged.transaction_id,
            action: ShiftStagedCommitRecoveryAction::Resume,
            live_state: ShiftStagedCommitLiveState::PartiallyApplied,
            pending_path_count: 2,
            applied_path_count: 1,
            diverged_path_count: 0,
            issue_count: 0,
        }]
    );
}

#[test]
fn staged_recovery_plan_marks_applied_transaction_for_cleanup() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");
    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");
    let staged =
        stage_prepared_commit(&package_path, &after, &prepared).expect("commit should stage");

    copy_staged_base_rename_payloads_to_live(&package_path, &staged);

    let plans = plan_staged_commit_recovery(&package_path).expect("applied recovery should plan");

    assert_eq!(
        plans,
        vec![ShiftStagedCommitRecoveryPlan {
            transaction_id: staged.transaction_id,
            action: ShiftStagedCommitRecoveryAction::Cleanup,
            live_state: ShiftStagedCommitLiveState::Applied,
            pending_path_count: 0,
            applied_path_count: 3,
            diverged_path_count: 0,
            issue_count: 0,
        }]
    );
}

#[test]
fn staged_recovery_plan_marks_diverged_transaction_as_blocked() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");
    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");
    let staged =
        stage_prepared_commit(&package_path, &after, &prepared).expect("commit should stage");
    fs::write(
        package_path.join("glyphs/glyph_A.json"),
        "{\"externally\":\"different\"}\n",
    )
    .expect("live file should be modified");

    let plans = plan_staged_commit_recovery(&package_path).expect("diverged recovery should plan");

    assert_eq!(
        plans,
        vec![ShiftStagedCommitRecoveryPlan {
            transaction_id: staged.transaction_id,
            action: ShiftStagedCommitRecoveryAction::BlockedByLiveConflict,
            live_state: ShiftStagedCommitLiveState::Diverged,
            pending_path_count: 2,
            applied_path_count: 0,
            diverged_path_count: 1,
            issue_count: 0,
        }]
    );
}

#[test]
fn cleanup_applied_staged_commit_removes_only_applied_transaction() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");
    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");
    let staged =
        stage_prepared_commit(&package_path, &after, &prepared).expect("commit should stage");

    copy_staged_base_rename_payloads_to_live(&package_path, &staged);

    let cleaned = cleanup_applied_staged_commit(&package_path, &staged.transaction_id)
        .expect("applied staged commit should clean up");

    assert_eq!(cleaned.live_state, ShiftStagedCommitLiveState::Applied);
    assert!(!staged.transaction_path.exists());
    assert!(package_path.join("glyphs/glyph_A.json").exists());
}

#[test]
fn cleanup_applied_staged_commit_refuses_pending_transaction() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");
    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");
    let staged =
        stage_prepared_commit(&package_path, &after, &prepared).expect("commit should stage");

    let err = cleanup_applied_staged_commit(&package_path, &staged.transaction_id)
        .expect_err("pending staged commit should not clean up");

    assert!(matches!(
        err,
        ShiftSourceError::StagedCommitNotApplied {
            transaction_id,
            live_state,
        } if transaction_id == staged.transaction_id && live_state == "pending"
    ));
    assert!(staged.transaction_path.exists());
}

#[test]
fn inspect_staged_commits_reports_missing_marker_and_payload() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");
    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");
    let staged =
        stage_prepared_commit(&package_path, &after, &prepared).expect("commit should stage");

    fs::remove_file(staged.transaction_path.join("payloads/glyphs/glyph_A.json"))
        .expect("payload should be removable");
    let missing_payload =
        inspect_staged_commits(&package_path).expect("staged commits should inspect");
    let missing_payload_plans =
        plan_staged_commit_recovery(&package_path).expect("missing payload should plan");

    assert_eq!(
        missing_payload[0].issues,
        vec![ShiftStagedCommitIssue {
            kind: ShiftStagedCommitIssueKind::MissingPayload {
                path: "glyphs/glyph_A.json".to_string(),
            },
        }]
    );
    assert_eq!(
        missing_payload_plans[0].action,
        ShiftStagedCommitRecoveryAction::CannotRecover
    );
    assert_eq!(missing_payload_plans[0].issue_count, 1);

    fs::remove_file(&staged.marker_path).expect("marker should be removable");
    let missing_marker =
        inspect_staged_commits(&package_path).expect("staged commits should inspect");
    let missing_marker_plans =
        plan_staged_commit_recovery(&package_path).expect("missing marker should plan");

    assert_eq!(
        missing_marker[0].issues,
        vec![ShiftStagedCommitIssue {
            kind: ShiftStagedCommitIssueKind::MissingMarker,
        }]
    );
    assert!(missing_marker[0].prepared.is_none());
    assert_eq!(
        missing_marker_plans[0].action,
        ShiftStagedCommitRecoveryAction::CannotRecover
    );
    assert_eq!(missing_marker_plans[0].issue_count, 1);
}

#[test]
fn apply_staged_commit_promotes_payloads_and_backs_up_canonical_files() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");

    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");
    let staged =
        stage_prepared_commit(&package_path, &after, &prepared).expect("commit should stage");

    let applied = apply_staged_commit(&package_path, &staged.transaction_id)
        .expect("staged commit should apply");

    let live_glyph =
        fs::read_to_string(package_path.join("glyphs/glyph_A.json")).expect("glyph is readable");
    let backup_glyph = fs::read_to_string(
        package_path
            .join(".shift-backups")
            .join(&staged.transaction_id)
            .join("originals/glyphs/glyph_A.json"),
    )
    .expect("backup glyph should be readable");

    assert!(live_glyph.contains("\"name\": \"RenamedBase\""));
    assert!(backup_glyph.contains("\"name\": \"A\""));
    assert_eq!(
        applied.backup_paths,
        vec![
            "glyphs/glyph_A.json".to_string(),
            "glyphs/glyph_Aacute.json".to_string(),
        ]
    );
    assert!(!staged.transaction_path.exists());
}

#[test]
fn promote_payload_to_live_file_replaces_existing_file_through_temp_sibling() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let payload_path = temp_dir.path().join("txn/payloads/glyphs/glyph_A.json");
    let live_path = temp_dir.path().join("SpikeSans.shift/glyphs/glyph_A.json");
    fs::create_dir_all(payload_path.parent().expect("payload should have a parent"))
        .expect("payload parent should be created");
    fs::create_dir_all(live_path.parent().expect("live file should have a parent"))
        .expect("live parent should be created");
    fs::write(&payload_path, "updated glyph\n").expect("payload should be written");
    fs::write(&live_path, "original glyph\n").expect("live file should be written");
    let temp_path = staged_payload_temp_path(&live_path);
    fs::write(&temp_path, "stale temp\n").expect("stale temp should be written");

    promote_payload_to_live_file(&payload_path, &live_path).expect("payload should promote");

    assert_eq!(
        fs::read_to_string(&live_path).expect("live file should be readable"),
        "updated glyph\n"
    );
    assert!(
        !temp_path.exists(),
        "temporary sibling should be removed by the final rename"
    );
}

#[test]
fn promote_payload_to_live_file_preserves_live_file_when_payload_is_missing() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let payload_path = temp_dir.path().join("txn/payloads/missing.json");
    let live_path = temp_dir.path().join("SpikeSans.shift/glyphs/glyph_A.json");
    fs::create_dir_all(live_path.parent().expect("live file should have a parent"))
        .expect("live parent should be created");
    fs::write(&live_path, "original glyph\n").expect("live file should be written");
    let temp_path = staged_payload_temp_path(&live_path);
    fs::write(&temp_path, "stale temp\n").expect("stale temp should be written");

    let err = promote_payload_to_live_file(&payload_path, &live_path)
        .expect_err("missing payload should not promote");

    assert!(matches!(
        err,
        ShiftSourceError::ReadFile { path, .. } if path == payload_path
    ));
    assert_eq!(
        fs::read_to_string(&live_path).expect("live file should be readable"),
        "original glyph\n"
    );
    assert!(
        !temp_path.exists(),
        "failed promotion should clean stale temp without touching live data"
    );
}

#[test]
fn apply_staged_commit_resumes_partially_promoted_transaction() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");

    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");
    let staged =
        stage_prepared_commit(&package_path, &after, &prepared).expect("commit should stage");

    fs::copy(
        staged.transaction_path.join("payloads/glyphs/glyph_A.json"),
        package_path.join("glyphs/glyph_A.json"),
    )
    .expect("one staged payload should be copied to live file");

    let recovery_before =
        inspect_staged_commits(&package_path).expect("partial transaction should inspect");
    assert_eq!(
        recovery_before[0]
            .paths
            .iter()
            .map(|path| (path.path.as_str(), path.live_state))
            .collect::<Vec<_>>(),
        vec![
            (DEPENDENCY_INDEX_PATH, ShiftStagedCommitLiveState::Pending),
            ("glyphs/glyph_A.json", ShiftStagedCommitLiveState::Applied),
            (
                "glyphs/glyph_Aacute.json",
                ShiftStagedCommitLiveState::Pending
            ),
        ]
    );
    assert_eq!(
        recovery_before[0].live_state,
        ShiftStagedCommitLiveState::PartiallyApplied
    );

    let applied = apply_staged_commit(&package_path, &staged.transaction_id)
        .expect("partial staged commit should resume");

    let live_glyph =
        fs::read_to_string(package_path.join("glyphs/glyph_A.json")).expect("glyph is readable");
    assert!(live_glyph.contains("\"name\": \"RenamedBase\""));
    assert!(package_path.join(DEPENDENCY_INDEX_PATH).exists());
    assert_eq!(
        applied.applied_paths,
        vec![
            "glyphs/glyph_A.json".to_string(),
            "glyphs/glyph_Aacute.json".to_string(),
            DEPENDENCY_INDEX_PATH.to_string(),
        ]
    );
    assert!(!staged.transaction_path.exists());
}

#[test]
fn apply_staged_commit_refuses_live_changes_since_staging() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");

    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");
    let staged =
        stage_prepared_commit(&package_path, &after, &prepared).expect("commit should stage");

    fs::write(
        package_path.join("glyphs/glyph_A.json"),
        "{\"externally\":\"modified\"}\n",
    )
    .expect("glyph file should be modified externally");

    let err = apply_staged_commit(&package_path, &staged.transaction_id)
        .expect_err("live conflict should prevent apply");

    assert!(matches!(
        err,
        ShiftSourceError::StagedCommitLiveConflicts {
            transaction_id,
            conflict_count: 1,
        } if transaction_id == staged.transaction_id
    ));
    assert!(staged.transaction_path.exists());
}

#[test]
fn apply_staged_commit_removes_deleted_glyph_after_backup() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");

    let mut after = before.clone();
    after.glyphs.retain(|glyph| glyph.id != "glyph_Aacute");
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");
    let staged =
        stage_prepared_commit(&package_path, &after, &prepared).expect("commit should stage");

    let applied = apply_staged_commit(&package_path, &staged.transaction_id)
        .expect("staged delete should apply");

    assert!(!package_path.join("glyphs/glyph_Aacute.json").exists());
    assert!(package_path
        .join(".shift-backups")
        .join(&staged.transaction_id)
        .join("originals/glyphs/glyph_Aacute.json")
        .exists());
    assert!(applied
        .applied_paths
        .contains(&"glyphs/glyph_Aacute.json".to_string()));
}

#[test]
fn prepared_commit_writes_interpolation_index_after_glyph_updates() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_compatible_two_layer_glyph();
    save_package(&before, &package_path).expect("package should save");

    let mut after = before.clone();
    after
        .glyphs
        .iter_mut()
        .find(|glyph| glyph.id == "glyph_A")
        .expect("glyph should exist")
        .layers
        .get_mut("source_Regular")
        .expect("regular layer should exist")
        .advance_width = 640.0;
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");

    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");

    assert!(prepared.operations.iter().any(|operation| matches!(
        operation,
        ShiftCommitOperation::WriteFile {
            path,
            purpose: ShiftCommitOperationPurpose::Derived,
            ..
        } if path == INTERPOLATION_COMPATIBILITY_INDEX_PATH
    )));
}

#[test]
fn prepared_commit_removes_empty_optional_axis_mapping_module() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let mut before = package_with_axes(vec![weight_axis(), internal_stem_axis()], Vec::new());
    before.axis_mappings = vec![ShiftAxisMapping {
        id: "mapping_weight_to_stem".to_string(),
        name: "Weight drives stem".to_string(),
        input_axes: vec!["axis_wght".to_string()],
        output_axes: vec!["axis_stem".to_string()],
        samples: vec![ShiftAxisMappingSample {
            input_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
            output_location: BTreeMap::from([("axis_stem".to_string(), 1.0)]),
        }],
    }];
    save_package(&before, &package_path).expect("package should save");

    let mut after = before.clone();
    after.axis_mappings.clear();
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");

    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare");

    assert_eq!(prepared.operations.len(), 2);
    assert_eq!(
        prepared.operations[0],
        ShiftCommitOperation::RemoveFile {
            path: "axis-mappings.json".to_string(),
            purpose: ShiftCommitOperationPurpose::Canonical,
        }
    );
    let ShiftCommitOperation::WriteFile {
        path,
        purpose,
        size,
        hash,
    } = &prepared.operations[1]
    else {
        panic!("compatibility index should be written");
    };
    assert_eq!(path, INTERPOLATION_COMPATIBILITY_INDEX_PATH);
    assert_eq!(*purpose, ShiftCommitOperationPurpose::Derived);
    assert!(*size > 0);
    assert_eq!(hash.len(), 16);
}

#[test]
fn prepared_commit_reports_conflicts_before_live_writes() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let before = package_with_component_dependency();
    save_package(&before, &package_path).expect("package should save");

    let mut after = before.clone();
    rename_base_glyph_and_component_label_cache(&mut after, "RenamedBase");
    let diff = diff_packages(&before, &after).expect("package diff should build");
    let expected = fingerprint_relative_paths(&package_path, &diff.impact.package_relative_paths())
        .expect("baseline fingerprint should build");
    fs::write(
        package_path.join("glyphs/glyph_A.json"),
        "{\"externally\":\"modified\"}\n",
    )
    .expect("glyph file should be modified externally");

    let prepared = prepare_package_commit(&package_path, &before, &after, expected)
        .expect("commit should prepare with conflicts");

    assert_eq!(
        prepared
            .conflicts
            .iter()
            .map(|conflict| (conflict.path.as_str(), conflict.kind))
            .collect::<Vec<_>>(),
        vec![(
            "glyphs/glyph_A.json",
            ShiftFingerprintConflictKind::Modified,
        )]
    );
}

#[test]
fn relative_path_fingerprints_capture_missing_files_for_conflict_checks() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_single_source(vec![ShiftGlyph {
        id: "glyph_A".to_string(),
        name: "A".to_string(),
        unicodes: Vec::new(),
        local_axes: Vec::new(),
        variation_sources: Vec::new(),
        layers: BTreeMap::new(),
    }]);
    save_package(&package, &package_path).expect("package should save");

    let paths = vec![
        "glyphs/glyph_A.json".to_string(),
        "glyphs/glyph_missing.json".to_string(),
    ];
    let before = fingerprint_relative_paths(&package_path, &paths)
        .expect("fingerprints should build before delete");
    fs::remove_file(package_path.join("glyphs/glyph_A.json")).expect("glyph file should delete");
    let after = fingerprint_relative_paths(&package_path, &paths)
        .expect("fingerprints should build after delete");

    assert!(before.files["glyphs/glyph_A.json"].exists);
    assert!(!before.files["glyphs/glyph_missing.json"].exists);
    assert!(!after.files["glyphs/glyph_A.json"].exists);
    assert_ne!(
        before.files["glyphs/glyph_A.json"], after.files["glyphs/glyph_A.json"],
        "deleted file should change its fingerprint state"
    );
}

#[test]
fn relative_path_fingerprints_reject_paths_outside_package() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let paths = vec!["../outside.json".to_string()];

    let error = fingerprint_relative_paths(temp_dir.path(), &paths)
        .expect_err("path traversal should fail");

    assert!(matches!(
        error,
        ShiftSourceError::InvalidRelativePath { path } if path == "../outside.json"
    ));
}

#[test]
fn dependency_index_supports_delete_and_rename_previews_by_stable_id() {
    let mut package = package_with_component_dependency();

    let before = build_dependency_index(&package).expect("dependency index should build");
    let dependents_before = &before
        .glyphs
        .get("glyph_A")
        .expect("base glyph should be indexed")
        .component_dependents;

    assert_eq!(
        dependents_before,
        &[ShiftComponentUse {
            glyph_id: "glyph_Aacute".to_string(),
            glyph_name: "Aacute".to_string(),
            layer_id: "source_Regular".to_string(),
            component_id: "component_25".to_string(),
        }]
    );

    rename_base_glyph_and_component_label_cache(&mut package, "RenamedBase");

    let after = build_dependency_index(&package).expect("dependency index should rebuild");
    let base_dependencies = after
        .glyphs
        .get("glyph_A")
        .expect("renamed base should keep stable id");

    assert_eq!(base_dependencies.glyph_name, "RenamedBase");
    assert_eq!(base_dependencies.component_dependents, *dependents_before);
}

#[test]
fn dependency_index_tracks_variable_component_bases_by_stable_id() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_2".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 48.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_black".to_string(),
                name: "Black component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                transform: Some(DecomposedTransform {
                    translate_x: 12.0,
                    ..DecomposedTransform::identity()
                }),
            }],
            condition: Some(ShiftCondition::AxisRange {
                axis_id: "axis_wght".to_string(),
                min: Some(600.0),
                max: None,
            }),
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let package = package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    );

    let index = build_dependency_index(&package).expect("dependency index should build");

    assert_eq!(
        index
            .glyphs
            .get("glyph_A")
            .expect("owner glyph should be indexed")
            .component_dependencies,
        vec![ShiftComponentUse {
            glyph_id: "glyph_stem".to_string(),
            glyph_name: "stem".to_string(),
            layer_id: "source_Regular".to_string(),
            component_id: "component_2".to_string(),
        }]
    );
    assert_eq!(
        index
            .glyphs
            .get("glyph_stem")
            .expect("base glyph should be indexed")
            .component_dependents,
        vec![ShiftComponentUse {
            glyph_id: "glyph_A".to_string(),
            glyph_name: "A".to_string(),
            layer_id: "source_Regular".to_string(),
            component_id: "component_2".to_string(),
        }]
    );

    let working_source =
        ShiftWorkingSource::new(package).expect("working source should initialize");
    let preview = working_source
        .preview_delete_glyph("glyph_stem")
        .expect("delete preview should use component dependency index");
    assert!(!preview.can_remove_without_decomposing);
    assert_eq!(
        preview.component_dependents,
        vec![ShiftComponentUse {
            glyph_id: "glyph_A".to_string(),
            glyph_name: "A".to_string(),
            layer_id: "source_Regular".to_string(),
            component_id: "component_2".to_string(),
        }]
    );
}

#[test]
fn working_source_renames_glyph_by_id_without_rewriting_component_refs() {
    let mut working_source = ShiftWorkingSource::new(package_with_component_dependency())
        .expect("working source should initialize");

    let report = working_source
        .rename_glyph("glyph_A", "RenamedBase")
        .expect("rename should succeed");

    assert_eq!(report.old_name, "A");
    assert_eq!(report.new_name, "RenamedBase");
    assert_eq!(report.revision, 1);
    assert_eq!(
        report.diff,
        ShiftPackageDiff {
            changes: vec![
                ShiftPackageChange::RenameGlyph {
                    glyph_id: "glyph_A".to_string(),
                },
                ShiftPackageChange::UpdateGlyphLabels {
                    glyph_id: "glyph_Aacute".to_string(),
                },
            ],
            impact: ShiftWriteImpact {
                canonical_paths: vec![
                    "glyphs/glyph_A.json".to_string(),
                    "glyphs/glyph_Aacute.json".to_string(),
                ],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![DEPENDENCY_INDEX_PATH.to_string()],
            },
        }
    );
    assert_eq!(
        report.component_dependents,
        vec![ShiftComponentUse {
            glyph_id: "glyph_Aacute".to_string(),
            glyph_name: "Aacute".to_string(),
            layer_id: "source_Regular".to_string(),
            component_id: "component_25".to_string(),
        }]
    );

    let base = working_source
        .package()
        .glyphs
        .iter()
        .find(|glyph| glyph.id == "glyph_A")
        .expect("renamed glyph should remain addressable by stable id");
    assert_eq!(base.name, "RenamedBase");

    let component = &working_source
        .package()
        .glyphs
        .iter()
        .find(|glyph| glyph.id == "glyph_Aacute")
        .expect("dependent glyph should still exist")
        .layers
        .get("source_Regular")
        .expect("dependent layer should still exist")
        .components[0];
    assert_eq!(component.base_glyph_id, "glyph_A");
    assert_eq!(component.base_glyph_name, "RenamedBase");

    let dependencies = working_source
        .glyph_dependencies("glyph_A")
        .expect("dependency query should use updated index");
    assert_eq!(dependencies.glyph_name, "RenamedBase");
}

#[test]
fn working_source_previews_glyph_rename_without_mutating() {
    let working_source = ShiftWorkingSource::new(package_with_component_dependency())
        .expect("working source should initialize");

    let preview = working_source
        .preview_rename_glyph("glyph_A", "RenamedBase")
        .expect("rename preview should succeed");

    assert_eq!(preview.glyph_id, "glyph_A");
    assert_eq!(preview.old_name, "A");
    assert_eq!(preview.new_name, "RenamedBase");
    assert_eq!(
        preview.component_dependents,
        vec![ShiftComponentUse {
            glyph_id: "glyph_Aacute".to_string(),
            glyph_name: "Aacute".to_string(),
            layer_id: "source_Regular".to_string(),
            component_id: "component_25".to_string(),
        }]
    );
    assert_eq!(
        preview.diff,
        ShiftPackageDiff {
            changes: vec![
                ShiftPackageChange::RenameGlyph {
                    glyph_id: "glyph_A".to_string(),
                },
                ShiftPackageChange::UpdateGlyphLabels {
                    glyph_id: "glyph_Aacute".to_string(),
                },
            ],
            impact: ShiftWriteImpact {
                canonical_paths: vec![
                    "glyphs/glyph_A.json".to_string(),
                    "glyphs/glyph_Aacute.json".to_string(),
                ],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![DEPENDENCY_INDEX_PATH.to_string()],
            },
        }
    );
    assert_eq!(working_source.revision(), 0);
    assert_eq!(
        working_source
            .package()
            .glyphs
            .iter()
            .find(|glyph| glyph.id == "glyph_A")
            .expect("glyph should still exist")
            .name,
        "A"
    );
}

#[test]
fn working_source_preview_rename_rejects_duplicate_and_missing_without_mutating() {
    let working_source = ShiftWorkingSource::new(package_with_component_dependency())
        .expect("working source should initialize");

    let error = working_source
        .preview_rename_glyph("glyph_A", "Aacute")
        .expect_err("duplicate glyph names should be rejected");
    assert!(matches!(
        error,
        ShiftSourceError::DuplicateGlyphName { glyph_name } if glyph_name == "Aacute"
    ));

    let error = working_source
        .preview_rename_glyph("glyph_missing", "Aacute")
        .expect_err("missing glyph should be reported before duplicate-name checks");
    assert!(matches!(
        error,
        ShiftSourceError::MissingGlyph { glyph_id } if glyph_id == "glyph_missing"
    ));
    assert_eq!(working_source.revision(), 0);
}

#[test]
fn working_source_rejects_blank_glyph_rename_without_mutating() {
    let mut working_source = ShiftWorkingSource::new(package_with_component_dependency())
        .expect("working source should initialize");

    let error = working_source
        .rename_glyph("glyph_A", "   ")
        .expect_err("blank rename should fail validation");

    assert!(matches!(
        error,
        ShiftSourceError::InvalidGlyphName { glyph_name } if glyph_name.is_empty()
    ));
    assert_eq!(working_source.revision(), 0);
    assert_eq!(
        working_source
            .package()
            .glyphs
            .iter()
            .find(|glyph| glyph.id == "glyph_A")
            .expect("glyph should still exist")
            .name,
        "A"
    );
}

#[test]
fn working_source_component_queries_use_current_base_glyph_name_after_rename() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_renamed_base".to_string(),
            base_glyph_id: "glyph_A".to_string(),
            base_glyph_name: "A".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::ResetUnspecifiedToFont,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_bold".to_string(),
                name: "Bold component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::new(),
                transform: None,
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let mut working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        vec![
            ShiftGlyph {
                id: "glyph_A".to_string(),
                name: "A".to_string(),
                unicodes: vec!["0041".to_string()],
                local_axes: Vec::new(),
                variation_sources: Vec::new(),
                layers: BTreeMap::new(),
            },
            ShiftGlyph {
                id: "glyph_Aacute".to_string(),
                name: "Aacute".to_string(),
                unicodes: vec!["00C1".to_string()],
                local_axes: Vec::new(),
                variation_sources: Vec::new(),
                layers: BTreeMap::from([("source_Regular".to_string(), component_layer)]),
            },
        ],
    ))
    .expect("working source should initialize");

    working_source
        .rename_glyph("glyph_A", "RenamedBase")
        .expect("rename should succeed");

    let stored_component = &working_source
        .package()
        .glyphs
        .iter()
        .find(|glyph| glyph.id == "glyph_Aacute")
        .expect("dependent glyph should exist")
        .layers
        .get("source_Regular")
        .expect("dependent layer should exist")
        .components[0];
    assert_eq!(stored_component.base_glyph_id, "glyph_A");
    assert_eq!(
        stored_component.base_glyph_name, "RenamedBase",
        "rename refreshes the inspectable label cache without changing identity"
    );

    let location = BTreeMap::from([("axis_wght".to_string(), 900.0)]);
    let activity = working_source
        .component_activity("glyph_Aacute", "source_Regular", &location)
        .expect("component activity should resolve");
    let recipes = working_source
        .component_recipes("glyph_Aacute", "source_Regular")
        .expect("component recipes should resolve");
    let variation_sources = working_source
        .component_variation_source_locations(
            "glyph_Aacute",
            "source_Regular",
            "component_renamed_base",
        )
        .expect("component variation sources should resolve");
    let resolved_locations = working_source
        .component_resolved_locations("glyph_Aacute", "source_Regular", &location)
        .expect("component locations should resolve");
    let resolved_states = working_source
        .component_resolved_states("glyph_Aacute", "source_Regular", &location)
        .expect("component states should resolve");
    let lowering = working_source
        .component_lowering_preflight(&ShiftComponentLoweringTarget::plain_components());

    assert_eq!(activity[0].base_glyph_name, "RenamedBase");
    assert_eq!(recipes[0].base_glyph_name, "RenamedBase");
    assert_eq!(variation_sources[0].base_glyph_name, "RenamedBase");
    assert_eq!(resolved_locations[0].base_glyph_name, "RenamedBase");
    assert_eq!(resolved_states[0].base_glyph_name, "RenamedBase");
    assert_eq!(lowering.diagnostics[0].base_glyph_name, "RenamedBase");
}

#[test]
fn working_source_rejects_duplicate_rename_without_mutating() {
    let mut working_source = ShiftWorkingSource::new(package_with_component_dependency())
        .expect("working source should initialize");

    let err = working_source
        .rename_glyph("glyph_A", "Aacute")
        .expect_err("duplicate glyph names should be rejected");

    assert!(matches!(
        err,
        ShiftSourceError::DuplicateGlyphName { glyph_name } if glyph_name == "Aacute"
    ));
    assert_eq!(working_source.revision(), 0);
    let base = working_source
        .package()
        .glyphs
        .iter()
        .find(|glyph| glyph.id == "glyph_A")
        .expect("base glyph should still exist");
    assert_eq!(base.name, "A");
}

#[test]
fn working_source_previews_delete_dependents() {
    let working_source = ShiftWorkingSource::new(package_with_component_dependency())
        .expect("working source should initialize");

    let blocked = working_source
        .preview_delete_glyph("glyph_A")
        .expect("base glyph preview should build");
    assert_eq!(blocked.glyph_name, "A");
    assert!(!blocked.can_remove_without_decomposing);
    assert_eq!(
        blocked.component_dependents,
        vec![ShiftComponentUse {
            glyph_id: "glyph_Aacute".to_string(),
            glyph_name: "Aacute".to_string(),
            layer_id: "source_Regular".to_string(),
            component_id: "component_25".to_string(),
        }]
    );

    let removable = working_source
        .preview_delete_glyph("glyph_Aacute")
        .expect("leaf glyph preview should build");
    assert!(removable.can_remove_without_decomposing);
    assert!(removable.component_dependents.is_empty());
}

#[test]
fn working_source_delete_preview_reports_dependent_component_recipe_impact() {
    let layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_variable_delete".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_wght".to_string(), 650.0)]),
            axis_inheritance: ShiftAxisInheritance::ResetUnspecifiedToFont,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_heavy".to_string(),
                name: "Heavy".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_wght".to_string(), 800.0)]),
                transform: Some(DecomposedTransform {
                    translate_x: 12.0,
                    translate_y: 0.0,
                    rotation: 0.0,
                    scale_x: 1.0,
                    scale_y: 1.0,
                    skew_x: 0.0,
                    skew_y: 0.0,
                    t_center_x: 0.0,
                    t_center_y: 0.0,
                }),
            }],
            condition: Some(ShiftCondition::AxisRange {
                axis_id: "axis_wght".to_string(),
                min: Some(500.0),
                max: None,
            }),
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer(layer),
    ))
    .expect("working source should initialize");

    let preview = working_source
        .preview_delete_glyph("glyph_stem")
        .expect("delete preview should include dependent recipe summaries");

    assert!(!preview.can_remove_without_decomposing);
    assert_eq!(preview.component_dependent_recipes.len(), 1);
    assert_eq!(
        preview.component_dependent_recipes[0],
        ShiftComponentRecipeSummary {
            glyph_id: "glyph_A".to_string(),
            glyph_name: "A".to_string(),
            layer_id: "source_Regular".to_string(),
            component_id: "component_variable_delete".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            kind: ShiftComponentRecipeKind::ConditionalVariable,
            axis_inheritance: ShiftAxisInheritance::ResetUnspecifiedToFont,
            condition_axis_ids: vec!["axis_wght".to_string()],
            location_axis_ids: vec!["axis_wght".to_string()],
            variation_source_count: 1,
            variation_parent_axis_ids: vec!["axis_wght".to_string()],
            variation_location_axis_ids: vec!["axis_wght".to_string()],
            varies_transform: true,
            lowering_hint: ShiftComponentLoweringHint::ConditionalVariableComponent,
            required_capabilities: vec![
                ShiftComponentLoweringCapability::Condition,
                ShiftComponentLoweringCapability::VariableLocation,
                ShiftComponentLoweringCapability::VariableTransform,
                ShiftComponentLoweringCapability::AxisReset,
            ],
        }
    );
}

#[test]
fn working_source_evaluates_component_activity_from_conditions() {
    let layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_3".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: Vec::new(),
            condition: Some(ShiftCondition::AxisRange {
                axis_id: "axis_wght".to_string(),
                min: Some(700.0),
                max: None,
            }),
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer(layer),
    ))
    .expect("working source should initialize");

    let default_activity = working_source
        .component_activity("glyph_A", "source_Regular", &BTreeMap::new())
        .expect("component activity should evaluate default location");
    assert_eq!(
        default_activity,
        vec![ShiftComponentActivity {
            glyph_id: "glyph_A".to_string(),
            glyph_name: "A".to_string(),
            layer_id: "source_Regular".to_string(),
            component_id: "component_3".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            active: false,
            condition: Some(ShiftConditionEvaluation::AxisRange {
                axis_id: "axis_wght".to_string(),
                value: 400.0,
                min: Some(700.0),
                max: None,
                active: false,
            }),
        }]
    );

    let heavy_activity = working_source
        .component_activity(
            "glyph_A",
            "source_Regular",
            &BTreeMap::from([("axis_wght".to_string(), 700.0)]),
        )
        .expect("component activity should evaluate supplied location");
    assert!(heavy_activity[0].active);
}

#[test]
fn working_source_component_activity_supports_boolean_condition_trees() {
    let layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_4".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: Vec::new(),
            condition: Some(ShiftCondition::And {
                conditions: vec![
                    ShiftCondition::AxisRange {
                        axis_id: "axis_wght".to_string(),
                        min: Some(500.0),
                        max: None,
                    },
                    ShiftCondition::Not {
                        condition: Box::new(ShiftCondition::AxisRange {
                            axis_id: "axis_wght".to_string(),
                            min: Some(800.0),
                            max: None,
                        }),
                    },
                ],
            }),
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer(layer),
    ))
    .expect("working source should initialize");

    let medium = working_source
        .component_activity(
            "glyph_A",
            "source_Regular",
            &BTreeMap::from([("axis_wght".to_string(), 700.0)]),
        )
        .expect("component activity should evaluate boolean condition");
    let black = working_source
        .component_activity(
            "glyph_A",
            "source_Regular",
            &BTreeMap::from([("axis_wght".to_string(), 900.0)]),
        )
        .expect("component activity should evaluate negated condition");

    assert!(medium[0].active);
    assert!(!black[0].active);
    assert_eq!(
        black[0].condition,
        Some(ShiftConditionEvaluation::And {
            active: false,
            conditions: vec![
                ShiftConditionEvaluation::AxisRange {
                    axis_id: "axis_wght".to_string(),
                    value: 900.0,
                    min: Some(500.0),
                    max: None,
                    active: true,
                },
                ShiftConditionEvaluation::Not {
                    active: false,
                    condition: Box::new(ShiftConditionEvaluation::AxisRange {
                        axis_id: "axis_wght".to_string(),
                        value: 900.0,
                        min: Some(800.0),
                        max: None,
                        active: true,
                    }),
                },
            ],
        })
    );
}

#[test]
fn working_source_component_activity_reports_missing_layer() {
    let working_source = ShiftWorkingSource::new(package_with_component_dependency())
        .expect("working source should initialize");

    let err = working_source
        .component_activity("glyph_Aacute", "source_Missing", &BTreeMap::new())
        .expect_err("missing layer should fail");

    assert!(matches!(
        err,
        ShiftSourceError::MissingGlyphLayer { glyph_id, layer_id }
            if glyph_id == "glyph_Aacute" && layer_id == "source_Missing"
    ));
}

#[test]
fn working_source_component_activity_rejects_invalid_query_location() {
    let working_source = ShiftWorkingSource::new(package_with_component_dependency())
        .expect("working source should initialize");

    let err = working_source
        .component_activity(
            "glyph_Aacute",
            "source_Regular",
            &BTreeMap::from([("axis_missing".to_string(), 1.0)]),
        )
        .expect_err("component activity should reject missing location axes");

    assert!(matches!(
        err,
        ShiftSourceError::MissingQueryLocationAxis { context, axis_id }
            if context == "component activity" && axis_id == "axis_missing"
    ));
}

#[test]
fn working_source_maps_user_location_to_internal_axes() {
    let working_source =
        ShiftWorkingSource::new(package_with_weight_to_stem_mapping()).expect("package is valid");

    let mapped = working_source
        .mapped_location(&BTreeMap::from([("axis_wght".to_string(), 700.0)]))
        .expect("mapped location should build");

    assert!(mapped.diagnostics.is_empty());
    assert_eq!(
        mapped.values.get("axis_wght"),
        Some(&ShiftMappedAxisValue {
            value: 700.0,
            source: ShiftMappedAxisValueSource::InputLocation,
            mapping_id: None,
        })
    );
    assert_eq!(
        mapped.values.get("axis_stem"),
        Some(&ShiftMappedAxisValue {
            value: 0.75,
            source: ShiftMappedAxisValueSource::AxisMapping,
            mapping_id: Some("mapping_weight_to_stem".to_string()),
        })
    );
}

#[test]
fn working_source_mapped_location_rejects_invalid_query_location() {
    let working_source =
        ShiftWorkingSource::new(package_with_weight_to_stem_mapping()).expect("package is valid");

    let missing_axis_err = working_source
        .mapped_location(&BTreeMap::from([("axis_missing".to_string(), 1.0)]))
        .expect_err("mapped location should reject missing query axes");
    assert!(matches!(
        missing_axis_err,
        ShiftSourceError::MissingQueryLocationAxis { context, axis_id }
            if context == "mapped location" && axis_id == "axis_missing"
    ));

    let out_of_range_err = working_source
        .mapped_location(&BTreeMap::from([("axis_wght".to_string(), 1000.0)]))
        .expect_err("mapped location should reject out-of-range query axes");
    assert!(matches!(
        out_of_range_err,
        ShiftSourceError::AxisCoordinateOutOfRange {
            context,
            axis_id,
            value,
            minimum: 100.0,
            maximum: 900.0,
        } if context == "mapped location" && axis_id == "axis_wght" && value == 1000.0
    ));
}

#[test]
fn working_source_mapping_uses_defaults_and_reports_outside_sample_range() {
    let mut package = package_with_weight_to_stem_mapping();
    package.axis_mappings[0].samples = vec![
        ShiftAxisMappingSample {
            input_location: BTreeMap::from([("axis_wght".to_string(), 500.0)]),
            output_location: BTreeMap::from([("axis_stem".to_string(), 0.25)]),
        },
        ShiftAxisMappingSample {
            input_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
            output_location: BTreeMap::from([("axis_stem".to_string(), 1.0)]),
        },
    ];
    let working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let mapped = working_source
        .mapped_location(&BTreeMap::new())
        .expect("mapped location should build");

    assert_eq!(
        mapped.values.get("axis_wght"),
        Some(&ShiftMappedAxisValue {
            value: 400.0,
            source: ShiftMappedAxisValueSource::AxisDefault,
            mapping_id: None,
        })
    );
    assert_eq!(
        mapped.diagnostics,
        vec![ShiftAxisMappingDiagnostic {
            mapping_id: "mapping_weight_to_stem".to_string(),
            kind: ShiftAxisMappingDiagnosticKind::OutsideSampleRange {
                axis_id: "axis_wght".to_string(),
                value: 400.0,
            },
        }]
    );
    assert_eq!(
        mapped.values.get("axis_stem"),
        Some(&ShiftMappedAxisValue {
            value: 0.0,
            source: ShiftMappedAxisValueSource::AxisDefault,
            mapping_id: None,
        })
    );
}

#[test]
fn working_source_multi_axis_mapping_interpolates_between_samples() {
    let mut package = package_with_axes(
        vec![weight_axis(), width_axis(), internal_stem_axis()],
        Vec::new(),
    );
    package.axis_mappings = vec![ShiftAxisMapping {
        id: "mapping_weight_width_to_stem".to_string(),
        name: "Weight and width drive stem".to_string(),
        input_axes: vec!["axis_wght".to_string(), "axis_wdth".to_string()],
        output_axes: vec!["axis_stem".to_string()],
        samples: vec![
            ShiftAxisMappingSample {
                input_location: BTreeMap::from([
                    ("axis_wght".to_string(), 400.0),
                    ("axis_wdth".to_string(), 100.0),
                ]),
                output_location: BTreeMap::from([("axis_stem".to_string(), 0.0)]),
            },
            ShiftAxisMappingSample {
                input_location: BTreeMap::from([
                    ("axis_wght".to_string(), 900.0),
                    ("axis_wdth".to_string(), 100.0),
                ]),
                output_location: BTreeMap::from([("axis_stem".to_string(), 0.6)]),
            },
            ShiftAxisMappingSample {
                input_location: BTreeMap::from([
                    ("axis_wght".to_string(), 400.0),
                    ("axis_wdth".to_string(), 200.0),
                ]),
                output_location: BTreeMap::from([("axis_stem".to_string(), 0.2)]),
            },
            ShiftAxisMappingSample {
                input_location: BTreeMap::from([
                    ("axis_wght".to_string(), 900.0),
                    ("axis_wdth".to_string(), 200.0),
                ]),
                output_location: BTreeMap::from([("axis_stem".to_string(), 0.8)]),
            },
        ],
    }];
    let working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let exact = working_source
        .mapped_location(&BTreeMap::from([
            ("axis_wght".to_string(), 900.0),
            ("axis_wdth".to_string(), 200.0),
        ]))
        .expect("exact mapping should build");
    let interpolated = working_source
        .mapped_location(&BTreeMap::from([
            ("axis_wght".to_string(), 650.0),
            ("axis_wdth".to_string(), 150.0),
        ]))
        .expect("interpolated mapping should build");

    assert!(exact.diagnostics.is_empty());
    assert_eq!(exact.values["axis_stem"].value, 0.8);
    assert!(interpolated.diagnostics.is_empty());
    assert_eq!(
        interpolated.values["axis_stem"],
        ShiftMappedAxisValue {
            value: 0.4,
            source: ShiftMappedAxisValueSource::AxisMapping,
            mapping_id: Some("mapping_weight_width_to_stem".to_string()),
        }
    );
}

#[test]
fn working_source_prepares_commit_from_saved_baseline() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();
    save_package(&package, &package_path).expect("package should save");
    let mut working_source =
        ShiftWorkingSource::open_saved(&package_path, package).expect("working source should open");

    working_source
        .rename_glyph("glyph_A", "RenamedBase")
        .expect("rename should succeed");
    let prepared = working_source
        .prepare_commit(&package_path)
        .expect("commit should prepare");

    assert!(prepared.conflicts.is_empty());
    assert_eq!(
        prepared.diff.changes,
        vec![
            ShiftPackageChange::RenameGlyph {
                glyph_id: "glyph_A".to_string(),
            },
            ShiftPackageChange::UpdateGlyphLabels {
                glyph_id: "glyph_Aacute".to_string(),
            },
        ]
    );
    assert_eq!(
        prepared.impacted_paths,
        vec![
            DEPENDENCY_INDEX_PATH.to_string(),
            "glyphs/glyph_A.json".to_string(),
            "glyphs/glyph_Aacute.json".to_string(),
        ]
    );
}

#[test]
fn working_source_prepared_commit_reports_external_changes_since_open() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();
    save_package(&package, &package_path).expect("package should save");
    let mut working_source =
        ShiftWorkingSource::open_saved(&package_path, package).expect("working source should open");

    working_source
        .rename_glyph("glyph_A", "RenamedBase")
        .expect("rename should succeed");
    fs::write(
        package_path.join("glyphs/glyph_A.json"),
        "{\"externally\":\"modified\"}\n",
    )
    .expect("glyph file should be modified externally");

    let prepared = working_source
        .prepare_commit(&package_path)
        .expect("commit should prepare with conflict diagnostics");

    assert_eq!(
        prepared
            .conflicts
            .iter()
            .map(|conflict| (conflict.path.as_str(), conflict.kind))
            .collect::<Vec<_>>(),
        vec![(
            "glyphs/glyph_A.json",
            ShiftFingerprintConflictKind::Modified,
        )]
    );
}

#[test]
fn working_source_previews_save_ready_without_staging() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();
    save_package(&package, &package_path).expect("package should save");
    let mut working_source =
        ShiftWorkingSource::open_saved(&package_path, package).expect("working source should open");

    working_source
        .rename_glyph("glyph_A", "RenamedBase")
        .expect("rename should succeed");
    let preview = working_source
        .preview_save(&package_path)
        .expect("save preview should prepare");

    assert_eq!(preview.status, ShiftWorkingSourceSavePreviewStatus::Ready);
    assert_eq!(preview.revision, 1);
    assert_eq!(preview.summary.change_count, 2);
    assert_eq!(preview.summary.impacted_path_count, 3);
    assert_eq!(preview.summary.conflict_count, 0);
    assert_eq!(preview.summary.staged_recovery_count, 0);
    assert_eq!(preview.summary.write_file_count, 3);
    assert!(preview.prepared.conflicts.is_empty());
    assert_eq!(
        preview.prepared.diff.changes,
        vec![
            ShiftPackageChange::RenameGlyph {
                glyph_id: "glyph_A".to_string(),
            },
            ShiftPackageChange::UpdateGlyphLabels {
                glyph_id: "glyph_Aacute".to_string(),
            },
        ]
    );
    assert!(
        !package_path.join(".shift-txn").exists(),
        "previewing save should not stage a transaction"
    );
    assert_eq!(working_source.revision(), 1);
}

#[test]
fn working_source_previews_save_blocked_by_active_staged_commit() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();
    let (_, staged) = stage_base_glyph_rename(&package_path, "StagedBase");
    let mut working_source =
        ShiftWorkingSource::open_saved(&package_path, package).expect("working source should open");

    working_source
        .rename_glyph("glyph_A", "RenamedBase")
        .expect("rename should succeed");
    let preview = working_source
        .preview_save(&package_path)
        .expect("save preview should inspect staged commits");

    assert_eq!(
        preview.status,
        ShiftWorkingSourceSavePreviewStatus::BlockedByStagedCommit
    );
    assert_eq!(preview.revision, 1);
    assert_eq!(preview.summary.change_count, 2);
    assert_eq!(preview.summary.conflict_count, 0);
    assert_eq!(preview.summary.staged_recovery_count, 1);
    assert_eq!(preview.staged_recovery_plans.len(), 1);
    assert_eq!(
        preview.staged_recovery_plans[0].transaction_id,
        staged.transaction_id
    );
    assert_eq!(
        preview.staged_recovery_plans[0].action,
        ShiftStagedCommitRecoveryAction::Resume
    );
    assert_eq!(
        preview.prepared.diff.changes,
        vec![
            ShiftPackageChange::RenameGlyph {
                glyph_id: "glyph_A".to_string(),
            },
            ShiftPackageChange::UpdateGlyphLabels {
                glyph_id: "glyph_Aacute".to_string(),
            },
        ]
    );
}

#[test]
fn working_source_previews_save_unchanged_without_refreshing_baseline() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();
    save_package(&package, &package_path).expect("package should save");
    let working_source =
        ShiftWorkingSource::open_saved(&package_path, package).expect("working source should open");

    let preview = working_source
        .preview_save(&package_path)
        .expect("save preview should prepare");

    assert_eq!(
        preview.status,
        ShiftWorkingSourceSavePreviewStatus::Unchanged
    );
    assert_eq!(preview.revision, 0);
    assert_eq!(preview.summary.change_count, 0);
    assert_eq!(preview.summary.impacted_path_count, 0);
    assert_eq!(preview.summary.conflict_count, 0);
    assert_eq!(preview.summary.staged_recovery_count, 0);
    assert_eq!(preview.summary.write_file_count, 0);
    assert_eq!(
        preview.prepared.diff.changes,
        Vec::<ShiftPackageChange>::new()
    );
    assert!(
        !package_path.join(".shift-txn").exists(),
        "previewing unchanged save should not stage a transaction"
    );
}

#[test]
fn working_source_previews_unchanged_save_blocked_by_external_changes() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();
    save_package(&package, &package_path).expect("package should save");
    let working_source =
        ShiftWorkingSource::open_saved(&package_path, package).expect("working source should open");

    fs::write(
        package_path.join("glyphs/glyph_A.json"),
        "{\"externally\":\"modified\"}\n",
    )
    .expect("glyph file should be modified externally");

    let preview = working_source
        .preview_save(&package_path)
        .expect("save preview should prepare with conflict diagnostics");

    assert_eq!(
        preview.status,
        ShiftWorkingSourceSavePreviewStatus::BlockedByExternalChanges
    );
    assert_eq!(preview.revision, 0);
    assert_eq!(preview.summary.change_count, 0);
    assert_eq!(preview.summary.conflict_count, 1);
    assert_eq!(preview.summary.staged_recovery_count, 0);
    assert_eq!(
        preview
            .prepared
            .conflicts
            .iter()
            .map(|conflict| (conflict.path.as_str(), conflict.kind))
            .collect::<Vec<_>>(),
        vec![(
            "glyphs/glyph_A.json",
            ShiftFingerprintConflictKind::Modified,
        )]
    );
}

#[test]
fn working_source_previews_save_blocked_by_external_changes() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();
    save_package(&package, &package_path).expect("package should save");
    let mut working_source =
        ShiftWorkingSource::open_saved(&package_path, package).expect("working source should open");

    working_source
        .rename_glyph("glyph_A", "RenamedBase")
        .expect("rename should succeed");
    fs::write(
        package_path.join("glyphs/glyph_A.json"),
        "{\"externally\":\"modified\"}\n",
    )
    .expect("glyph file should be modified externally");

    let preview = working_source
        .preview_save(&package_path)
        .expect("save preview should prepare with conflict diagnostics");

    assert_eq!(
        preview.status,
        ShiftWorkingSourceSavePreviewStatus::BlockedByExternalChanges
    );
    assert_eq!(preview.revision, 1);
    assert_eq!(preview.summary.change_count, 2);
    assert_eq!(preview.summary.conflict_count, 1);
    assert_eq!(preview.summary.staged_recovery_count, 0);
    assert_eq!(
        preview
            .prepared
            .conflicts
            .iter()
            .map(|conflict| (conflict.path.as_str(), conflict.kind))
            .collect::<Vec<_>>(),
        vec![(
            "glyphs/glyph_A.json",
            ShiftFingerprintConflictKind::Modified,
        )]
    );
    assert!(
        !package_path.join(".shift-txn").exists(),
        "blocked preview should not stage a transaction"
    );
    assert_eq!(working_source.revision(), 1);
}

#[test]
fn working_source_unchanged_save_refuses_external_changes_without_marking_saved() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();
    save_package(&package, &package_path).expect("package should save");
    let mut working_source =
        ShiftWorkingSource::open_saved(&package_path, package).expect("working source should open");

    fs::write(
        package_path.join("glyphs/glyph_A.json"),
        "{\"externally\":\"modified\"}\n",
    )
    .expect("glyph file should be modified externally");

    let err = working_source
        .save(&package_path)
        .expect_err("unchanged save should still block external changes");

    assert!(matches!(
        err,
        ShiftSourceError::PreparedCommitHasConflicts { conflict_count: 1 }
    ));
    assert_eq!(working_source.revision(), 0);

    working_source
        .rename_glyph("glyph_A", "RenamedBase")
        .expect("rename should succeed after blocked save");
    let prepared = working_source
        .prepare_commit(&package_path)
        .expect("commit should still compare against original baseline");

    assert_eq!(
        prepared
            .conflicts
            .iter()
            .map(|conflict| (conflict.path.as_str(), conflict.kind))
            .collect::<Vec<_>>(),
        vec![(
            "glyphs/glyph_A.json",
            ShiftFingerprintConflictKind::Modified,
        )]
    );
}

#[test]
fn working_source_save_refuses_active_staged_commit_without_marking_saved() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();
    let _ = stage_base_glyph_rename(&package_path, "StagedBase");
    let mut working_source =
        ShiftWorkingSource::open_saved(&package_path, package).expect("working source should open");

    let err = working_source
        .save(&package_path)
        .expect_err("active staged commit should block even unchanged saves");

    assert!(matches!(
        err,
        ShiftSourceError::ActiveStagedCommits {
            transaction_count: 1
        }
    ));
    assert_eq!(working_source.revision(), 0);

    working_source
        .rename_glyph("glyph_A", "RenamedBase")
        .expect("rename should succeed after blocked save");
    let preview = working_source
        .preview_save(&package_path)
        .expect("save preview should still report staged commit");

    assert_eq!(
        preview.status,
        ShiftWorkingSourceSavePreviewStatus::BlockedByStagedCommit
    );
    assert_eq!(preview.revision, 1);
}

#[test]
fn working_source_mark_saved_resets_baseline_and_revision() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();
    save_package(&package, &package_path).expect("package should save");
    let mut working_source =
        ShiftWorkingSource::open_saved(&package_path, package).expect("working source should open");

    working_source
        .rename_glyph("glyph_A", "RenamedBase")
        .expect("rename should succeed");
    save_package(working_source.package(), &package_path).expect("package should save");
    working_source
        .mark_saved(&package_path)
        .expect("saved baseline should refresh");

    assert_eq!(working_source.revision(), 0);
    assert_eq!(
        working_source
            .prepare_commit(&package_path)
            .expect("clean commit should prepare")
            .diff
            .changes,
        Vec::<ShiftPackageChange>::new()
    );
}

#[test]
fn working_source_mark_saved_failure_does_not_replace_saved_baseline() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();
    save_package(&package, &package_path).expect("package should save");
    let mut working_source =
        ShiftWorkingSource::open_saved(&package_path, package).expect("working source should open");

    working_source
        .rename_glyph("glyph_A", "RenamedBase")
        .expect("rename should succeed");
    fs::remove_dir_all(package_path.join("glyphs")).expect("glyph dir should be removable");
    fs::write(package_path.join("glyphs"), "not a directory\n")
        .expect("glyph path should be replaced by a file");

    let err = working_source
        .mark_saved(&package_path)
        .expect_err("broken package root should not mark saved");

    assert!(matches!(
        err,
        ShiftSourceError::ReadFile { path, .. } if path == package_path.join("glyphs")
    ));
    assert_eq!(working_source.revision(), 1);
    assert_eq!(
        working_source
            .saved_package()
            .glyphs
            .iter()
            .find(|glyph| glyph.id == "glyph_A")
            .map(|glyph| glyph.name.as_str()),
        Some("A")
    );
}

#[test]
fn working_source_mark_saved_refuses_active_staged_commit() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();
    let _ = stage_base_glyph_rename(&package_path, "StagedBase");
    let mut working_source =
        ShiftWorkingSource::open_saved(&package_path, package).expect("working source should open");

    working_source
        .rename_glyph("glyph_A", "RenamedBase")
        .expect("rename should succeed");
    let err = working_source
        .mark_saved(&package_path)
        .expect_err("active staged commit should block mark saved");

    assert!(matches!(
        err,
        ShiftSourceError::ActiveStagedCommits {
            transaction_count: 1
        }
    ));
    assert_eq!(working_source.revision(), 1);
    assert_eq!(
        working_source
            .saved_package()
            .glyphs
            .iter()
            .find(|glyph| glyph.id == "glyph_A")
            .map(|glyph| glyph.name.as_str()),
        Some("A")
    );
}

#[test]
fn working_source_mark_saved_refuses_disk_package_mismatch() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();
    save_package(&package, &package_path).expect("package should save");
    let mut working_source =
        ShiftWorkingSource::open_saved(&package_path, package).expect("working source should open");

    working_source
        .rename_glyph("glyph_A", "RenamedBase")
        .expect("rename should succeed");
    let mut external_package = working_source.package().clone();
    rename_base_glyph_and_component_label_cache(&mut external_package, "ExternalBase");
    save_package(&external_package, &package_path).expect("external package should save");

    let err = working_source
        .mark_saved(&package_path)
        .expect_err("disk package mismatch should block mark saved");

    assert!(matches!(
        err,
        ShiftSourceError::SavedPackageMismatch { change_count } if change_count > 0
    ));
    assert_eq!(working_source.revision(), 1);
    assert_eq!(
        working_source
            .saved_package()
            .glyphs
            .iter()
            .find(|glyph| glyph.id == "glyph_A")
            .map(|glyph| glyph.name.as_str()),
        Some("A")
    );
}

#[test]
fn working_source_save_stages_applies_and_marks_saved() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();
    save_package(&package, &package_path).expect("package should save");
    let mut working_source =
        ShiftWorkingSource::open_saved(&package_path, package).expect("working source should open");

    working_source
        .rename_glyph("glyph_A", "RenamedBase")
        .expect("rename should succeed");
    let report = working_source
        .save(&package_path)
        .expect("working source should save");
    let loaded = load_package(&package_path).expect("saved package should load");

    assert_eq!(report.status, ShiftWorkingSourceSaveStatus::Saved);
    assert_eq!(report.summary.change_count, 2);
    assert_eq!(report.summary.impacted_path_count, 3);
    assert_eq!(report.summary.conflict_count, 0);
    assert_eq!(report.summary.staged_recovery_count, 0);
    assert_eq!(report.summary.write_file_count, 3);
    assert!(report.staged.is_some());
    assert!(report.applied.is_some());
    assert_eq!(report.revision, 0);
    assert_eq!(working_source.revision(), 0);
    assert_eq!(
        working_source
            .prepare_commit(&package_path)
            .expect("clean commit should prepare")
            .diff
            .changes,
        Vec::<ShiftPackageChange>::new()
    );
    assert_eq!(
        loaded
            .glyphs
            .iter()
            .find(|glyph| glyph.id == "glyph_A")
            .map(|glyph| glyph.name.as_str()),
        Some("RenamedBase")
    );
    assert!(
        inspect_staged_commits(&package_path)
            .expect("staged commits should inspect")
            .is_empty(),
        "successful save should not leave an unresolved transaction"
    );
}

#[test]
fn working_source_save_without_changes_refreshes_baseline_without_staging() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();
    save_package(&package, &package_path).expect("package should save");
    let mut working_source =
        ShiftWorkingSource::open_saved(&package_path, package).expect("working source should open");

    let report = working_source
        .save(&package_path)
        .expect("unchanged working source should save as a no-op");

    assert_eq!(report.status, ShiftWorkingSourceSaveStatus::Unchanged);
    assert_eq!(report.summary.change_count, 0);
    assert_eq!(report.summary.impacted_path_count, 0);
    assert_eq!(report.summary.conflict_count, 0);
    assert_eq!(report.summary.staged_recovery_count, 0);
    assert_eq!(report.summary.write_file_count, 0);
    assert!(report.staged.is_none());
    assert!(report.applied.is_none());
    assert_eq!(
        report.prepared.diff.changes,
        Vec::<ShiftPackageChange>::new()
    );
    assert_eq!(working_source.revision(), 0);
    assert!(
        !package_path.join(".shift-txn").exists(),
        "unchanged save should not create a transaction"
    );
}

#[test]
fn working_source_save_refuses_external_conflicts_before_staging() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let package = package_with_component_dependency();
    save_package(&package, &package_path).expect("package should save");
    let mut working_source =
        ShiftWorkingSource::open_saved(&package_path, package).expect("working source should open");

    working_source
        .rename_glyph("glyph_A", "RenamedBase")
        .expect("rename should succeed");
    fs::write(
        package_path.join("glyphs/glyph_A.json"),
        "{\"externally\":\"modified\"}\n",
    )
    .expect("glyph file should be modified externally");

    let err = working_source
        .save(&package_path)
        .expect_err("external conflict should block save before staging");

    assert!(matches!(
        err,
        ShiftSourceError::PreparedCommitHasConflicts { conflict_count: 1 }
    ));
    assert_eq!(
        fs::read_to_string(package_path.join("glyphs/glyph_A.json"))
            .expect("live glyph should be readable"),
        "{\"externally\":\"modified\"}\n"
    );
    assert_eq!(working_source.revision(), 1);
    assert!(
        !package_path.join(".shift-txn").exists(),
        "conflicting save should not stage a transaction"
    );
}

#[test]
fn working_source_resolves_component_location_with_parent_and_local_axes() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_5".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 42.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: Vec::new(),
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let resolved = working_source
        .component_resolved_locations(
            "glyph_A",
            "source_Regular",
            &BTreeMap::from([("axis_wght".to_string(), 700.0)]),
        )
        .expect("component location should resolve");

    assert_eq!(resolved.len(), 1);
    assert_eq!(
        resolved[0].axis_inheritance,
        ShiftAxisInheritance::InheritParent
    );
    assert_eq!(
        resolved[0].values.get("axis_wght"),
        Some(&ShiftResolvedAxisValue {
            value: 700.0,
            source: ShiftResolvedAxisValueSource::ParentLocation,
        })
    );
    assert_eq!(
        resolved[0].values.get("axis_stemWidth"),
        Some(&ShiftResolvedAxisValue {
            value: 42.0,
            source: ShiftResolvedAxisValueSource::ComponentOverride,
        })
    );

    let err = working_source
        .component_resolved_locations(
            "glyph_A",
            "source_Regular",
            &BTreeMap::from([("axis_wght".to_string(), f64::INFINITY)]),
        )
        .expect_err("component location resolution should reject non-finite locations");
    assert!(matches!(
        err,
        ShiftSourceError::NonFiniteNumber {
            context,
            field,
            value,
        } if context == "component resolved locations font location"
            && field == "axis_wght"
            && value.is_infinite()
    ));
}

#[test]
fn working_source_resolves_component_location_with_reset_font_location() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_6".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::ResetUnspecifiedToFont,
            variation_sources: Vec::new(),
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let resolved = working_source
        .component_resolved_locations(
            "glyph_A",
            "source_Regular",
            &BTreeMap::from([("axis_wght".to_string(), 900.0)]),
        )
        .expect("component location should resolve");

    assert_eq!(
        resolved[0].values.get("axis_wght"),
        Some(&ShiftResolvedAxisValue {
            value: 900.0,
            source: ShiftResolvedAxisValueSource::FontLocation,
        })
    );
    assert_eq!(
        resolved[0].values.get("axis_stemWidth"),
        Some(&ShiftResolvedAxisValue {
            value: 40.0,
            source: ShiftResolvedAxisValueSource::BaseLocalDefault,
        })
    );
}

#[test]
fn working_source_resolves_components_with_distinct_font_and_parent_locations() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![
            ShiftComponent {
                id: "component_inherit".to_string(),
                base_glyph_id: "glyph_stem".to_string(),
                base_glyph_name: "stem".to_string(),
                transform: DecomposedTransform::identity(),
                location: BTreeMap::new(),
                axis_inheritance: ShiftAxisInheritance::InheritParent,
                variation_sources: Vec::new(),
                condition: Some(ShiftCondition::AxisRange {
                    axis_id: "axis_wght".to_string(),
                    min: Some(600.0),
                    max: None,
                }),
            },
            ShiftComponent {
                id: "component_reset".to_string(),
                base_glyph_id: "glyph_stem".to_string(),
                base_glyph_name: "stem".to_string(),
                transform: DecomposedTransform::identity(),
                location: BTreeMap::new(),
                axis_inheritance: ShiftAxisInheritance::ResetUnspecifiedToFont,
                variation_sources: vec![ShiftComponentVariationSource {
                    id: "componentSource_parent".to_string(),
                    name: "Parent source".to_string(),
                    parent_location: BTreeMap::from([("axis_wght".to_string(), 250.0)]),
                    location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                    transform: None,
                }],
                condition: None,
            },
        ],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let resolved = working_source
        .component_resolved_locations_with_context(
            "glyph_A",
            "source_Regular",
            &ShiftComponentResolveContext {
                font_location: BTreeMap::from([("axis_wght".to_string(), 700.0)]),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 250.0)]),
            },
        )
        .expect("component locations should resolve");

    assert_eq!(
        resolved[0].condition,
        Some(ShiftConditionEvaluation::AxisRange {
            axis_id: "axis_wght".to_string(),
            value: 700.0,
            min: Some(600.0),
            max: None,
            active: true,
        })
    );
    assert_eq!(
        resolved[0].values.get("axis_wght"),
        Some(&ShiftResolvedAxisValue {
            value: 250.0,
            source: ShiftResolvedAxisValueSource::ParentLocation,
        })
    );
    assert_eq!(
        resolved[1].values.get("axis_wght"),
        Some(&ShiftResolvedAxisValue {
            value: 700.0,
            source: ShiftResolvedAxisValueSource::FontLocation,
        })
    );

    let resolved_states = working_source
        .component_resolved_states_with_context(
            "glyph_A",
            "source_Regular",
            &ShiftComponentResolveContext {
                font_location: BTreeMap::from([("axis_wght".to_string(), 700.0)]),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 250.0)]),
            },
        )
        .expect("component states should resolve");
    assert_eq!(
        resolved_states[1].variation_resolution,
        ShiftComponentVariationResolution::ExactSource {
            source: crate::ShiftComponentResolvedVariationSource {
                id: "componentSource_parent".to_string(),
                name: "Parent source".to_string(),
            },
        }
    );
    assert_eq!(
        resolved_states[1].values.get("axis_stemWidth"),
        Some(&ShiftResolvedAxisValue {
            value: 72.0,
            source: ShiftResolvedAxisValueSource::ComponentVariationSource,
        })
    );
}

#[test]
fn working_source_summarizes_component_recipes_without_resolving_locations() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![
            ShiftComponent {
                id: "component_plain".to_string(),
                base_glyph_id: "glyph_stem".to_string(),
                base_glyph_name: "stem".to_string(),
                transform: DecomposedTransform::identity(),
                location: BTreeMap::new(),
                axis_inheritance: ShiftAxisInheritance::InheritParent,
                variation_sources: Vec::new(),
                condition: None,
            },
            ShiftComponent {
                id: "component_conditional".to_string(),
                base_glyph_id: "glyph_stem".to_string(),
                base_glyph_name: "stem".to_string(),
                transform: DecomposedTransform::identity(),
                location: BTreeMap::new(),
                axis_inheritance: ShiftAxisInheritance::InheritParent,
                variation_sources: Vec::new(),
                condition: Some(ShiftCondition::And {
                    conditions: vec![
                        ShiftCondition::AxisRange {
                            axis_id: "axis_wdth".to_string(),
                            min: Some(90.0),
                            max: None,
                        },
                        ShiftCondition::Not {
                            condition: Box::new(ShiftCondition::AxisRange {
                                axis_id: "axis_wght".to_string(),
                                min: Some(900.0),
                                max: None,
                            }),
                        },
                    ],
                }),
            },
            ShiftComponent {
                id: "component_variable".to_string(),
                base_glyph_id: "glyph_stem".to_string(),
                base_glyph_name: "stem".to_string(),
                transform: DecomposedTransform::identity(),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 44.0)]),
                axis_inheritance: ShiftAxisInheritance::InheritParent,
                variation_sources: Vec::new(),
                condition: None,
            },
            ShiftComponent {
                id: "component_variable_conditional".to_string(),
                base_glyph_id: "glyph_stem".to_string(),
                base_glyph_name: "stem".to_string(),
                transform: DecomposedTransform::identity(),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 42.0)]),
                axis_inheritance: ShiftAxisInheritance::ResetUnspecifiedToFont,
                variation_sources: vec![ShiftComponentVariationSource {
                    id: "componentSource_black".to_string(),
                    name: "Black component".to_string(),
                    parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                    location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                    transform: Some(DecomposedTransform {
                        translate_x: 12.0,
                        ..DecomposedTransform::identity()
                    }),
                }],
                condition: Some(ShiftCondition::AxisRange {
                    axis_id: "axis_wdth".to_string(),
                    min: Some(90.0),
                    max: None,
                }),
            },
        ],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis(), width_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let recipes = working_source
        .component_recipes("glyph_A", "source_Regular")
        .expect("component recipes should summarize");

    assert_eq!(recipes.len(), 4);
    assert_eq!(recipes[0].component_id, "component_plain");
    assert_eq!(recipes[0].kind, ShiftComponentRecipeKind::Static);
    assert_eq!(recipes[0].condition_axis_ids, Vec::<String>::new());
    assert_eq!(recipes[0].variation_source_count, 0);
    assert!(!recipes[0].varies_transform);
    assert_eq!(
        recipes[0].lowering_hint,
        ShiftComponentLoweringHint::StaticComponent
    );
    assert_eq!(
        recipes[0].required_capabilities,
        Vec::<ShiftComponentLoweringCapability>::new()
    );

    assert_eq!(recipes[1].component_id, "component_conditional");
    assert_eq!(recipes[1].kind, ShiftComponentRecipeKind::Conditional);
    assert_eq!(
        recipes[1].condition_axis_ids,
        vec!["axis_wdth".to_string(), "axis_wght".to_string()]
    );
    assert_eq!(recipes[1].location_axis_ids, Vec::<String>::new());
    assert_eq!(
        recipes[1].lowering_hint,
        ShiftComponentLoweringHint::ConditionalComponent
    );
    assert_eq!(
        recipes[1].required_capabilities,
        vec![ShiftComponentLoweringCapability::Condition]
    );

    assert_eq!(recipes[2].component_id, "component_variable");
    assert_eq!(recipes[2].kind, ShiftComponentRecipeKind::Variable);
    assert_eq!(recipes[2].condition_axis_ids, Vec::<String>::new());
    assert_eq!(
        recipes[2].location_axis_ids,
        vec!["axis_stemWidth".to_string()]
    );
    assert_eq!(recipes[2].variation_source_count, 0);
    assert!(!recipes[2].varies_transform);
    assert_eq!(
        recipes[2].lowering_hint,
        ShiftComponentLoweringHint::VariableComponent
    );
    assert_eq!(
        recipes[2].required_capabilities,
        vec![ShiftComponentLoweringCapability::VariableLocation]
    );

    assert_eq!(recipes[3].component_id, "component_variable_conditional");
    assert_eq!(
        recipes[3].kind,
        ShiftComponentRecipeKind::ConditionalVariable
    );
    assert_eq!(
        recipes[3].axis_inheritance,
        ShiftAxisInheritance::ResetUnspecifiedToFont
    );
    assert_eq!(recipes[3].condition_axis_ids, vec!["axis_wdth".to_string()]);
    assert_eq!(
        recipes[3].location_axis_ids,
        vec!["axis_stemWidth".to_string()]
    );
    assert_eq!(recipes[3].variation_source_count, 1);
    assert_eq!(
        recipes[3].variation_parent_axis_ids,
        vec!["axis_wght".to_string()]
    );
    assert_eq!(
        recipes[3].variation_location_axis_ids,
        vec!["axis_stemWidth".to_string()]
    );
    assert!(recipes[3].varies_transform);
    assert_eq!(
        recipes[3].lowering_hint,
        ShiftComponentLoweringHint::ConditionalVariableComponent
    );
    assert_eq!(
        recipes[3].required_capabilities,
        vec![
            ShiftComponentLoweringCapability::Condition,
            ShiftComponentLoweringCapability::VariableLocation,
            ShiftComponentLoweringCapability::VariableTransform,
            ShiftComponentLoweringCapability::AxisReset,
        ]
    );
}

#[test]
fn component_recipe_capabilities_distinguish_transform_variation_from_location_variation() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_transform_only".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_black".to_string(),
                name: "Black component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::new(),
                transform: Some(DecomposedTransform {
                    scale_x: 1.2,
                    scale_y: 1.2,
                    ..DecomposedTransform::identity()
                }),
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let recipes = working_source
        .component_recipes("glyph_A", "source_Regular")
        .expect("component recipes should summarize");
    assert_eq!(recipes.len(), 1);
    assert_eq!(recipes[0].kind, ShiftComponentRecipeKind::Variable);
    assert_eq!(recipes[0].variation_source_count, 1);
    assert_eq!(
        recipes[0].variation_parent_axis_ids,
        vec!["axis_wght".to_string()]
    );
    assert_eq!(recipes[0].variation_location_axis_ids, Vec::<String>::new());
    assert!(recipes[0].varies_transform);
    assert_eq!(
        recipes[0].required_capabilities,
        vec![ShiftComponentLoweringCapability::VariableTransform]
    );

    let transform_target = ShiftComponentLoweringTarget::new(vec![
        ShiftComponentLoweringCapability::VariableTransform,
    ]);
    let transform_preflight = working_source.component_lowering_preflight(&transform_target);
    assert_eq!(transform_preflight.supported_component_count, 1);
    assert_eq!(transform_preflight.unsupported_component_count, 0);
    assert_eq!(transform_preflight.diagnostics, Vec::new());

    let location_target =
        ShiftComponentLoweringTarget::new(vec![ShiftComponentLoweringCapability::VariableLocation]);
    let location_preflight = working_source.component_lowering_preflight(&location_target);
    assert_eq!(location_preflight.supported_component_count, 0);
    assert_eq!(location_preflight.unsupported_component_count, 1);
    assert_eq!(
        location_preflight.diagnostics[0].missing_capabilities,
        vec![ShiftComponentLoweringCapability::VariableTransform]
    );
}

#[test]
fn component_recipe_capabilities_ignore_neutral_transform_sources() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_neutral_transform".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform {
                translate_x: 12.0,
                scale_x: 1.2,
                scale_y: 1.2,
                ..DecomposedTransform::identity()
            },
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_neutral".to_string(),
                name: "Neutral transform".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::new(),
                transform: Some(DecomposedTransform {
                    translate_x: 12.0,
                    scale_x: 1.2,
                    scale_y: 1.2,
                    ..DecomposedTransform::identity()
                }),
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let recipes = working_source
        .component_recipes("glyph_A", "source_Regular")
        .expect("component recipes should summarize");
    assert_eq!(recipes.len(), 1);
    assert_eq!(recipes[0].kind, ShiftComponentRecipeKind::Variable);
    assert_eq!(recipes[0].variation_source_count, 1);
    assert_eq!(recipes[0].variation_parent_axis_ids, vec!["axis_wght"]);
    assert!(!recipes[0].varies_transform);
    assert_eq!(
        recipes[0].required_capabilities,
        Vec::<ShiftComponentLoweringCapability>::new()
    );

    let plain_preflight = working_source
        .component_lowering_preflight(&ShiftComponentLoweringTarget::plain_components());
    assert_eq!(plain_preflight.supported_component_count, 1);
    assert_eq!(plain_preflight.unsupported_component_count, 0);
    assert_eq!(plain_preflight.diagnostics, Vec::new());
}

#[test]
fn component_recipe_capabilities_ignore_neutral_location_sources() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_neutral_location".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_neutral".to_string(),
                name: "Neutral location".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                transform: None,
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let recipes = working_source
        .component_recipes("glyph_A", "source_Regular")
        .expect("component recipes should summarize");
    assert_eq!(recipes.len(), 1);
    assert_eq!(recipes[0].kind, ShiftComponentRecipeKind::Variable);
    assert_eq!(recipes[0].variation_source_count, 1);
    assert_eq!(
        recipes[0].variation_location_axis_ids,
        vec!["axis_wght".to_string()]
    );
    assert!(!recipes[0].varies_transform);
    assert_eq!(
        recipes[0].required_capabilities,
        Vec::<ShiftComponentLoweringCapability>::new()
    );

    let plain_preflight = working_source
        .component_lowering_preflight(&ShiftComponentLoweringTarget::plain_components());
    assert_eq!(plain_preflight.supported_component_count, 1);
    assert_eq!(plain_preflight.unsupported_component_count, 0);
    assert_eq!(plain_preflight.diagnostics, Vec::new());
}

#[test]
fn component_recipe_capabilities_use_font_default_for_reset_location_sources() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_reset_location".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::ResetUnspecifiedToFont,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_heavy".to_string(),
                name: "Heavy location".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                transform: None,
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let recipes = working_source
        .component_recipes("glyph_A", "source_Regular")
        .expect("component recipes should summarize");
    assert_eq!(recipes.len(), 1);
    assert_eq!(
        recipes[0].axis_inheritance,
        ShiftAxisInheritance::ResetUnspecifiedToFont
    );
    assert_eq!(
        recipes[0].required_capabilities,
        vec![
            ShiftComponentLoweringCapability::VariableLocation,
            ShiftComponentLoweringCapability::AxisReset,
        ]
    );

    let reset_target =
        ShiftComponentLoweringTarget::new(vec![ShiftComponentLoweringCapability::AxisReset]);
    let reset_preflight = working_source.component_lowering_preflight(&reset_target);
    assert_eq!(reset_preflight.supported_component_count, 0);
    assert_eq!(reset_preflight.unsupported_component_count, 1);
    assert_eq!(
        reset_preflight.diagnostics[0].missing_capabilities,
        vec![ShiftComponentLoweringCapability::VariableLocation]
    );
}

#[test]
fn working_source_creates_axis_mapping_with_generated_id_and_updates_mapping_query() {
    let mut working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis(), internal_stem_axis()],
        Vec::new(),
    ))
    .expect("package is valid");

    let report = working_source
        .create_axis_mapping(ShiftCreateAxisMapping {
            mapping_id: None,
            name: "Weight drives stem".to_string(),
            input_axes: vec!["axis_wght".to_string()],
            output_axes: vec!["axis_stem".to_string()],
            samples: vec![
                ShiftAxisMappingSample {
                    input_location: BTreeMap::from([("axis_wght".to_string(), 100.0)]),
                    output_location: BTreeMap::from([("axis_stem".to_string(), 0.0)]),
                },
                ShiftAxisMappingSample {
                    input_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                    output_location: BTreeMap::from([("axis_stem".to_string(), 1.0)]),
                },
            ],
        })
        .expect("axis mapping creation should succeed");

    assert_eq!(report.revision, 1);
    assert_eq!(report.mapping_id, "mapping_Weight_drives_stem");
    assert_eq!(
        report.diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::UpdateAxisMappings],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["axis-mappings.json".to_string()],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string()],
            },
        }
    );

    let mapped = working_source
        .mapped_location(&BTreeMap::from([("axis_wght".to_string(), 700.0)]))
        .expect("created mapping should be compiled into query views");
    assert_eq!(
        mapped.values.get("axis_stem"),
        Some(&ShiftMappedAxisValue {
            value: 0.75,
            source: ShiftMappedAxisValueSource::AxisMapping,
            mapping_id: Some("mapping_Weight_drives_stem".to_string()),
        })
    );
}

#[test]
fn working_source_create_axis_mapping_uses_new_mapping_for_blank_names() {
    let mut working_source =
        ShiftWorkingSource::new(package_with_weight_to_stem_mapping()).expect("package is valid");

    let report = working_source
        .create_axis_mapping(ShiftCreateAxisMapping {
            mapping_id: None,
            name: "   ".to_string(),
            input_axes: vec!["axis_wght".to_string()],
            output_axes: vec!["axis_stem".to_string()],
            samples: vec![
                ShiftAxisMappingSample {
                    input_location: BTreeMap::from([("axis_wght".to_string(), 100.0)]),
                    output_location: BTreeMap::from([("axis_stem".to_string(), 0.0)]),
                },
                ShiftAxisMappingSample {
                    input_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                    output_location: BTreeMap::from([("axis_stem".to_string(), 0.5)]),
                },
            ],
        })
        .expect("blank mapping name should use fallback");

    assert_eq!(report.revision, 1);
    assert_eq!(report.mapping_id, "mapping_New_Mapping");
    assert_eq!(report.mapping.name, "New Mapping");
}

#[test]
fn working_source_rejects_invalid_axis_mapping_create_without_mutating() {
    let mut working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis(), internal_stem_axis()],
        Vec::new(),
    ))
    .expect("package is valid");

    let error = working_source
        .create_axis_mapping(ShiftCreateAxisMapping {
            mapping_id: Some("mapping_bad".to_string()),
            name: "Bad mapping".to_string(),
            input_axes: vec!["axis_wght".to_string()],
            output_axes: vec!["axis_stem".to_string()],
            samples: Vec::new(),
        })
        .expect_err("empty axis mapping should fail");

    assert!(matches!(
        error,
        ShiftSourceError::EmptyAxisMapping { mapping_id } if mapping_id == "mapping_bad"
    ));
    assert_eq!(working_source.revision(), 0);
    let mapped = working_source
        .mapped_location(&BTreeMap::from([("axis_wght".to_string(), 700.0)]))
        .expect("empty working source should still map defaults");
    assert_eq!(
        mapped.values.get("axis_stem"),
        Some(&ShiftMappedAxisValue {
            value: 0.0,
            source: ShiftMappedAxisValueSource::AxisDefault,
            mapping_id: None,
        })
    );
}

#[test]
fn working_source_create_axis_mapping_disambiguates_duplicate_names() {
    let mut working_source =
        ShiftWorkingSource::new(package_with_weight_to_stem_mapping()).expect("package is valid");

    let report = working_source
        .create_axis_mapping(ShiftCreateAxisMapping {
            mapping_id: Some("mapping_duplicate_name".to_string()),
            name: "Weight drives stem".to_string(),
            input_axes: vec!["axis_wght".to_string()],
            output_axes: vec!["axis_stem".to_string()],
            samples: vec![
                ShiftAxisMappingSample {
                    input_location: BTreeMap::from([("axis_wght".to_string(), 100.0)]),
                    output_location: BTreeMap::from([("axis_stem".to_string(), 0.0)]),
                },
                ShiftAxisMappingSample {
                    input_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                    output_location: BTreeMap::from([("axis_stem".to_string(), 0.5)]),
                },
            ],
        })
        .expect("duplicate mapping names should be disambiguated");

    assert_eq!(report.revision, 1);
    assert_eq!(report.mapping_id, "mapping_duplicate_name");
    assert_eq!(report.mapping.name, "Weight drives stem.1");
    assert_eq!(working_source.package().axis_mappings.len(), 2);
}

#[test]
fn working_source_updates_axis_mapping_and_rebuilds_mapping_query() {
    let mut working_source =
        ShiftWorkingSource::new(package_with_weight_to_stem_mapping()).expect("package is valid");

    let report = working_source
        .update_axis_mapping(
            "mapping_weight_to_stem",
            ShiftAxisMappingUpdate {
                name: "Weight drives narrow stem".to_string(),
                input_axes: vec!["axis_wght".to_string()],
                output_axes: vec!["axis_stem".to_string()],
                samples: vec![
                    ShiftAxisMappingSample {
                        input_location: BTreeMap::from([("axis_wght".to_string(), 100.0)]),
                        output_location: BTreeMap::from([("axis_stem".to_string(), 0.0)]),
                    },
                    ShiftAxisMappingSample {
                        input_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                        output_location: BTreeMap::from([("axis_stem".to_string(), 0.5)]),
                    },
                ],
            },
        )
        .expect("axis mapping update should succeed");

    assert_eq!(report.revision, 1);
    assert_eq!(report.mapping.name, "Weight drives narrow stem");
    let mapped = working_source
        .mapped_location(&BTreeMap::from([("axis_wght".to_string(), 700.0)]))
        .expect("updated mapping should be compiled into query views");
    assert_eq!(
        mapped.values.get("axis_stem"),
        Some(&ShiftMappedAxisValue {
            value: 0.375,
            source: ShiftMappedAxisValueSource::AxisMapping,
            mapping_id: Some("mapping_weight_to_stem".to_string()),
        })
    );
}

#[test]
fn working_source_rejects_blank_axis_mapping_update_without_mutating() {
    let mut working_source =
        ShiftWorkingSource::new(package_with_weight_to_stem_mapping()).expect("package is valid");

    let error = working_source
        .update_axis_mapping(
            "mapping_weight_to_stem",
            ShiftAxisMappingUpdate {
                name: "   ".to_string(),
                input_axes: vec!["axis_wght".to_string()],
                output_axes: vec!["axis_stem".to_string()],
                samples: vec![
                    ShiftAxisMappingSample {
                        input_location: BTreeMap::from([("axis_wght".to_string(), 100.0)]),
                        output_location: BTreeMap::from([("axis_stem".to_string(), 0.0)]),
                    },
                    ShiftAxisMappingSample {
                        input_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                        output_location: BTreeMap::from([("axis_stem".to_string(), 0.5)]),
                    },
                ],
            },
        )
        .expect_err("blank mapping update should fail");

    assert!(matches!(
        error,
        ShiftSourceError::InvalidAxisMappingName { mapping_name } if mapping_name.is_empty()
    ));
    assert_eq!(working_source.revision(), 0);
    assert_eq!(
        working_source
            .package()
            .axis_mappings
            .iter()
            .find(|mapping| mapping.id == "mapping_weight_to_stem")
            .expect("mapping should still exist")
            .name,
        "Weight drives stem"
    );
}

#[test]
fn working_source_deletes_axis_mapping_and_removes_mapping_from_query() {
    let mut working_source =
        ShiftWorkingSource::new(package_with_weight_to_stem_mapping()).expect("package is valid");

    let report = working_source
        .delete_axis_mapping("mapping_weight_to_stem")
        .expect("axis mapping deletion should succeed");

    assert_eq!(report.revision, 1);
    assert_eq!(report.mapping_name, "Weight drives stem");
    assert_eq!(
        report.diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::UpdateAxisMappings],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["axis-mappings.json".to_string()],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string()],
            },
        }
    );

    let mapped = working_source
        .mapped_location(&BTreeMap::from([("axis_wght".to_string(), 700.0)]))
        .expect("mapping query should still resolve without deleted mapping");
    assert_eq!(
        mapped.values.get("axis_stem"),
        Some(&ShiftMappedAxisValue {
            value: 0.0,
            source: ShiftMappedAxisValueSource::AxisDefault,
            mapping_id: None,
        })
    );
}

#[test]
fn working_source_missing_axis_mapping_delete_does_not_mutate() {
    let mut working_source =
        ShiftWorkingSource::new(package_with_weight_to_stem_mapping()).expect("package is valid");

    let error = working_source
        .delete_axis_mapping("mapping_missing")
        .expect_err("missing axis mapping delete should fail");

    assert!(matches!(
        error,
        ShiftSourceError::MissingAxisMapping { mapping_id } if mapping_id == "mapping_missing"
    ));
    assert_eq!(working_source.revision(), 0);
    let mapped = working_source
        .mapped_location(&BTreeMap::from([("axis_wght".to_string(), 700.0)]))
        .expect("existing mapping should still be active");
    assert_eq!(
        mapped.values.get("axis_stem"),
        Some(&ShiftMappedAxisValue {
            value: 0.75,
            source: ShiftMappedAxisValueSource::AxisMapping,
            mapping_id: Some("mapping_weight_to_stem".to_string()),
        })
    );
}

#[test]
fn working_source_reports_component_lowering_diagnostics_for_target_capabilities() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![
            ShiftComponent {
                id: "component_plain".to_string(),
                base_glyph_id: "glyph_stem".to_string(),
                base_glyph_name: "stem".to_string(),
                transform: DecomposedTransform::identity(),
                location: BTreeMap::new(),
                axis_inheritance: ShiftAxisInheritance::InheritParent,
                variation_sources: Vec::new(),
                condition: None,
            },
            ShiftComponent {
                id: "component_conditional".to_string(),
                base_glyph_id: "glyph_stem".to_string(),
                base_glyph_name: "stem".to_string(),
                transform: DecomposedTransform::identity(),
                location: BTreeMap::new(),
                axis_inheritance: ShiftAxisInheritance::InheritParent,
                variation_sources: Vec::new(),
                condition: Some(ShiftCondition::AxisRange {
                    axis_id: "axis_wght".to_string(),
                    min: Some(700.0),
                    max: None,
                }),
            },
            ShiftComponent {
                id: "component_variable".to_string(),
                base_glyph_id: "glyph_stem".to_string(),
                base_glyph_name: "stem".to_string(),
                transform: DecomposedTransform::identity(),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 44.0)]),
                axis_inheritance: ShiftAxisInheritance::InheritParent,
                variation_sources: Vec::new(),
                condition: None,
            },
            ShiftComponent {
                id: "component_variable_conditional".to_string(),
                base_glyph_id: "glyph_stem".to_string(),
                base_glyph_name: "stem".to_string(),
                transform: DecomposedTransform::identity(),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 42.0)]),
                axis_inheritance: ShiftAxisInheritance::ResetUnspecifiedToFont,
                variation_sources: vec![ShiftComponentVariationSource {
                    id: "componentSource_black".to_string(),
                    name: "Black component".to_string(),
                    parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                    location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                    transform: Some(DecomposedTransform {
                        translate_x: 12.0,
                        ..DecomposedTransform::identity()
                    }),
                }],
                condition: Some(ShiftCondition::AxisRange {
                    axis_id: "axis_wdth".to_string(),
                    min: Some(90.0),
                    max: None,
                }),
            },
        ],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis(), width_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let plain_preflight = working_source
        .component_lowering_preflight(&ShiftComponentLoweringTarget::plain_components());
    assert_eq!(plain_preflight.total_component_count, 4);
    assert_eq!(plain_preflight.supported_component_count, 1);
    assert_eq!(plain_preflight.unsupported_component_count, 3);
    assert_eq!(plain_preflight.skipped_inactive_component_count, 0);
    assert_eq!(plain_preflight.affected_glyph_count, 1);
    assert_eq!(
        plain_preflight.missing_capabilities,
        vec![
            ShiftComponentLoweringCapability::Condition,
            ShiftComponentLoweringCapability::VariableLocation,
            ShiftComponentLoweringCapability::VariableTransform,
            ShiftComponentLoweringCapability::AxisReset,
        ]
    );
    assert_eq!(
        plain_preflight.missing_capability_counts,
        vec![
            ShiftComponentLoweringCapabilityCount {
                capability: ShiftComponentLoweringCapability::Condition,
                component_count: 2,
            },
            ShiftComponentLoweringCapabilityCount {
                capability: ShiftComponentLoweringCapability::VariableLocation,
                component_count: 2,
            },
            ShiftComponentLoweringCapabilityCount {
                capability: ShiftComponentLoweringCapability::VariableTransform,
                component_count: 1,
            },
            ShiftComponentLoweringCapabilityCount {
                capability: ShiftComponentLoweringCapability::AxisReset,
                component_count: 1,
            },
        ]
    );
    let plain_diagnostics = plain_preflight.diagnostics;
    assert_eq!(plain_diagnostics.len(), 3);
    assert_eq!(
        plain_diagnostics
            .iter()
            .map(|diagnostic| diagnostic.component_id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "component_conditional",
            "component_variable",
            "component_variable_conditional"
        ]
    );
    assert_eq!(
        plain_diagnostics[2].missing_capabilities,
        vec![
            ShiftComponentLoweringCapability::Condition,
            ShiftComponentLoweringCapability::VariableLocation,
            ShiftComponentLoweringCapability::VariableTransform,
            ShiftComponentLoweringCapability::AxisReset,
        ]
    );

    let partial_target = ShiftComponentLoweringTarget::new(vec![
        ShiftComponentLoweringCapability::Condition,
        ShiftComponentLoweringCapability::VariableLocation,
    ]);
    let partial_preflight = working_source.component_lowering_preflight(&partial_target);
    assert_eq!(partial_preflight.total_component_count, 4);
    assert_eq!(partial_preflight.supported_component_count, 3);
    assert_eq!(partial_preflight.unsupported_component_count, 1);
    assert_eq!(partial_preflight.skipped_inactive_component_count, 0);
    assert_eq!(
        partial_preflight.missing_capabilities,
        vec![
            ShiftComponentLoweringCapability::VariableTransform,
            ShiftComponentLoweringCapability::AxisReset,
        ]
    );
    let partial_diagnostics = partial_preflight.diagnostics;
    assert_eq!(partial_diagnostics.len(), 1);
    assert_eq!(
        partial_diagnostics[0].component_id,
        "component_variable_conditional"
    );
    assert_eq!(
        partial_diagnostics[0].missing_capabilities,
        vec![
            ShiftComponentLoweringCapability::VariableTransform,
            ShiftComponentLoweringCapability::AxisReset,
        ]
    );

    let full_target = ShiftComponentLoweringTarget::all_shift_component_semantics();
    let full_preflight = working_source.component_lowering_preflight(&full_target);
    assert_eq!(full_preflight.total_component_count, 4);
    assert_eq!(full_preflight.supported_component_count, 4);
    assert_eq!(full_preflight.unsupported_component_count, 0);
    assert_eq!(full_preflight.skipped_inactive_component_count, 0);
    assert_eq!(full_preflight.affected_glyph_count, 0);
    assert_eq!(full_preflight.missing_capabilities, Vec::new());
    assert_eq!(full_preflight.diagnostics, Vec::new());

    let static_location_preflight = working_source
        .component_lowering_preflight_at_location(
            &ShiftComponentLoweringTarget::plain_components(),
            &BTreeMap::new(),
        )
        .expect("location preflight should evaluate default conditions");
    assert_eq!(static_location_preflight.total_component_count, 4);
    assert_eq!(static_location_preflight.supported_component_count, 1);
    assert_eq!(static_location_preflight.unsupported_component_count, 2);
    assert_eq!(
        static_location_preflight.skipped_inactive_component_count,
        1
    );
    assert_eq!(
        static_location_preflight.skipped_inactive_components[0].component_id,
        "component_conditional"
    );
    assert_eq!(
        static_location_preflight.skipped_inactive_components[0].condition,
        ShiftConditionEvaluation::AxisRange {
            axis_id: "axis_wght".to_string(),
            value: 400.0,
            min: Some(700.0),
            max: None,
            active: false,
        }
    );
    assert_eq!(
        static_location_preflight
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.component_id.as_str())
            .collect::<Vec<_>>(),
        vec!["component_variable", "component_variable_conditional"]
    );
    assert_eq!(
        static_location_preflight.diagnostics[1].missing_capabilities,
        vec![
            ShiftComponentLoweringCapability::VariableLocation,
            ShiftComponentLoweringCapability::VariableTransform,
            ShiftComponentLoweringCapability::AxisReset,
        ]
    );
    assert_eq!(
        static_location_preflight.diagnostics[1].condition,
        Some(ShiftConditionEvaluation::AxisRange {
            axis_id: "axis_wdth".to_string(),
            value: 100.0,
            min: Some(90.0),
            max: None,
            active: true,
        })
    );

    let static_export_preview = working_source
        .component_static_export_preview("glyph_A", "source_Regular", &BTreeMap::new())
        .expect("static export preview should evaluate default component state");
    assert_eq!(static_export_preview.total_component_count, 4);
    assert_eq!(static_export_preview.preserve_reference_count, 1);
    assert_eq!(static_export_preview.fallback_component_count, 2);
    assert_eq!(static_export_preview.skipped_inactive_component_count, 1);
    assert_eq!(static_export_preview.unsupported_component_count, 0);
    assert_eq!(
        static_export_preview
            .components
            .iter()
            .map(|component| (
                component.component_id.as_str(),
                &component.disposition,
                component.required_capabilities.as_slice()
            ))
            .collect::<Vec<_>>(),
        vec![
            (
                "component_plain",
                &ShiftStaticComponentExportDisposition::PreserveReference,
                &[][..],
            ),
            (
                "component_conditional",
                &ShiftStaticComponentExportDisposition::SkipInactive,
                &[ShiftComponentLoweringCapability::Condition][..],
            ),
            (
                "component_variable",
                &ShiftStaticComponentExportDisposition::RequiresFallback {
                    missing_capabilities: vec![ShiftComponentLoweringCapability::VariableLocation],
                },
                &[ShiftComponentLoweringCapability::VariableLocation][..],
            ),
            (
                "component_variable_conditional",
                &ShiftStaticComponentExportDisposition::RequiresFallback {
                    missing_capabilities: vec![
                        ShiftComponentLoweringCapability::VariableLocation,
                        ShiftComponentLoweringCapability::VariableTransform,
                        ShiftComponentLoweringCapability::AxisReset,
                    ],
                },
                &[
                    ShiftComponentLoweringCapability::VariableLocation,
                    ShiftComponentLoweringCapability::VariableTransform,
                    ShiftComponentLoweringCapability::AxisReset,
                ][..],
            ),
        ]
    );
    assert_eq!(
        static_export_preview.components[3].transform.translate_x,
        0.0
    );

    let black_export_preview = working_source
        .component_static_export_preview(
            "glyph_A",
            "source_Regular",
            &BTreeMap::from([
                ("axis_wght".to_string(), 900.0),
                ("axis_wdth".to_string(), 100.0),
            ]),
        )
        .expect("static export preview should resolve exact component source");
    assert_eq!(
        black_export_preview.components[3].transform.translate_x,
        12.0
    );
    assert_eq!(
        black_export_preview.components[3].variation_resolution,
        ShiftComponentVariationResolution::ExactSource {
            source: crate::ShiftComponentResolvedVariationSource {
                id: "componentSource_black".to_string(),
                name: "Black component".to_string(),
            },
        }
    );

    let narrow_location_preflight = working_source
        .component_lowering_preflight_at_location(
            &ShiftComponentLoweringTarget::plain_components(),
            &BTreeMap::from([
                ("axis_wght".to_string(), 800.0),
                ("axis_wdth".to_string(), 50.0),
            ]),
        )
        .expect("location preflight should evaluate explicit conditions");
    assert_eq!(narrow_location_preflight.total_component_count, 4);
    assert_eq!(narrow_location_preflight.supported_component_count, 2);
    assert_eq!(narrow_location_preflight.unsupported_component_count, 1);
    assert_eq!(
        narrow_location_preflight.skipped_inactive_component_count,
        1
    );
    assert_eq!(
        narrow_location_preflight.skipped_inactive_components[0].component_id,
        "component_variable_conditional"
    );
    assert_eq!(
        narrow_location_preflight.skipped_inactive_components[0].required_capabilities,
        vec![
            ShiftComponentLoweringCapability::Condition,
            ShiftComponentLoweringCapability::VariableLocation,
            ShiftComponentLoweringCapability::VariableTransform,
            ShiftComponentLoweringCapability::AxisReset,
        ]
    );
    assert_eq!(
        narrow_location_preflight
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.component_id.as_str())
            .collect::<Vec<_>>(),
        vec!["component_variable"]
    );
    assert_eq!(
        narrow_location_preflight.diagnostics[0].missing_capabilities,
        vec![ShiftComponentLoweringCapability::VariableLocation]
    );
    assert_eq!(
        narrow_location_preflight.skipped_inactive_components[0].condition,
        ShiftConditionEvaluation::AxisRange {
            axis_id: "axis_wdth".to_string(),
            value: 50.0,
            min: Some(90.0),
            max: None,
            active: false,
        }
    );
    assert_eq!(narrow_location_preflight.diagnostics[0].condition, None);

    let narrow_export_preview = working_source
        .component_static_export_preview(
            "glyph_A",
            "source_Regular",
            &BTreeMap::from([
                ("axis_wght".to_string(), 800.0),
                ("axis_wdth".to_string(), 50.0),
            ]),
        )
        .expect("static export preview should evaluate explicit component state");
    assert_eq!(narrow_export_preview.preserve_reference_count, 2);
    assert_eq!(narrow_export_preview.fallback_component_count, 1);
    assert_eq!(narrow_export_preview.skipped_inactive_component_count, 1);
    assert_eq!(narrow_export_preview.unsupported_component_count, 0);
    assert_eq!(
        narrow_export_preview.components[1].disposition,
        ShiftStaticComponentExportDisposition::PreserveReference
    );
    assert_eq!(
        narrow_export_preview.components[3].disposition,
        ShiftStaticComponentExportDisposition::SkipInactive
    );

    let contextual_preflight = working_source
        .component_lowering_preflight_with_context(
            &ShiftComponentLoweringTarget::plain_components(),
            &ShiftComponentResolveContext {
                font_location: BTreeMap::from([
                    ("axis_wght".to_string(), 800.0),
                    ("axis_wdth".to_string(), 50.0),
                ]),
                parent_location: BTreeMap::from([
                    ("axis_wght".to_string(), 100.0),
                    ("axis_wdth".to_string(), 100.0),
                ]),
            },
        )
        .expect("contextual preflight should evaluate font-location conditions");
    assert_eq!(contextual_preflight.total_component_count, 4);
    assert_eq!(contextual_preflight.supported_component_count, 2);
    assert_eq!(contextual_preflight.unsupported_component_count, 1);
    assert_eq!(contextual_preflight.skipped_inactive_component_count, 1);
    assert_eq!(
        contextual_preflight.skipped_inactive_components[0].component_id,
        "component_variable_conditional"
    );
    assert_eq!(
        contextual_preflight
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.component_id.as_str())
            .collect::<Vec<_>>(),
        vec!["component_variable"]
    );

    let missing_axis_err = working_source
        .component_lowering_preflight_at_location(
            &ShiftComponentLoweringTarget::plain_components(),
            &BTreeMap::from([("axis_missing".to_string(), 1.0)]),
        )
        .expect_err("preflight location should reject missing axes");
    assert!(matches!(
        missing_axis_err,
        ShiftSourceError::MissingQueryLocationAxis { context, axis_id }
            if context == "component lowering preflight" && axis_id == "axis_missing"
    ));
    let preview_missing_axis_err = working_source
        .component_static_export_preview(
            "glyph_A",
            "source_Regular",
            &BTreeMap::from([("axis_missing".to_string(), 1.0)]),
        )
        .expect_err("static export preview should reject missing axes");
    assert!(matches!(
        preview_missing_axis_err,
        ShiftSourceError::MissingQueryLocationAxis { context, axis_id }
            if context == "component static export preview font location"
                && axis_id == "axis_missing"
    ));

    let out_of_range_err = working_source
        .component_lowering_preflight_at_location(
            &ShiftComponentLoweringTarget::plain_components(),
            &BTreeMap::from([("axis_wght".to_string(), 1000.0)]),
        )
        .expect_err("preflight location should reject out-of-range axes");
    assert!(matches!(
        out_of_range_err,
        ShiftSourceError::AxisCoordinateOutOfRange {
            context,
            axis_id,
            value,
            minimum: 100.0,
            maximum: 900.0,
        } if context == "component lowering preflight"
            && axis_id == "axis_wght"
            && value == 1000.0
    ));

    let non_finite_err = working_source
        .component_lowering_preflight_at_location(
            &ShiftComponentLoweringTarget::plain_components(),
            &BTreeMap::from([("axis_wght".to_string(), f64::NAN)]),
        )
        .expect_err("preflight location should reject non-finite axes");
    assert!(matches!(
        non_finite_err,
        ShiftSourceError::NonFiniteNumber {
            context,
            field,
            value,
        } if context == "component lowering preflight"
            && field == "axis_wght"
            && value.is_nan()
    ));
}

#[test]
fn working_source_resolves_exact_component_variation_source_state() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_7".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 40.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_black".to_string(),
                name: "Black component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                transform: Some(DecomposedTransform {
                    translate_x: 12.0,
                    scale_x: 1.2,
                    scale_y: 1.2,
                    ..DecomposedTransform::identity()
                }),
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let default_state = working_source
        .component_resolved_states(
            "glyph_A",
            "source_Regular",
            &BTreeMap::from([("axis_wght".to_string(), 400.0)]),
        )
        .expect("default component state should resolve");
    assert_eq!(default_state[0].variation_source, None);
    assert_eq!(default_state[0].transform, DecomposedTransform::identity());
    assert_eq!(
        default_state[0].values.get("axis_stemWidth"),
        Some(&ShiftResolvedAxisValue {
            value: 40.0,
            source: ShiftResolvedAxisValueSource::ComponentOverride,
        })
    );

    let black_state = working_source
        .component_resolved_states(
            "glyph_A",
            "source_Regular",
            &BTreeMap::from([("axis_wght".to_string(), 900.0)]),
        )
        .expect("variation component state should resolve");
    assert_eq!(
        black_state[0]
            .variation_source
            .as_ref()
            .map(|source| source.id.as_str()),
        Some("componentSource_black")
    );
    assert_eq!(black_state[0].transform.translate_x, 12.0);
    assert_eq!(
        black_state[0].values.get("axis_stemWidth"),
        Some(&ShiftResolvedAxisValue {
            value: 72.0,
            source: ShiftResolvedAxisValueSource::ComponentVariationSource,
        })
    );
    assert!(matches!(
        &black_state[0].variation_resolution,
        ShiftComponentVariationResolution::ExactSource { source }
            if source.id == "componentSource_black"
    ));
}

#[test]
fn working_source_reports_authored_component_variation_source_locations() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_7_sources".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform {
                translate_x: 3.0,
                ..DecomposedTransform::identity()
            },
            location: BTreeMap::from([("axis_stemWidth".to_string(), 40.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![
                ShiftComponentVariationSource {
                    id: "componentSource_light".to_string(),
                    name: "Light component".to_string(),
                    parent_location: BTreeMap::from([("axis_wght".to_string(), 100.0)]),
                    location: BTreeMap::new(),
                    transform: None,
                },
                ShiftComponentVariationSource {
                    id: "componentSource_black".to_string(),
                    name: "Black component".to_string(),
                    parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                    location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                    transform: Some(DecomposedTransform {
                        translate_x: 12.0,
                        scale_x: 1.2,
                        scale_y: 1.2,
                        ..DecomposedTransform::identity()
                    }),
                },
            ],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis(), width_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let sources = working_source
        .component_variation_source_locations("glyph_A", "source_Regular", "component_7_sources")
        .expect("component variation source locations should resolve");

    assert_eq!(sources.len(), 2);
    assert_eq!(sources[0].source_id, "componentSource_light");
    assert_eq!(
        sources[0].parent_values.get("axis_wght"),
        Some(&ShiftComponentVariationParentAxisValue {
            value: 100.0,
            source: ShiftComponentVariationParentAxisValueSource::VariationSourceParentLocation,
        })
    );
    assert_eq!(
        sources[0].parent_values.get("axis_wdth"),
        Some(&ShiftComponentVariationParentAxisValue {
            value: 100.0,
            source: ShiftComponentVariationParentAxisValueSource::AxisDefault,
        })
    );
    assert_eq!(
        sources[0].values.get("axis_wght"),
        Some(&ShiftResolvedAxisValue {
            value: 100.0,
            source: ShiftResolvedAxisValueSource::ParentLocation,
        })
    );
    assert_eq!(
        sources[0].values.get("axis_stemWidth"),
        Some(&ShiftResolvedAxisValue {
            value: 40.0,
            source: ShiftResolvedAxisValueSource::ComponentOverride,
        })
    );
    assert_eq!(sources[0].transform.translate_x, 3.0);
    assert_eq!(
        sources[0].transform_source,
        ShiftComponentVariationTransformSource::BaseComponent
    );

    assert_eq!(sources[1].source_id, "componentSource_black");
    assert_eq!(
        sources[1].values.get("axis_stemWidth"),
        Some(&ShiftResolvedAxisValue {
            value: 72.0,
            source: ShiftResolvedAxisValueSource::ComponentVariationSource,
        })
    );
    assert_eq!(sources[1].transform.translate_x, 12.0);
    assert_eq!(
        sources[1].transform_source,
        ShiftComponentVariationTransformSource::ComponentVariationSource
    );
}

#[test]
fn working_source_creates_component_variation_source_with_generated_id_and_narrow_impact() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_7_create".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 40.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_Black_component".to_string(),
                name: "Black component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                transform: Some(DecomposedTransform {
                    translate_x: 12.0,
                    scale_x: 1.2,
                    scale_y: 1.2,
                    ..DecomposedTransform::identity()
                }),
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let mut working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let report = working_source
        .create_component_variation_source(
            "glyph_A",
            "source_Regular",
            "component_7_create",
            ShiftCreateComponentVariationSource {
                source_id: None,
                name: "Black component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 800.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 68.0)]),
                transform: Some(DecomposedTransform {
                    translate_x: 10.0,
                    scale_x: 1.15,
                    scale_y: 1.15,
                    ..DecomposedTransform::identity()
                }),
            },
        )
        .expect("component variation source creation should succeed");

    assert_eq!(report.revision, 1);
    assert_eq!(report.source_id, "componentSource_Black_component_1");
    assert_eq!(report.source.source_name, "Black component.1");
    assert_eq!(
        report.source.parent_values.get("axis_wght"),
        Some(&ShiftComponentVariationParentAxisValue {
            value: 800.0,
            source: ShiftComponentVariationParentAxisValueSource::VariationSourceParentLocation,
        })
    );
    assert_eq!(
        report.source.values.get("axis_stemWidth"),
        Some(&ShiftResolvedAxisValue {
            value: 68.0,
            source: ShiftResolvedAxisValueSource::ComponentVariationSource,
        })
    );
    assert_eq!(
        report.diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::UpdateGlyph {
                glyph_id: "glyph_A".to_string(),
            }],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["glyphs/glyph_A.json".to_string()],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![
                    DEPENDENCY_INDEX_PATH.to_string(),
                    INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
                ],
            },
        }
    );
}

#[test]
fn working_source_create_component_variation_source_uses_fallback_for_blank_names() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_7_blank_create".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 40.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: Vec::new(),
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let mut working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let report = working_source
        .create_component_variation_source(
            "glyph_A",
            "source_Regular",
            "component_7_blank_create",
            ShiftCreateComponentVariationSource {
                source_id: None,
                name: "   ".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 800.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 68.0)]),
                transform: None,
            },
        )
        .expect("blank component variation source name should use fallback");

    assert_eq!(report.revision, 1);
    assert_eq!(report.source_id, "componentSource_New_Component_Source");
    assert_eq!(report.source.source_name, "New Component Source");
}

#[test]
fn working_source_rejects_invalid_component_variation_source_create_without_mutating() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_7_invalid_create".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 40.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: Vec::new(),
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let mut working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let error = working_source
        .create_component_variation_source(
            "glyph_A",
            "source_Regular",
            "component_7_invalid_create",
            ShiftCreateComponentVariationSource {
                source_id: Some("componentSource_default".to_string()),
                name: "Default component".to_string(),
                parent_location: BTreeMap::new(),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 68.0)]),
                transform: None,
            },
        )
        .expect_err("default parent location component source should fail");

    assert!(matches!(
        error,
        ShiftSourceError::ComponentVariationSourceAtDefaultParentLocation {
            glyph_name,
            base_glyph_id,
            source_id,
        } if glyph_name == "A"
            && base_glyph_id == "glyph_stem"
            && source_id == "componentSource_default"
    ));
    assert_eq!(working_source.revision(), 0);

    let sources = working_source
        .component_variation_source_locations(
            "glyph_A",
            "source_Regular",
            "component_7_invalid_create",
        )
        .expect("component variation source locations should still resolve");
    assert!(sources.is_empty());
}

#[test]
fn working_source_deletes_component_variation_source_with_narrow_impact() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_7_delete".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 40.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_black".to_string(),
                name: "Black component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                transform: None,
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let mut working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let report = working_source
        .delete_component_variation_source(
            "glyph_A",
            "source_Regular",
            "component_7_delete",
            "componentSource_black",
        )
        .expect("component variation source deletion should succeed");

    assert_eq!(report.revision, 1);
    assert_eq!(report.source_id, "componentSource_black");
    assert_eq!(report.source_name, "Black component");
    assert_eq!(
        report.diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::UpdateGlyph {
                glyph_id: "glyph_A".to_string(),
            }],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["glyphs/glyph_A.json".to_string()],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![
                    DEPENDENCY_INDEX_PATH.to_string(),
                    INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
                ],
            },
        }
    );
    assert!(working_source
        .component_variation_source_locations("glyph_A", "source_Regular", "component_7_delete",)
        .expect("component variation source locations should still resolve")
        .is_empty());
}

#[test]
fn working_source_missing_component_variation_source_delete_does_not_mutate() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_7_missing_delete".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_black".to_string(),
                name: "Black component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::new(),
                transform: None,
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let mut working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let error = working_source
        .delete_component_variation_source(
            "glyph_A",
            "source_Regular",
            "component_7_missing_delete",
            "componentSource_missing",
        )
        .expect_err("missing component variation source delete should fail");

    assert!(matches!(
        error,
        ShiftSourceError::MissingComponentVariationSource {
            glyph_id,
            layer_id,
            component_id,
            source_id,
        } if glyph_id == "glyph_A"
            && layer_id == "source_Regular"
            && component_id == "component_7_missing_delete"
            && source_id == "componentSource_missing"
    ));
    assert_eq!(working_source.revision(), 0);
    let sources = working_source
        .component_variation_source_locations(
            "glyph_A",
            "source_Regular",
            "component_7_missing_delete",
        )
        .expect("component variation source locations should still resolve");
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].source_id, "componentSource_black");
}

#[test]
fn working_source_updates_component_variation_source_with_narrow_impact() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_7_update".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 40.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_black".to_string(),
                name: "Black component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                transform: Some(DecomposedTransform {
                    translate_x: 12.0,
                    scale_x: 1.2,
                    scale_y: 1.2,
                    ..DecomposedTransform::identity()
                }),
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let mut working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let report = working_source
        .update_component_variation_source(
            "glyph_A",
            "source_Regular",
            "component_7_update",
            "componentSource_black",
            ShiftComponentVariationSourceUpdate {
                name: "Bold component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 800.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 68.0)]),
                transform: Some(DecomposedTransform {
                    translate_x: 10.0,
                    scale_x: 1.15,
                    scale_y: 1.15,
                    ..DecomposedTransform::identity()
                }),
            },
        )
        .expect("component variation source update should succeed");

    assert_eq!(report.revision, 1);
    assert_eq!(report.source.source_name, "Bold component");
    assert_eq!(
        report.source.parent_values.get("axis_wght"),
        Some(&ShiftComponentVariationParentAxisValue {
            value: 800.0,
            source: ShiftComponentVariationParentAxisValueSource::VariationSourceParentLocation,
        })
    );
    assert_eq!(
        report.source.values.get("axis_stemWidth"),
        Some(&ShiftResolvedAxisValue {
            value: 68.0,
            source: ShiftResolvedAxisValueSource::ComponentVariationSource,
        })
    );
    assert_eq!(
        report.diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::UpdateGlyph {
                glyph_id: "glyph_A".to_string(),
            }],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["glyphs/glyph_A.json".to_string()],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![
                    DEPENDENCY_INDEX_PATH.to_string(),
                    INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
                ],
            },
        }
    );

    let exact_state = working_source
        .component_resolved_states(
            "glyph_A",
            "source_Regular",
            &BTreeMap::from([("axis_wght".to_string(), 800.0)]),
        )
        .expect("updated component variation source should resolve");
    assert!(matches!(
        &exact_state[0].variation_resolution,
        ShiftComponentVariationResolution::ExactSource { source }
            if source.id == "componentSource_black" && source.name == "Bold component"
    ));
}

#[test]
fn working_source_component_variation_source_no_op_does_not_advance_revision() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_7_no_op".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 40.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_black".to_string(),
                name: "Black component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                transform: Some(DecomposedTransform {
                    translate_x: 12.0,
                    scale_x: 1.2,
                    scale_y: 1.2,
                    ..DecomposedTransform::identity()
                }),
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let mut working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let report = working_source
        .update_component_variation_source(
            "glyph_A",
            "source_Regular",
            "component_7_no_op",
            "componentSource_black",
            ShiftComponentVariationSourceUpdate {
                name: "Black component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                transform: Some(DecomposedTransform {
                    translate_x: 12.0,
                    scale_x: 1.2,
                    scale_y: 1.2,
                    ..DecomposedTransform::identity()
                }),
            },
        )
        .expect("unchanged component variation source update should succeed");

    assert_eq!(report.revision, 0);
    assert!(report.diff.changes.is_empty());
    assert!(report.diff.impact.package_relative_paths().is_empty());
    assert_eq!(working_source.revision(), 0);
}

#[test]
fn working_source_rejects_blank_component_variation_source_update_without_mutating() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_7_blank_update".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 40.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_black".to_string(),
                name: "Black component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                transform: None,
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let mut working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let error = working_source
        .update_component_variation_source(
            "glyph_A",
            "source_Regular",
            "component_7_blank_update",
            "componentSource_black",
            ShiftComponentVariationSourceUpdate {
                name: "   ".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                transform: None,
            },
        )
        .expect_err("blank component variation source update should fail");

    assert!(matches!(
        error,
        ShiftSourceError::InvalidComponentVariationSourceName {
            glyph_name,
            base_glyph_id,
            source_name,
        } if glyph_name == "A" && base_glyph_id == "glyph_stem" && source_name.is_empty()
    ));
    assert_eq!(working_source.revision(), 0);
    let sources = working_source
        .component_variation_source_locations(
            "glyph_A",
            "source_Regular",
            "component_7_blank_update",
        )
        .expect("component variation source locations should still resolve");
    assert_eq!(sources[0].source_name, "Black component");
}

#[test]
fn working_source_rejects_invalid_component_variation_source_update_without_mutating() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_7_invalid_update".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![
                ShiftComponentVariationSource {
                    id: "componentSource_light".to_string(),
                    name: "Light component".to_string(),
                    parent_location: BTreeMap::from([("axis_wght".to_string(), 100.0)]),
                    location: BTreeMap::new(),
                    transform: None,
                },
                ShiftComponentVariationSource {
                    id: "componentSource_black".to_string(),
                    name: "Black component".to_string(),
                    parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                    location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                    transform: None,
                },
            ],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let mut working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let error = working_source
        .update_component_variation_source(
            "glyph_A",
            "source_Regular",
            "component_7_invalid_update",
            "componentSource_light",
            ShiftComponentVariationSourceUpdate {
                name: "Duplicate location".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::new(),
                transform: None,
            },
        )
        .expect_err("duplicate parent location should fail");

    assert!(matches!(
        error,
        ShiftSourceError::DuplicateComponentVariationParentLocation {
            glyph_name,
            base_glyph_id,
            source_id,
            existing_source_id,
        } if glyph_name == "A"
            && base_glyph_id == "glyph_stem"
            && source_id == "componentSource_black"
            && existing_source_id == "componentSource_light"
    ));
    assert_eq!(working_source.revision(), 0);

    let sources = working_source
        .component_variation_source_locations(
            "glyph_A",
            "source_Regular",
            "component_7_invalid_update",
        )
        .expect("component variation source locations should still resolve");
    assert_eq!(sources[0].source_name, "Light component");
    assert_eq!(
        sources[0].parent_values.get("axis_wght"),
        Some(&ShiftComponentVariationParentAxisValue {
            value: 100.0,
            source: ShiftComponentVariationParentAxisValueSource::VariationSourceParentLocation,
        })
    );
}

#[test]
fn source_package_keeps_component_variation_sources_separate_from_ir_projection() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_8".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 40.0)]),
            axis_inheritance: ShiftAxisInheritance::ResetUnspecifiedToFont,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_black".to_string(),
                name: "Black component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                transform: Some(DecomposedTransform {
                    translate_x: 12.0,
                    scale_x: 1.2,
                    scale_y: 1.2,
                    ..DecomposedTransform::identity()
                }),
            }],
            condition: Some(ShiftCondition::AxisRange {
                axis_id: "axis_wght".to_string(),
                min: Some(700.0),
                max: None,
            }),
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let package = package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    );

    let font = package
        .clone()
        .into_font()
        .expect("package should project to IR");
    let projected_base = font.glyph("stem").expect("base glyph should project");
    assert_eq!(
        projected_base.local_axes(),
        &[GlyphAxis::new(
            AxisId::from_stable("axis_stemWidth").unwrap(),
            "Stem Width".to_string(),
            20.0,
            40.0,
            80.0,
        )]
    );
    let projected_component = font
        .glyph("A")
        .expect("owner glyph should project")
        .layer(font.default_layer_id())
        .expect("owner layer should project")
        .components_iter()
        .next()
        .expect("component should project");

    assert_eq!(projected_component.base_glyph().as_str(), "stem");
    assert_eq!(
        projected_component.transform(),
        &DecomposedTransform::identity()
    );
    assert_eq!(
        projected_component.axis_inheritance(),
        AxisInheritance::ResetUnspecifiedToFont
    );
    assert_eq!(
        projected_component
            .location()
            .get(&AxisId::from_stable("axis_stemWidth").unwrap()),
        Some(40.0)
    );
    assert!(matches!(
        projected_component.condition(),
        Some(ComponentCondition::AxisRange {
            axis_id,
            min: Some(700.0),
            max: None,
        }) if axis_id.as_str() == "axis_wght"
    ));

    let working_source =
        ShiftWorkingSource::new(package).expect("working source should initialize");
    let resolved = working_source
        .component_resolved_states(
            "glyph_A",
            "source_Regular",
            &BTreeMap::from([("axis_wght".to_string(), 900.0)]),
        )
        .expect("source-aware component state should resolve");

    assert_eq!(
        resolved[0].axis_inheritance,
        ShiftAxisInheritance::ResetUnspecifiedToFont
    );
    assert_eq!(
        resolved[0]
            .variation_source
            .as_ref()
            .map(|source| source.id.as_str()),
        Some("componentSource_black")
    );
    assert_eq!(resolved[0].transform.translate_x, 12.0);
    assert_eq!(
        resolved[0].values.get("axis_stemWidth"),
        Some(&ShiftResolvedAxisValue {
            value: 72.0,
            source: ShiftResolvedAxisValueSource::ComponentVariationSource,
        })
    );
}

#[test]
fn working_source_skips_variation_resolution_for_inactive_conditional_components() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_8_inactive".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 40.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_black".to_string(),
                name: "Black component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                transform: Some(DecomposedTransform {
                    translate_x: 12.0,
                    scale_x: 1.2,
                    scale_y: 1.2,
                    ..DecomposedTransform::identity()
                }),
            }],
            condition: Some(ShiftCondition::AxisRange {
                axis_id: "axis_wght".to_string(),
                min: Some(700.0),
                max: None,
            }),
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");

    let inactive_location = working_source
        .component_resolved_locations(
            "glyph_A",
            "source_Regular",
            &BTreeMap::from([("axis_wght".to_string(), 400.0)]),
        )
        .expect("inactive component location should resolve");
    assert!(!inactive_location[0].active);
    assert_eq!(
        inactive_location[0].condition,
        Some(ShiftConditionEvaluation::AxisRange {
            axis_id: "axis_wght".to_string(),
            value: 400.0,
            min: Some(700.0),
            max: None,
            active: false,
        })
    );

    let inactive_state = working_source
        .component_resolved_states(
            "glyph_A",
            "source_Regular",
            &BTreeMap::from([("axis_wght".to_string(), 400.0)]),
        )
        .expect("inactive component state should resolve");

    assert!(!inactive_state[0].active);
    assert_eq!(
        inactive_state[0].condition,
        Some(ShiftConditionEvaluation::AxisRange {
            axis_id: "axis_wght".to_string(),
            value: 400.0,
            min: Some(700.0),
            max: None,
            active: false,
        })
    );
    assert_eq!(
        inactive_state[0].variation_resolution,
        ShiftComponentVariationResolution::Inactive
    );
    assert_eq!(inactive_state[0].variation_source, None);
    assert_eq!(inactive_state[0].transform, DecomposedTransform::identity());
    assert_eq!(
        inactive_state[0].values.get("axis_stemWidth"),
        Some(&ShiftResolvedAxisValue {
            value: 40.0,
            source: ShiftResolvedAxisValueSource::ComponentOverride,
        })
    );
}

#[test]
fn working_source_interpolates_component_variation_state_with_variation_model() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_9".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 40.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_black".to_string(),
                name: "Black component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                transform: Some(DecomposedTransform {
                    translate_x: 12.0,
                    scale_x: 1.2,
                    scale_y: 1.2,
                    ..DecomposedTransform::identity()
                }),
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");
    assert_eq!(
        working_source.compiled_component_variation_resolver_count(),
        1
    );

    let mid_state = working_source
        .component_resolved_states(
            "glyph_A",
            "source_Regular",
            &BTreeMap::from([("axis_wght".to_string(), 650.0)]),
        )
        .expect("interpolated component state should resolve");

    assert_eq!(mid_state[0].variation_source, None);
    assert!(matches!(
        mid_state[0].variation_resolution,
        ShiftComponentVariationResolution::Interpolated { source_count: 2 }
    ));
    assert!((mid_state[0].transform.translate_x - 6.0).abs() < 1e-10);
    assert!((mid_state[0].transform.scale_x - 1.1).abs() < 1e-10);
    assert_eq!(
        mid_state[0].values.get("axis_stemWidth"),
        Some(&ShiftResolvedAxisValue {
            value: 56.0,
            source: ShiftResolvedAxisValueSource::ComponentVariationSource,
        })
    );
}

#[test]
fn working_source_rebuilds_component_variation_resolvers_after_refresh() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_9_refresh".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 40.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_black".to_string(),
                name: "Black component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                transform: Some(DecomposedTransform {
                    translate_x: 12.0,
                    scale_x: 1.2,
                    scale_y: 1.2,
                    ..DecomposedTransform::identity()
                }),
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let mut working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    ))
    .expect("working source should initialize");
    assert_eq!(
        working_source.compiled_component_variation_resolver_count(),
        1
    );

    working_source
        .rename_glyph("glyph_A", "A.alt".to_string())
        .expect("rename should refresh working-source indexes");

    assert_eq!(
        working_source.compiled_component_variation_resolver_count(),
        1
    );
    let resolved = working_source
        .component_resolved_states(
            "glyph_A",
            "source_Regular",
            &BTreeMap::from([("axis_wght".to_string(), 900.0)]),
        )
        .expect("component state should still resolve after refresh");
    assert!(matches!(
        &resolved[0].variation_resolution,
        ShiftComponentVariationResolution::ExactSource { source }
            if source.id == "componentSource_black"
    ));
}

#[test]
fn working_source_preserves_dynamic_inherited_global_component_variation_values() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_9_dynamic".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_black".to_string(),
                name: "Black component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                transform: None,
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer(component_layer),
    ))
    .expect("working source should initialize");
    assert_eq!(
        working_source.compiled_component_variation_resolver_count(),
        1
    );

    let resolved = working_source
        .component_resolved_states(
            "glyph_A",
            "source_Regular",
            &BTreeMap::from([("axis_wght".to_string(), 650.0)]),
        )
        .expect("dynamic inherited global component state should resolve");

    assert!(matches!(
        resolved[0].variation_resolution,
        ShiftComponentVariationResolution::Interpolated { source_count: 2 }
    ));
    assert_eq!(
        resolved[0].values.get("axis_wght"),
        Some(&ShiftResolvedAxisValue {
            value: 775.0,
            source: ShiftResolvedAxisValueSource::ComponentVariationSource,
        })
    );
}

#[test]
fn working_source_deletes_leaf_glyph_with_narrow_impact() {
    let mut working_source = ShiftWorkingSource::new(package_with_component_dependency())
        .expect("working source should initialize");

    let report = working_source
        .delete_glyph("glyph_Aacute")
        .expect("leaf glyph delete should succeed");

    assert_eq!(report.glyph_name, "Aacute");
    assert_eq!(report.revision, 1);
    assert_eq!(
        report.diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::DeleteGlyph {
                glyph_id: "glyph_Aacute".to_string(),
            }],
            impact: ShiftWriteImpact {
                canonical_paths: Vec::new(),
                removed_canonical_paths: vec!["glyphs/glyph_Aacute.json".to_string()],
                derived_paths: vec![
                    DEPENDENCY_INDEX_PATH.to_string(),
                    INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
                ],
            },
        }
    );
    assert!(!working_source
        .package()
        .glyphs
        .iter()
        .any(|glyph| glyph.id == "glyph_Aacute"));
    assert!(matches!(
        working_source.glyph_dependencies("glyph_Aacute"),
        Err(ShiftSourceError::MissingGlyph { glyph_id }) if glyph_id == "glyph_Aacute"
    ));
}

#[test]
fn working_source_refuses_to_delete_glyph_with_component_dependents() {
    let mut working_source = ShiftWorkingSource::new(package_with_component_dependency())
        .expect("working source should initialize");

    let err = working_source
        .delete_glyph("glyph_A")
        .expect_err("used glyph delete should be refused");

    assert!(matches!(
        err,
        ShiftSourceError::GlyphHasComponentDependents {
            glyph_id,
            dependent_count: 1,
        } if glyph_id == "glyph_A"
    ));
    assert_eq!(working_source.revision(), 0);
    assert!(working_source
        .package()
        .glyphs
        .iter()
        .any(|glyph| glyph.id == "glyph_A"));
    assert!(working_source
        .package()
        .glyphs
        .iter()
        .any(|glyph| glyph.id == "glyph_Aacute"));
}

#[test]
fn working_source_deletes_glyph_and_removes_component_references() {
    let mut working_source = ShiftWorkingSource::new(package_with_component_dependency())
        .expect("working source should initialize");

    let report = working_source
        .delete_glyph_and_remove_component_references("glyph_A")
        .expect("delete with component removal should succeed");

    assert_eq!(report.glyph_id, "glyph_A");
    assert_eq!(report.glyph_name, "A");
    assert_eq!(report.revision, 1);
    assert_eq!(report.removed_component_recipes.len(), 1);
    let removed_recipe = &report.removed_component_recipes[0];
    assert_eq!(removed_recipe.glyph_id, "glyph_Aacute");
    assert_eq!(removed_recipe.glyph_name, "Aacute");
    assert_eq!(removed_recipe.layer_id, "source_Regular");
    assert_eq!(removed_recipe.component_id, "component_25");
    assert_eq!(removed_recipe.base_glyph_id, "glyph_A");
    assert_eq!(removed_recipe.base_glyph_name, "A");
    assert_eq!(removed_recipe.kind, ShiftComponentRecipeKind::Static);
    assert_eq!(removed_recipe.variation_source_count, 0);
    assert!(removed_recipe.required_capabilities.is_empty());
    assert_eq!(
        report.diff,
        ShiftPackageDiff {
            changes: vec![
                ShiftPackageChange::DeleteGlyph {
                    glyph_id: "glyph_A".to_string(),
                },
                ShiftPackageChange::UpdateGlyph {
                    glyph_id: "glyph_Aacute".to_string(),
                },
            ],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["glyphs/glyph_Aacute.json".to_string()],
                removed_canonical_paths: vec!["glyphs/glyph_A.json".to_string()],
                derived_paths: vec![
                    DEPENDENCY_INDEX_PATH.to_string(),
                    INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
                ],
            },
        }
    );
    assert!(!working_source
        .package()
        .glyphs
        .iter()
        .any(|glyph| glyph.id == "glyph_A"));
    let dependent = working_source
        .package()
        .glyphs
        .iter()
        .find(|glyph| glyph.id == "glyph_Aacute")
        .expect("dependent glyph should remain");
    assert!(dependent
        .layers
        .get("source_Regular")
        .expect("dependent layer should remain")
        .components
        .is_empty());
    assert_eq!(
        working_source
            .glyph_dependencies("glyph_Aacute")
            .expect("dependent dependency index should rebuild")
            .component_dependencies,
        Vec::<ShiftComponentUse>::new()
    );
}

#[test]
fn working_source_previews_component_removal_delete_without_mutating() {
    let working_source = ShiftWorkingSource::new(package_with_component_dependency())
        .expect("working source should initialize");

    let preview = working_source
        .preview_delete_glyph_remove_component_references("glyph_A")
        .expect("component-removal delete preview should succeed");

    assert_eq!(preview.glyph_id, "glyph_A");
    assert_eq!(preview.glyph_name, "A");
    assert_eq!(
        preview.component_dependents,
        vec![ShiftComponentUse {
            glyph_id: "glyph_Aacute".to_string(),
            glyph_name: "Aacute".to_string(),
            layer_id: "source_Regular".to_string(),
            component_id: "component_25".to_string(),
        }]
    );
    assert_eq!(preview.removed_component_recipes.len(), 1);
    assert_eq!(
        preview.removed_component_recipes[0].base_glyph_id,
        "glyph_A"
    );
    assert_eq!(
        preview.diff,
        ShiftPackageDiff {
            changes: vec![
                ShiftPackageChange::DeleteGlyph {
                    glyph_id: "glyph_A".to_string(),
                },
                ShiftPackageChange::UpdateGlyph {
                    glyph_id: "glyph_Aacute".to_string(),
                },
            ],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["glyphs/glyph_Aacute.json".to_string()],
                removed_canonical_paths: vec!["glyphs/glyph_A.json".to_string()],
                derived_paths: vec![
                    DEPENDENCY_INDEX_PATH.to_string(),
                    INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
                ],
            },
        }
    );
    assert_eq!(working_source.revision(), 0);
    assert_eq!(
        working_source
            .package()
            .glyphs
            .iter()
            .find(|glyph| glyph.id == "glyph_Aacute")
            .expect("dependent glyph should remain")
            .layers
            .get("source_Regular")
            .expect("dependent layer should remain")
            .components
            .len(),
        1
    );
    assert!(working_source
        .package()
        .glyphs
        .iter()
        .any(|glyph| glyph.id == "glyph_A"));
}

#[test]
fn working_source_delete_with_component_removal_allows_leaf_glyphs() {
    let mut working_source = ShiftWorkingSource::new(package_with_component_dependency())
        .expect("working source should initialize");

    let report = working_source
        .delete_glyph_and_remove_component_references("glyph_Aacute")
        .expect("leaf delete through component-removal command should succeed");

    assert_eq!(report.glyph_id, "glyph_Aacute");
    assert_eq!(report.glyph_name, "Aacute");
    assert!(report.removed_component_recipes.is_empty());
    assert_eq!(
        report.diff.changes,
        vec![ShiftPackageChange::DeleteGlyph {
            glyph_id: "glyph_Aacute".to_string(),
        }]
    );
    assert!(!working_source
        .package()
        .glyphs
        .iter()
        .any(|glyph| glyph.id == "glyph_Aacute"));
}

#[test]
fn working_source_deletes_glyph_and_relinks_component_references() {
    let mut package = package_with_component_dependency();
    package.glyphs.push(ShiftGlyph {
        id: "glyph_B".to_string(),
        name: "B".to_string(),
        unicodes: vec!["0042".to_string()],
        local_axes: Vec::new(),
        variation_sources: Vec::new(),
        layers: BTreeMap::new(),
    });
    let mut working_source =
        ShiftWorkingSource::new(package).expect("working source should initialize");

    let report = working_source
        .delete_glyph_and_relink_component_references("glyph_A", "glyph_B")
        .expect("delete with component relink should succeed");

    assert_eq!(report.glyph_id, "glyph_A");
    assert_eq!(report.glyph_name, "A");
    assert_eq!(report.replacement_glyph_id, "glyph_B");
    assert_eq!(report.replacement_glyph_name, "B");
    assert_eq!(report.revision, 1);
    assert_eq!(report.relinked_component_recipes.len(), 1);
    let relinked_recipe = &report.relinked_component_recipes[0];
    assert_eq!(relinked_recipe.glyph_id, "glyph_Aacute");
    assert_eq!(relinked_recipe.component_id, "component_25");
    assert_eq!(relinked_recipe.base_glyph_id, "glyph_B");
    assert_eq!(relinked_recipe.base_glyph_name, "B");
    assert_eq!(relinked_recipe.kind, ShiftComponentRecipeKind::Static);
    assert_eq!(
        report.diff,
        ShiftPackageDiff {
            changes: vec![
                ShiftPackageChange::DeleteGlyph {
                    glyph_id: "glyph_A".to_string(),
                },
                ShiftPackageChange::UpdateGlyph {
                    glyph_id: "glyph_Aacute".to_string(),
                },
            ],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["glyphs/glyph_Aacute.json".to_string()],
                removed_canonical_paths: vec!["glyphs/glyph_A.json".to_string()],
                derived_paths: vec![
                    DEPENDENCY_INDEX_PATH.to_string(),
                    INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
                ],
            },
        }
    );
    assert!(!working_source
        .package()
        .glyphs
        .iter()
        .any(|glyph| glyph.id == "glyph_A"));
    let relinked_component = &working_source
        .package()
        .glyphs
        .iter()
        .find(|glyph| glyph.id == "glyph_Aacute")
        .expect("dependent glyph should remain")
        .layers
        .get("source_Regular")
        .expect("dependent layer should remain")
        .components[0];
    assert_eq!(relinked_component.base_glyph_id, "glyph_B");
    assert_eq!(relinked_component.base_glyph_name, "B");
    assert_eq!(
        working_source
            .glyph_dependencies("glyph_B")
            .expect("replacement glyph dependency index should rebuild")
            .component_dependents,
        vec![ShiftComponentUse {
            glyph_id: "glyph_Aacute".to_string(),
            glyph_name: "Aacute".to_string(),
            layer_id: "source_Regular".to_string(),
            component_id: "component_25".to_string(),
        }]
    );
}

#[test]
fn working_source_previews_relink_delete_without_mutating() {
    let mut package = package_with_component_dependency();
    package.glyphs.push(ShiftGlyph {
        id: "glyph_B".to_string(),
        name: "B".to_string(),
        unicodes: vec!["0042".to_string()],
        local_axes: Vec::new(),
        variation_sources: Vec::new(),
        layers: BTreeMap::new(),
    });
    let working_source =
        ShiftWorkingSource::new(package).expect("working source should initialize");

    let preview = working_source
        .preview_delete_glyph_relink_component_references("glyph_A", "glyph_B")
        .expect("relink delete preview should succeed");

    assert_eq!(preview.glyph_id, "glyph_A");
    assert_eq!(preview.glyph_name, "A");
    assert_eq!(preview.replacement_glyph_id, "glyph_B");
    assert_eq!(preview.replacement_glyph_name, "B");
    assert_eq!(
        preview.component_dependents,
        vec![ShiftComponentUse {
            glyph_id: "glyph_Aacute".to_string(),
            glyph_name: "Aacute".to_string(),
            layer_id: "source_Regular".to_string(),
            component_id: "component_25".to_string(),
        }]
    );
    assert_eq!(preview.relinked_component_recipes.len(), 1);
    assert_eq!(
        preview.relinked_component_recipes[0].base_glyph_id,
        "glyph_B"
    );
    assert_eq!(
        preview.diff,
        ShiftPackageDiff {
            changes: vec![
                ShiftPackageChange::DeleteGlyph {
                    glyph_id: "glyph_A".to_string(),
                },
                ShiftPackageChange::UpdateGlyph {
                    glyph_id: "glyph_Aacute".to_string(),
                },
            ],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["glyphs/glyph_Aacute.json".to_string()],
                removed_canonical_paths: vec!["glyphs/glyph_A.json".to_string()],
                derived_paths: vec![
                    DEPENDENCY_INDEX_PATH.to_string(),
                    INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
                ],
            },
        }
    );
    assert_eq!(working_source.revision(), 0);
    assert_eq!(
        working_source
            .package()
            .glyphs
            .iter()
            .find(|glyph| glyph.id == "glyph_Aacute")
            .expect("dependent glyph should remain")
            .layers
            .get("source_Regular")
            .expect("dependent layer should remain")
            .components[0]
            .base_glyph_id,
        "glyph_A"
    );
}

#[test]
fn working_source_lists_relink_replacement_candidates_with_cycle_blockers() {
    let mut package = package_with_component_dependency();
    package.glyphs.push(ShiftGlyph {
        id: "glyph_B".to_string(),
        name: "B".to_string(),
        unicodes: Vec::new(),
        local_axes: Vec::new(),
        variation_sources: Vec::new(),
        layers: BTreeMap::new(),
    });
    let working_source =
        ShiftWorkingSource::new(package).expect("working source should initialize");

    let candidates = working_source
        .glyph_relink_replacement_candidates("glyph_A")
        .expect("relink candidates should be listed");

    assert_eq!(candidates.len(), 2);
    let dependent_candidate = candidates
        .iter()
        .find(|candidate| candidate.glyph_id == "glyph_Aacute")
        .expect("dependent glyph should be listed as blocked");
    assert!(!dependent_candidate.can_relink);
    assert_eq!(
        dependent_candidate.blockers,
        vec![
            ShiftGlyphRelinkReplacementBlocker::WouldCreateComponentCycle {
                dependent_glyph_ids: vec!["glyph_Aacute".to_string()],
            }
        ]
    );
    let replacement_candidate = candidates
        .iter()
        .find(|candidate| candidate.glyph_id == "glyph_B")
        .expect("independent replacement should be listed");
    assert!(replacement_candidate.can_relink);
    assert!(replacement_candidate.blockers.is_empty());
}

#[test]
fn working_source_lists_relink_replacement_candidates_with_transitive_cycle_blockers() {
    let mut package = package_with_component_dependency();
    package.glyphs.push(ShiftGlyph {
        id: "glyph_B".to_string(),
        name: "B".to_string(),
        unicodes: Vec::new(),
        local_axes: Vec::new(),
        variation_sources: Vec::new(),
        layers: BTreeMap::from([(
            "source_Regular".to_string(),
            layer_with_component("glyph_Aacute", "Aacute"),
        )]),
    });
    package.glyphs.push(ShiftGlyph {
        id: "glyph_C".to_string(),
        name: "C".to_string(),
        unicodes: Vec::new(),
        local_axes: Vec::new(),
        variation_sources: Vec::new(),
        layers: BTreeMap::new(),
    });
    let working_source =
        ShiftWorkingSource::new(package).expect("working source should initialize");

    let candidates = working_source
        .glyph_relink_replacement_candidates("glyph_A")
        .expect("relink candidates should be listed");

    assert_eq!(
        candidates
            .iter()
            .map(|candidate| candidate.glyph_name.as_str())
            .collect::<Vec<_>>(),
        vec!["Aacute", "B", "C"]
    );
    let transitive_candidate = candidates
        .iter()
        .find(|candidate| candidate.glyph_id == "glyph_B")
        .expect("transitive dependent glyph should be listed as blocked");
    assert!(!transitive_candidate.can_relink);
    assert_eq!(
        transitive_candidate.blockers,
        vec![
            ShiftGlyphRelinkReplacementBlocker::WouldCreateComponentCycle {
                dependent_glyph_ids: vec!["glyph_Aacute".to_string()],
            }
        ]
    );
    let independent_candidate = candidates
        .iter()
        .find(|candidate| candidate.glyph_id == "glyph_C")
        .expect("independent glyph should be listed");
    assert!(independent_candidate.can_relink);
    assert!(independent_candidate.blockers.is_empty());
}

#[test]
fn working_source_lists_relink_replacement_candidates_with_local_axis_blockers() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_local_axis_relink".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 42.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_wide".to_string(),
                name: "Wide".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                transform: None,
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let mut glyphs = glyphs_for_component_layer_with_local_base(component_layer);
    glyphs.push(ShiftGlyph {
        id: "glyph_bar".to_string(),
        name: "bar".to_string(),
        unicodes: Vec::new(),
        local_axes: Vec::new(),
        variation_sources: Vec::new(),
        layers: BTreeMap::new(),
    });
    glyphs.push(ShiftGlyph {
        id: "glyph_narrowStem".to_string(),
        name: "narrowStem".to_string(),
        unicodes: Vec::new(),
        local_axes: vec![ShiftGlyphAxis {
            id: "axis_stemWidth".to_string(),
            name: "Stem Width".to_string(),
            minimum: 20.0,
            default: 30.0,
            maximum: 50.0,
        }],
        variation_sources: Vec::new(),
        layers: BTreeMap::new(),
    });
    glyphs.push(ShiftGlyph {
        id: "glyph_compatibleStem".to_string(),
        name: "compatibleStem".to_string(),
        unicodes: Vec::new(),
        local_axes: vec![ShiftGlyphAxis {
            id: "axis_stemWidth".to_string(),
            name: "Stem Width".to_string(),
            minimum: 20.0,
            default: 40.0,
            maximum: 80.0,
        }],
        variation_sources: Vec::new(),
        layers: BTreeMap::new(),
    });
    let working_source = ShiftWorkingSource::new(package_with_axes(vec![weight_axis()], glyphs))
        .expect("working source should initialize");

    let candidates = working_source
        .glyph_relink_replacement_candidates("glyph_stem")
        .expect("relink candidates should be listed");

    let missing_axis_candidate = candidates
        .iter()
        .find(|candidate| candidate.glyph_id == "glyph_bar")
        .expect("axisless replacement should be listed");
    assert!(!missing_axis_candidate.can_relink);
    assert_eq!(
        missing_axis_candidate.blockers,
        vec![ShiftGlyphRelinkReplacementBlocker::MissingBaseLocalAxes {
            axis_ids: vec!["axis_stemWidth".to_string()],
        }]
    );

    let narrow_candidate = candidates
        .iter()
        .find(|candidate| candidate.glyph_id == "glyph_narrowStem")
        .expect("narrow replacement should be listed");
    assert!(!narrow_candidate.can_relink);
    assert_eq!(
        narrow_candidate.blockers,
        vec![
            ShiftGlyphRelinkReplacementBlocker::BaseLocalAxisOutOfRange {
                axis_id: "axis_stemWidth".to_string(),
                value: 72.0,
                minimum: 20.0,
                maximum: 50.0,
            }
        ]
    );

    let compatible_candidate = candidates
        .iter()
        .find(|candidate| candidate.glyph_id == "glyph_compatibleStem")
        .expect("compatible replacement should be listed");
    assert!(compatible_candidate.can_relink);
    assert!(compatible_candidate.blockers.is_empty());
}

#[test]
fn working_source_relink_delete_preserves_variable_component_recipe() {
    let layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_variable_relink".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_wght".to_string(), 650.0)]),
            axis_inheritance: ShiftAxisInheritance::ResetUnspecifiedToFont,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_heavy".to_string(),
                name: "Heavy".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_wght".to_string(), 800.0)]),
                transform: Some(DecomposedTransform {
                    translate_x: 12.0,
                    translate_y: 0.0,
                    rotation: 0.0,
                    scale_x: 1.0,
                    scale_y: 1.0,
                    skew_x: 0.0,
                    skew_y: 0.0,
                    t_center_x: 0.0,
                    t_center_y: 0.0,
                }),
            }],
            condition: Some(ShiftCondition::AxisRange {
                axis_id: "axis_wght".to_string(),
                min: Some(500.0),
                max: None,
            }),
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let mut glyphs = glyphs_for_component_layer(layer);
    glyphs.push(ShiftGlyph {
        id: "glyph_bar".to_string(),
        name: "bar".to_string(),
        unicodes: Vec::new(),
        local_axes: Vec::new(),
        variation_sources: Vec::new(),
        layers: BTreeMap::new(),
    });
    let mut working_source =
        ShiftWorkingSource::new(package_with_axes(vec![weight_axis()], glyphs))
            .expect("working source should initialize");

    let report = working_source
        .delete_glyph_and_relink_component_references("glyph_stem", "glyph_bar")
        .expect("delete with variable component relink should succeed");

    assert_eq!(report.relinked_component_recipes.len(), 1);
    assert_eq!(
        report.relinked_component_recipes[0],
        ShiftComponentRecipeSummary {
            glyph_id: "glyph_A".to_string(),
            glyph_name: "A".to_string(),
            layer_id: "source_Regular".to_string(),
            component_id: "component_variable_relink".to_string(),
            base_glyph_id: "glyph_bar".to_string(),
            base_glyph_name: "bar".to_string(),
            kind: ShiftComponentRecipeKind::ConditionalVariable,
            axis_inheritance: ShiftAxisInheritance::ResetUnspecifiedToFont,
            condition_axis_ids: vec!["axis_wght".to_string()],
            location_axis_ids: vec!["axis_wght".to_string()],
            variation_source_count: 1,
            variation_parent_axis_ids: vec!["axis_wght".to_string()],
            variation_location_axis_ids: vec!["axis_wght".to_string()],
            varies_transform: true,
            lowering_hint: ShiftComponentLoweringHint::ConditionalVariableComponent,
            required_capabilities: vec![
                ShiftComponentLoweringCapability::Condition,
                ShiftComponentLoweringCapability::VariableLocation,
                ShiftComponentLoweringCapability::VariableTransform,
                ShiftComponentLoweringCapability::AxisReset,
            ],
        }
    );
}

#[test]
fn working_source_relink_delete_rejects_deleted_glyph_as_replacement() {
    let mut package = package_with_component_dependency();
    package.glyphs.push(ShiftGlyph {
        id: "glyph_B".to_string(),
        name: "B".to_string(),
        unicodes: vec!["0042".to_string()],
        local_axes: Vec::new(),
        variation_sources: Vec::new(),
        layers: BTreeMap::new(),
    });
    let mut working_source =
        ShiftWorkingSource::new(package).expect("working source should initialize");

    let err = working_source
        .delete_glyph_and_relink_component_references("glyph_A", "glyph_A")
        .expect_err("relinking to the deleted glyph should fail");

    assert!(matches!(
        err,
        ShiftSourceError::CannotRelinkDeletedGlyphToItself { glyph_id } if glyph_id == "glyph_A"
    ));
    assert_eq!(working_source.revision(), 0);
    assert!(working_source
        .package()
        .glyphs
        .iter()
        .any(|glyph| glyph.id == "glyph_A"));
}

#[test]
fn working_source_relink_delete_rejects_component_cycles_without_mutating() {
    let mut working_source = ShiftWorkingSource::new(package_with_component_dependency())
        .expect("working source should initialize");

    let err = working_source
        .delete_glyph_and_relink_component_references("glyph_A", "glyph_Aacute")
        .expect_err("relinking a dependent component to its owner should fail");

    assert!(matches!(
        err,
        ShiftSourceError::ComponentCycle { path }
            if path == vec!["glyph_Aacute".to_string(), "glyph_Aacute".to_string()]
    ));
    assert_eq!(working_source.revision(), 0);
    assert_eq!(
        working_source
            .package()
            .glyphs
            .iter()
            .find(|glyph| glyph.id == "glyph_Aacute")
            .expect("dependent glyph should remain")
            .layers
            .get("source_Regular")
            .expect("dependent layer should remain")
            .components[0]
            .base_glyph_id,
        "glyph_A"
    );
    assert!(working_source
        .package()
        .glyphs
        .iter()
        .any(|glyph| glyph.id == "glyph_A"));
}

#[test]
fn working_source_relink_delete_rejects_missing_replacement_local_axes_without_mutating() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_local_axis_relink".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 42.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: Vec::new(),
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let mut glyphs = glyphs_for_component_layer_with_local_base(component_layer);
    glyphs.push(ShiftGlyph {
        id: "glyph_bar".to_string(),
        name: "bar".to_string(),
        unicodes: Vec::new(),
        local_axes: Vec::new(),
        variation_sources: Vec::new(),
        layers: BTreeMap::new(),
    });
    let mut working_source = ShiftWorkingSource::new(package_with_single_source(glyphs))
        .expect("working source should initialize");

    let err = working_source
        .delete_glyph_and_relink_component_references("glyph_stem", "glyph_bar")
        .expect_err("relinking to a base without required local axes should fail");

    assert!(matches!(
        err,
        ShiftSourceError::MissingComponentLocationAxis {
            glyph_name,
            base_glyph_id,
            axis_id
        } if glyph_name == "A" && base_glyph_id == "glyph_bar" && axis_id == "axis_stemWidth"
    ));
    assert_eq!(working_source.revision(), 0);
    assert_eq!(
        working_source
            .package()
            .glyphs
            .iter()
            .find(|glyph| glyph.id == "glyph_A")
            .expect("dependent glyph should remain")
            .layers
            .get("source_Regular")
            .expect("dependent layer should remain")
            .components[0]
            .base_glyph_id,
        "glyph_stem"
    );
    assert!(working_source
        .package()
        .glyphs
        .iter()
        .any(|glyph| glyph.id == "glyph_stem"));
}

#[test]
fn stable_glyph_id_keeps_file_path_across_rename() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let mut package = package_with_single_source(vec![ShiftGlyph {
        id: "glyph_A".to_string(),
        name: "A".to_string(),
        unicodes: vec!["0041".to_string()],
        local_axes: Vec::new(),
        variation_sources: Vec::new(),
        layers: BTreeMap::new(),
    }]);

    save_package(&package, &package_path).expect("initial package should save");
    package.glyphs[0].name = "RenamedBase".to_string();
    save_package(&package, &package_path).expect("renamed package should save");

    let glyph_path = package_path.join("glyphs").join("glyph_A.json");
    let renamed_path = package_path.join("glyphs").join("glyph_RenamedBase.json");
    let glyph_json = fs::read_to_string(glyph_path).expect("glyph file should be readable");

    assert!(!renamed_path.exists());
    assert!(glyph_json.contains("\"name\": \"RenamedBase\""));
}

#[test]
fn glyph_name_can_change_without_changing_component_target_id() {
    let layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_10".to_string(),
            base_glyph_id: "glyph_A".to_string(),
            base_glyph_name: "RenamedBase".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: Vec::new(),
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };

    let package = ShiftPackage {
        manifest: ShiftManifest {
            format: SHIFT_SOURCE_FORMAT.to_string(),
            version: SHIFT_SOURCE_VERSION,
            family_id: "family_Spike_Sans".to_string(),
            default_source_id: Some("source_Regular".to_string()),
        },
        font: ShiftFontInfo {
            metadata: FontMetadata::with_names("Spike Sans".to_string(), "Regular".to_string()),
            metrics: FontMetrics::default(),
        },
        axes: Vec::new(),
        sources: vec![ShiftSource {
            id: "source_Regular".to_string(),
            name: "Regular".to_string(),
            location: BTreeMap::new(),
        }],
        axis_mappings: Vec::new(),
        glyphs: vec![
            ShiftGlyph {
                id: "glyph_A".to_string(),
                name: "RenamedBase".to_string(),
                unicodes: vec!["0041".to_string()],
                local_axes: Vec::new(),
                variation_sources: Vec::new(),
                layers: BTreeMap::new(),
            },
            ShiftGlyph {
                id: "glyph_Aacute".to_string(),
                name: "Aacute".to_string(),
                unicodes: vec!["00C1".to_string()],
                local_axes: Vec::new(),
                variation_sources: Vec::new(),
                layers: BTreeMap::from([("source_Regular".to_string(), layer)]),
            },
        ],
    };

    let font = package.into_font().expect("package should load");
    let component_base = font
        .glyph("Aacute")
        .and_then(|glyph| {
            font.default_source()
                .and_then(|source| glyph.layer(source.layer_id()))
        })
        .and_then(|layer| layer.components_iter().next())
        .map(|component| component.base_glyph().to_string());

    assert_eq!(component_base.as_deref(), Some("RenamedBase"));
}

#[test]
fn package_rejects_stale_component_base_glyph_name_cache() {
    let mut package = package_with_component_dependency();
    package
        .glyphs
        .iter_mut()
        .find(|glyph| glyph.id == "glyph_A")
        .expect("base glyph should exist")
        .name = "RenamedBase".to_string();

    let error = package
        .validate()
        .expect_err("stale component base glyph name cache should fail");

    assert!(matches!(
        error,
        ShiftSourceError::ComponentBaseNameMismatch {
            glyph_name,
            base_glyph_id,
            expected_base_glyph_name,
            actual_base_glyph_name,
        } if glyph_name == "Aacute"
            && base_glyph_id == "glyph_A"
            && expected_base_glyph_name == "RenamedBase"
            && actual_base_glyph_name == "A"
    ));
}

#[test]
fn package_rejects_missing_component_base_id() {
    let layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_11".to_string(),
            base_glyph_id: "glyph_Missing".to_string(),
            base_glyph_name: "Missing".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: Vec::new(),
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let package = package_with_single_source(vec![ShiftGlyph {
        id: "glyph_Aacute".to_string(),
        name: "Aacute".to_string(),
        unicodes: Vec::new(),
        local_axes: Vec::new(),
        variation_sources: Vec::new(),
        layers: BTreeMap::from([("source_Regular".to_string(), layer)]),
    }]);

    let error = package.into_font().expect_err("missing base should fail");

    assert!(matches!(
        error,
        ShiftSourceError::MissingComponentBase {
            glyph_name,
            base_glyph_id
        } if glyph_name == "Aacute" && base_glyph_id == "glyph_Missing"
    ));
}

#[test]
fn package_rejects_duplicate_component_ids_in_a_layer() {
    let mut package = package_with_component_dependency();
    let layer = package.glyphs[1]
        .layers
        .get_mut("source_Regular")
        .expect("fixture should contain component layer");
    let duplicate = layer.components[0].clone();
    layer.components.push(duplicate);

    let error = package
        .validate()
        .expect_err("duplicate component id should fail");

    assert!(matches!(
        error,
        ShiftSourceError::DuplicateComponentId {
            glyph_name,
            layer_id,
            component_id
        } if glyph_name == "Aacute"
            && layer_id == "source_Regular"
            && component_id == "component_25"
    ));
}

#[test]
fn package_rejects_layers_for_missing_source_ids() {
    let package = package_with_single_source(vec![ShiftGlyph {
        id: "glyph_A".to_string(),
        name: "A".to_string(),
        unicodes: Vec::new(),
        local_axes: Vec::new(),
        variation_sources: Vec::new(),
        layers: BTreeMap::from([(
            "source_Missing".to_string(),
            ShiftGlyphLayer {
                advance_width: 600.0,
                advance_height: None,
                contours: Vec::new(),
                components: Vec::new(),
                anchors: Vec::new(),
                guidelines: Vec::new(),
            },
        )]),
    }]);

    let error = package.into_font().expect_err("missing source should fail");

    assert!(matches!(
        error,
        ShiftSourceError::MissingSourceLayer {
            glyph_name,
            source_id
        } if glyph_name == "A" && source_id == "source_Missing"
    ));
}

#[test]
fn package_requires_a_valid_default_source() {
    let mut empty_sources = package_with_single_source(Vec::new());
    empty_sources.sources = Vec::new();
    let empty_error = empty_sources
        .validate()
        .expect_err("package without sources should fail");

    assert!(matches!(empty_error, ShiftSourceError::EmptySources));

    let mut missing_default_id = package_with_single_source(Vec::new());
    missing_default_id.manifest.default_source_id = None;
    let missing_id_error = missing_default_id
        .validate()
        .expect_err("package without default source id should fail");

    assert!(matches!(
        missing_id_error,
        ShiftSourceError::MissingDefaultSourceId
    ));

    let mut stale_default_id = package_with_single_source(Vec::new());
    stale_default_id.manifest.default_source_id = Some("source_Missing".to_string());
    let stale_id_error = stale_default_id
        .validate()
        .expect_err("stale default source id should fail");

    assert!(matches!(
        stale_id_error,
        ShiftSourceError::MissingDefaultSource { source_id }
            if source_id == "source_Missing"
    ));

    let mut non_default_location = package_with_axes(vec![weight_axis()], Vec::new());
    non_default_location.sources[0]
        .location
        .insert("axis_wght".to_string(), 700.0);
    let non_default_location_error = non_default_location
        .validate()
        .expect_err("default source away from axis default should fail");

    assert!(matches!(
        non_default_location_error,
        ShiftSourceError::DefaultSourceLocationNotAtAxisDefault {
            source_id,
            axis_id,
            value: 700.0,
            default: 400.0,
        } if source_id == "source_Regular" && axis_id == "axis_wght"
    ));
}

#[test]
fn package_rejects_blank_and_duplicate_source_names() {
    let mut blank_name = package_with_single_source(Vec::new());
    blank_name.sources[0].name = "   ".to_string();
    let error = blank_name
        .validate()
        .expect_err("blank source names should fail validation");
    assert!(matches!(
        error,
        ShiftSourceError::InvalidSourceName { source_name } if source_name == "   "
    ));

    let mut duplicate_name = package_with_axes(vec![weight_axis()], Vec::new());
    duplicate_name.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Regular".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let error = duplicate_name
        .validate()
        .expect_err("duplicate source names should fail validation");
    assert!(matches!(
        error,
        ShiftSourceError::DuplicateSourceName { source_name } if source_name == "Regular"
    ));
}

#[test]
fn package_rejects_invalid_unicode_values() {
    for invalid_unicode in ["not-hex", "D800", "110000"] {
        let package = package_with_single_source(vec![ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: vec![invalid_unicode.to_string()],
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        }]);

        let error = package
            .into_font()
            .expect_err("invalid unicode should fail");

        assert!(matches!(
            error,
            ShiftSourceError::InvalidUnicode { glyph_name, value }
                if glyph_name == "A" && value == invalid_unicode
        ));
    }
}

#[test]
fn package_rejects_duplicate_unicode_ownership() {
    let package = package_with_single_source(vec![
        ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: vec!["0041".to_string()],
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
        ShiftGlyph {
            id: "glyph_A_alt".to_string(),
            name: "A.alt".to_string(),
            unicodes: vec!["41".to_string()],
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
    ]);

    let error = package
        .validate()
        .expect_err("duplicate unicode ownership should fail validation");

    assert!(matches!(
        error,
        ShiftSourceError::DuplicateUnicode {
            value,
            glyph_name,
            existing_glyph_name,
        } if value == "0041" && glyph_name == "A.alt" && existing_glyph_name == "A"
    ));
}

#[test]
fn package_rejects_blank_glyph_names_before_ir_projection() {
    let package = package_with_single_source(vec![ShiftGlyph {
        id: "glyph_blank".to_string(),
        name: "   ".to_string(),
        unicodes: Vec::new(),
        local_axes: Vec::new(),
        variation_sources: Vec::new(),
        layers: BTreeMap::new(),
    }]);

    let error = package
        .validate()
        .expect_err("blank glyph names should fail before IR conversion can panic");

    assert!(matches!(
        error,
        ShiftSourceError::InvalidGlyphName { glyph_name } if glyph_name == "   "
    ));
}

#[test]
fn package_rejects_duplicate_glyph_ids_and_names() {
    let duplicate_ids = package_with_single_source(vec![
        ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
        ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A.alt".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
    ]);
    let duplicate_names = package_with_single_source(vec![
        ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
        ShiftGlyph {
            id: "glyph_A_alt".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
    ]);

    assert!(matches!(
        duplicate_ids.validate(),
        Err(ShiftSourceError::DuplicateGlyphId { glyph_id }) if glyph_id == "glyph_A"
    ));
    assert!(matches!(
        duplicate_names.validate(),
        Err(ShiftSourceError::DuplicateGlyphName { glyph_name }) if glyph_name == "A"
    ));
}

#[test]
fn package_rejects_non_finite_numbers_before_save_or_export() {
    let mut invalid_metrics = package_with_component_dependency();
    invalid_metrics.font.metrics.units_per_em = f64::INFINITY;

    let error = invalid_metrics
        .validate()
        .expect_err("non-finite metrics should fail validation");

    assert!(matches!(
        error,
        ShiftSourceError::NonFiniteNumber {
            context,
            field,
            value,
        } if context == "font metrics" && field == "unitsPerEm" && value.is_infinite()
    ));

    let mut invalid_geometry = package_with_component_dependency();
    invalid_geometry
        .glyphs
        .iter_mut()
        .find(|glyph| glyph.id == "glyph_Aacute")
        .expect("dependent glyph should exist")
        .layers
        .get_mut("source_Regular")
        .expect("regular layer should exist")
        .advance_width = f64::NAN;

    let error = invalid_geometry
        .validate()
        .expect_err("non-finite layer geometry should fail validation");

    assert!(matches!(
        error,
        ShiftSourceError::NonFiniteNumber {
            context,
            field,
            value,
        } if context == "glyph 'Aacute' layer 'source_Regular'"
            && field == "advanceWidth"
            && value.is_nan()
    ));

    let mut invalid_transform = package_with_component_dependency();
    invalid_transform
        .glyphs
        .iter_mut()
        .find(|glyph| glyph.id == "glyph_Aacute")
        .expect("dependent glyph should exist")
        .layers
        .get_mut("source_Regular")
        .expect("regular layer should exist")
        .components[0]
        .transform
        .rotation = f64::NAN;
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let error = save_package(&invalid_transform, temp_dir.path())
        .expect_err("non-finite component transforms should be rejected before writing");

    assert!(matches!(
        error,
        ShiftSourceError::NonFiniteNumber {
            context,
            field,
            value,
        } if context == "component on glyph 'Aacute' layer 'source_Regular' targeting 'glyph_A'"
            && field == "rotation"
            && value.is_nan()
    ));
}

#[test]
fn package_rejects_path_like_stable_ids_before_file_writes() {
    let mut package = package_with_component_dependency();
    package.glyphs[0].id = "../glyph_escape".to_string();

    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let error = save_package(&package, temp_dir.path())
        .expect_err("path-like glyph ids should fail before writing glyph files");

    assert!(matches!(
        error,
        ShiftSourceError::InvalidIdentifier {
            context,
            identifier
        } if context == "glyph 'A'" && identifier == "../glyph_escape"
    ));
    assert!(!temp_dir.path().join("glyphs").exists());
}

#[test]
fn package_rejects_invalid_axis_tags_before_variation_queries() {
    let mut package = package_with_axes(vec![weight_axis()], Vec::new());
    package.axes[0].tag = "weight".to_string();

    let error = package
        .validate()
        .expect_err("axis tags must be valid 4-character variable-font tags");

    assert!(matches!(
        error,
        ShiftSourceError::InvalidAxisTag { axis_tag } if axis_tag == "weight"
    ));

    package.axes[0].tag = "w gt".to_string();
    let error = package
        .validate()
        .expect_err("axis tags with spaces should fail before interpolation");

    assert!(matches!(
        error,
        ShiftSourceError::InvalidAxisTag { axis_tag } if axis_tag == "w gt"
    ));
}

#[test]
fn package_rejects_blank_and_duplicate_axis_names() {
    let mut blank_name = package_with_axes(vec![weight_axis()], Vec::new());
    blank_name.axes[0].name = "   ".to_string();
    let error = blank_name
        .validate()
        .expect_err("blank axis names should fail validation");
    assert!(matches!(
        error,
        ShiftSourceError::InvalidAxisName { axis_name } if axis_name == "   "
    ));

    let mut duplicate_name = package_with_axes(vec![weight_axis(), width_axis()], Vec::new());
    duplicate_name.axes[1].name = "Weight".to_string();
    let error = duplicate_name
        .validate()
        .expect_err("duplicate axis names should fail validation");
    assert!(matches!(
        error,
        ShiftSourceError::DuplicateAxisName { axis_name } if axis_name == "Weight"
    ));
}

#[test]
fn variable_component_location_can_reference_global_and_base_local_axes() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_12".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([
                ("axis_wght".to_string(), 700.0),
                ("axis_stemWidth".to_string(), 42.0),
            ]),
            axis_inheritance: ShiftAxisInheritance::ResetUnspecifiedToFont,
            variation_sources: Vec::new(),
            condition: Some(ShiftCondition::AxisRange {
                axis_id: "axis_wght".to_string(),
                min: Some(600.0),
                max: None,
            }),
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };

    let package = package_with_axes(
        vec![ShiftAxis {
            id: "axis_wght".to_string(),
            tag: "wght".to_string(),
            name: "Weight".to_string(),
            minimum: 100.0,
            default: 400.0,
            maximum: 900.0,
            hidden: false,
            role: ShiftAxisRole::UserFacing,
        }],
        vec![
            ShiftGlyph {
                id: "glyph_A".to_string(),
                name: "A".to_string(),
                unicodes: vec!["0041".to_string()],
                local_axes: Vec::new(),
                variation_sources: Vec::new(),
                layers: BTreeMap::from([("source_Regular".to_string(), component_layer)]),
            },
            ShiftGlyph {
                id: "glyph_stem".to_string(),
                name: "stem".to_string(),
                unicodes: Vec::new(),
                local_axes: vec![ShiftGlyphAxis {
                    id: "axis_stemWidth".to_string(),
                    name: "Stem Width".to_string(),
                    minimum: 20.0,
                    default: 40.0,
                    maximum: 80.0,
                }],
                variation_sources: Vec::new(),
                layers: BTreeMap::new(),
            },
        ],
    );

    package
        .validate()
        .expect("component location should allow global axes plus base glyph local axes");
}

#[test]
fn variable_component_location_rejects_unknown_axes() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_13".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_missing".to_string(), 1.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: Vec::new(),
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };

    let package = package_with_single_source(vec![
        ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::from([("source_Regular".to_string(), component_layer)]),
        },
        ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
    ]);

    let error = package
        .validate()
        .expect_err("unknown component location axis should fail");

    assert!(matches!(
        error,
        ShiftSourceError::MissingComponentLocationAxis {
            glyph_name,
            base_glyph_id,
            axis_id
        } if glyph_name == "A" && base_glyph_id == "glyph_stem" && axis_id == "axis_missing"
    ));
}

#[test]
fn component_variation_sources_validate_parent_and_component_axes() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_14".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_black".to_string(),
                name: "Black component".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                transform: Some(DecomposedTransform {
                    translate_x: 12.0,
                    ..DecomposedTransform::identity()
                }),
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };

    package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    )
    .validate()
    .expect("component variation source should allow global parent and base-local component axes");
}

#[test]
fn component_variation_sources_reject_missing_parent_axes() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_15".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_bad".to_string(),
                name: "Bad component".to_string(),
                parent_location: BTreeMap::from([("axis_missing".to_string(), 1.0)]),
                location: BTreeMap::new(),
                transform: None,
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };

    let error = package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    )
    .validate()
    .expect_err("unknown component variation parent axis should fail");

    assert!(matches!(
        error,
        ShiftSourceError::MissingComponentVariationParentAxis {
            glyph_name,
            base_glyph_id,
            source_id,
            axis_id
        } if glyph_name == "A"
            && base_glyph_id == "glyph_stem"
            && source_id == "componentSource_bad"
            && axis_id == "axis_missing"
    ));
}

#[test]
fn component_variation_sources_reject_default_parent_location() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_16".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_default".to_string(),
                name: "Default duplicate".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 400.0)]),
                location: BTreeMap::new(),
                transform: None,
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };

    let error = package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    )
    .validate()
    .expect_err("default component variation parent location should fail");

    assert!(matches!(
        error,
        ShiftSourceError::ComponentVariationSourceAtDefaultParentLocation {
            glyph_name,
            base_glyph_id,
            source_id,
        } if glyph_name == "A"
            && base_glyph_id == "glyph_stem"
            && source_id == "componentSource_default"
    ));
}

#[test]
fn component_variation_sources_reject_duplicate_parent_locations() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_17".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![
                ShiftComponentVariationSource {
                    id: "componentSource_black_a".to_string(),
                    name: "Black component A".to_string(),
                    parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                    location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                    transform: None,
                },
                ShiftComponentVariationSource {
                    id: "componentSource_black_b".to_string(),
                    name: "Black component B".to_string(),
                    parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                    location: BTreeMap::from([("axis_stemWidth".to_string(), 80.0)]),
                    transform: None,
                },
            ],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };

    let error = package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    )
    .validate()
    .expect_err("duplicate component variation parent location should fail");

    assert!(matches!(
        error,
        ShiftSourceError::DuplicateComponentVariationParentLocation {
            glyph_name,
            base_glyph_id,
            source_id,
            existing_source_id,
        } if glyph_name == "A"
            && base_glyph_id == "glyph_stem"
            && source_id == "componentSource_black_b"
            && existing_source_id == "componentSource_black_a"
    ));
}

#[test]
fn package_rejects_blank_and_duplicate_component_variation_source_names() {
    let mut component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_name_validation".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 40.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: vec![ShiftComponentVariationSource {
                id: "componentSource_blank".to_string(),
                name: "   ".to_string(),
                parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                transform: None,
            }],
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };

    let error = package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer.clone()),
    )
    .validate()
    .expect_err("blank component variation source names should fail validation");

    assert!(matches!(
        error,
        ShiftSourceError::InvalidComponentVariationSourceName {
            glyph_name,
            base_glyph_id,
            source_name,
        } if glyph_name == "A" && base_glyph_id == "glyph_stem" && source_name == "   "
    ));

    component_layer.components[0].variation_sources = vec![
        ShiftComponentVariationSource {
            id: "componentSource_light".to_string(),
            name: "Component correction".to_string(),
            parent_location: BTreeMap::from([("axis_wght".to_string(), 100.0)]),
            location: BTreeMap::new(),
            transform: None,
        },
        ShiftComponentVariationSource {
            id: "componentSource_black".to_string(),
            name: "Component correction".to_string(),
            parent_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
            transform: None,
        },
    ];

    let error = package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    )
    .validate()
    .expect_err("duplicate component variation source names should fail validation");

    assert!(matches!(
        error,
        ShiftSourceError::DuplicateComponentVariationSourceName {
            glyph_name,
            base_glyph_id,
            source_name,
        } if glyph_name == "A"
            && base_glyph_id == "glyph_stem"
            && source_name == "Component correction"
    ));
}

#[test]
fn glyph_variation_sources_must_reference_existing_layers_and_axes() {
    let valid_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: Vec::new(),
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let package = package_with_axes(
        vec![ShiftAxis {
            id: "axis_wght".to_string(),
            tag: "wght".to_string(),
            name: "Weight".to_string(),
            minimum: 100.0,
            default: 400.0,
            maximum: 900.0,
            hidden: false,
            role: ShiftAxisRole::UserFacing,
        }],
        vec![ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: vec![ShiftGlyphAxis {
                id: "axis_stemWidth".to_string(),
                name: "Stem Width".to_string(),
                minimum: 20.0,
                default: 40.0,
                maximum: 80.0,
            }],
            variation_sources: vec![ShiftGlyphSource {
                id: "glyphSource_stem_default".to_string(),
                name: "Default".to_string(),
                location: BTreeMap::from([
                    ("axis_wght".to_string(), 400.0),
                    ("axis_stemWidth".to_string(), 40.0),
                ]),
                layer_id: "source_Regular".to_string(),
            }],
            layers: BTreeMap::from([("source_Regular".to_string(), valid_layer)]),
        }],
    );

    package
        .validate()
        .expect("variation source should allow global and local axes");
}

#[test]
fn glyph_local_axes_must_not_shadow_global_axes() {
    let package = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: vec![ShiftGlyphAxis {
                id: "axis_wght".to_string(),
                name: "Local Weight".to_string(),
                minimum: 0.0,
                default: 0.5,
                maximum: 1.0,
            }],
            variation_sources: Vec::new(),
            layers: BTreeMap::from([("source_Regular".to_string(), empty_layer(600.0))]),
        }],
    );

    let error = package
        .validate()
        .expect_err("local axis ids must not shadow global axis ids");

    assert!(matches!(
        error,
        ShiftSourceError::GlyphLocalAxisConflictsWithGlobalAxis {
            glyph_name,
            axis_id,
        } if glyph_name == "stem" && axis_id == "axis_wght"
    ));
}

#[test]
fn package_rejects_blank_and_duplicate_glyph_local_axis_names() {
    let mut blank_name = package_with_axes(
        Vec::new(),
        vec![ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: vec![ShiftGlyphAxis {
                id: "axis_stemWidth".to_string(),
                name: "   ".to_string(),
                minimum: 20.0,
                default: 40.0,
                maximum: 80.0,
            }],
            variation_sources: Vec::new(),
            layers: BTreeMap::from([("source_Regular".to_string(), empty_layer(600.0))]),
        }],
    );
    let error = blank_name
        .validate()
        .expect_err("blank glyph local axis names should fail validation");
    assert!(matches!(
        error,
        ShiftSourceError::InvalidGlyphLocalAxisName {
            glyph_name,
            axis_name,
        } if glyph_name == "stem" && axis_name == "   "
    ));

    blank_name.glyphs[0].local_axes = vec![
        ShiftGlyphAxis {
            id: "axis_stemWidth".to_string(),
            name: "Stem Width".to_string(),
            minimum: 20.0,
            default: 40.0,
            maximum: 80.0,
        },
        ShiftGlyphAxis {
            id: "axis_stemContrast".to_string(),
            name: "Stem Width".to_string(),
            minimum: 0.0,
            default: 0.5,
            maximum: 1.0,
        },
    ];
    let error = blank_name
        .validate()
        .expect_err("duplicate glyph local axis names should fail validation");
    assert!(matches!(
        error,
        ShiftSourceError::DuplicateGlyphLocalAxisName {
            glyph_name,
            axis_name,
        } if glyph_name == "stem" && axis_name == "Stem Width"
    ));
}

#[test]
fn glyph_variation_sources_reject_duplicate_completed_locations() {
    let package = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: vec![ShiftGlyphAxis {
                id: "axis_stemWidth".to_string(),
                name: "Stem Width".to_string(),
                minimum: 20.0,
                default: 40.0,
                maximum: 80.0,
            }],
            variation_sources: vec![
                ShiftGlyphSource {
                    id: "glyphSource_default_a".to_string(),
                    name: "Default A".to_string(),
                    location: BTreeMap::from([("axis_stemWidth".to_string(), 40.0)]),
                    layer_id: "source_Regular".to_string(),
                },
                ShiftGlyphSource {
                    id: "glyphSource_default_b".to_string(),
                    name: "Default B".to_string(),
                    location: BTreeMap::from([
                        ("axis_wght".to_string(), 400.0),
                        ("axis_stemWidth".to_string(), 40.0),
                    ]),
                    layer_id: "source_Regular".to_string(),
                },
            ],
            layers: BTreeMap::from([("source_Regular".to_string(), empty_layer(600.0))]),
        }],
    );

    let error = package
        .validate()
        .expect_err("duplicate completed glyph variation source locations should fail");

    assert!(matches!(
        error,
        ShiftSourceError::DuplicateGlyphVariationSourceLocation {
            glyph_name,
            source_id,
            existing_source_id,
        } if glyph_name == "stem"
            && source_id == "glyphSource_default_b"
            && existing_source_id == "glyphSource_default_a"
    ));
}

#[test]
fn package_rejects_blank_and_duplicate_glyph_variation_source_names() {
    let mut package = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: vec![ShiftGlyphAxis {
                id: "axis_stemWidth".to_string(),
                name: "Stem Width".to_string(),
                minimum: 20.0,
                default: 40.0,
                maximum: 80.0,
            }],
            variation_sources: vec![ShiftGlyphSource {
                id: "glyphSource_blank".to_string(),
                name: "   ".to_string(),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                layer_id: "source_Regular".to_string(),
            }],
            layers: BTreeMap::from([("source_Regular".to_string(), empty_layer(600.0))]),
        }],
    );
    let error = package
        .validate()
        .expect_err("blank glyph variation source names should fail validation");
    assert!(matches!(
        error,
        ShiftSourceError::InvalidGlyphVariationSourceName {
            glyph_name,
            source_name,
        } if glyph_name == "stem" && source_name == "   "
    ));

    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    package.glyphs[0]
        .layers
        .insert("source_Bold".to_string(), empty_layer(700.0));
    package.glyphs[0].variation_sources = vec![
        ShiftGlyphSource {
            id: "glyphSource_regular".to_string(),
            name: "Correction".to_string(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 40.0)]),
            layer_id: "source_Regular".to_string(),
        },
        ShiftGlyphSource {
            id: "glyphSource_bold".to_string(),
            name: "Correction".to_string(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
            layer_id: "source_Bold".to_string(),
        },
    ];
    let error = package
        .validate()
        .expect_err("duplicate glyph variation source names should fail validation");
    assert!(matches!(
        error,
        ShiftSourceError::DuplicateGlyphVariationSourceName {
            glyph_name,
            source_name,
        } if glyph_name == "stem" && source_name == "Correction"
    ));
}

#[test]
fn working_source_completes_glyph_variation_source_locations() {
    let mut package = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: vec![ShiftGlyphAxis {
                id: "axis_stemWidth".to_string(),
                name: "Stem Width".to_string(),
                minimum: 20.0,
                default: 40.0,
                maximum: 80.0,
            }],
            variation_sources: vec![
                ShiftGlyphSource {
                    id: "glyphSource_default".to_string(),
                    name: "Default".to_string(),
                    location: BTreeMap::new(),
                    layer_id: "source_Regular".to_string(),
                },
                ShiftGlyphSource {
                    id: "glyphSource_bold".to_string(),
                    name: "Bold".to_string(),
                    location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                    layer_id: "source_Bold".to_string(),
                },
            ],
            layers: BTreeMap::from([
                ("source_Regular".to_string(), empty_layer(600.0)),
                ("source_Bold".to_string(), empty_layer(700.0)),
            ]),
        }],
    );
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });

    let working_source = ShiftWorkingSource::new(package).expect("package is valid");
    let locations = working_source
        .glyph_variation_source_locations("glyph_stem")
        .expect("glyph variation source locations should resolve");

    assert_eq!(locations.len(), 2);
    assert_eq!(locations[0].source_id, "glyphSource_default");
    assert_eq!(
        locations[0].values.get("axis_wght"),
        Some(&ShiftGlyphVariationAxisValue {
            value: 400.0,
            source: ShiftGlyphVariationAxisValueSource::AxisDefault,
        })
    );
    assert_eq!(
        locations[0].values.get("axis_stemWidth"),
        Some(&ShiftGlyphVariationAxisValue {
            value: 40.0,
            source: ShiftGlyphVariationAxisValueSource::LocalAxisDefault,
        })
    );
    assert_eq!(locations[1].source_id, "glyphSource_bold");
    assert_eq!(
        locations[1].values.get("axis_wght"),
        Some(&ShiftGlyphVariationAxisValue {
            value: 900.0,
            source: ShiftGlyphVariationAxisValueSource::SourceLocation,
        })
    );
    assert_eq!(
        locations[1].values.get("axis_stemWidth"),
        Some(&ShiftGlyphVariationAxisValue {
            value: 72.0,
            source: ShiftGlyphVariationAxisValueSource::VariationSourceOverride,
        })
    );
}

#[test]
fn working_source_creates_glyph_variation_source_with_generated_id_and_narrow_impact() {
    let mut package = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: vec![ShiftGlyphAxis {
                id: "axis_stemWidth".to_string(),
                name: "Stem Width".to_string(),
                minimum: 20.0,
                default: 40.0,
                maximum: 80.0,
            }],
            variation_sources: vec![ShiftGlyphSource {
                id: "glyphSource_Black".to_string(),
                name: "Black".to_string(),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                layer_id: "source_Bold".to_string(),
            }],
            layers: BTreeMap::from([
                ("source_Regular".to_string(), empty_layer(600.0)),
                ("source_Bold".to_string(), empty_layer(700.0)),
            ]),
        }],
    );
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let mut working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let report = working_source
        .create_glyph_variation_source(
            "glyph_stem",
            ShiftCreateGlyphVariationSource {
                source_id: None,
                name: "Black".to_string(),
                layer_id: "source_Bold".to_string(),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 78.0)]),
            },
        )
        .expect("glyph variation source creation should succeed");

    assert_eq!(report.revision, 1);
    assert_eq!(report.source_id, "glyphSource_Black_1");
    assert_eq!(report.source.source_name, "Black.1");
    assert_eq!(
        report.source.values.get("axis_stemWidth"),
        Some(&ShiftGlyphVariationAxisValue {
            value: 78.0,
            source: ShiftGlyphVariationAxisValueSource::VariationSourceOverride,
        })
    );
    assert_eq!(
        report.diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::UpdateGlyph {
                glyph_id: "glyph_stem".to_string(),
            }],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["glyphs/glyph_stem.json".to_string()],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![
                    DEPENDENCY_INDEX_PATH.to_string(),
                    INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
                ],
            },
        }
    );
}

#[test]
fn working_source_create_glyph_variation_source_uses_fallback_for_blank_names() {
    let mut package = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: vec![ShiftGlyphAxis {
                id: "axis_stemWidth".to_string(),
                name: "Stem Width".to_string(),
                minimum: 20.0,
                default: 40.0,
                maximum: 80.0,
            }],
            variation_sources: Vec::new(),
            layers: BTreeMap::from([
                ("source_Regular".to_string(), empty_layer(600.0)),
                ("source_Bold".to_string(), empty_layer(700.0)),
            ]),
        }],
    );
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let mut working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let report = working_source
        .create_glyph_variation_source(
            "glyph_stem",
            ShiftCreateGlyphVariationSource {
                source_id: None,
                name: "   ".to_string(),
                layer_id: "source_Bold".to_string(),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 78.0)]),
            },
        )
        .expect("blank glyph variation source name should use fallback");

    assert_eq!(report.revision, 1);
    assert_eq!(report.source_id, "glyphSource_New_Variation_Source");
    assert_eq!(report.source.source_name, "New Variation Source");
}

#[test]
fn working_source_rejects_invalid_glyph_variation_source_create_without_mutating() {
    let mut package = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: vec![ShiftGlyphAxis {
                id: "axis_stemWidth".to_string(),
                name: "Stem Width".to_string(),
                minimum: 20.0,
                default: 40.0,
                maximum: 80.0,
            }],
            variation_sources: vec![ShiftGlyphSource {
                id: "glyphSource_default".to_string(),
                name: "Default".to_string(),
                location: BTreeMap::new(),
                layer_id: "source_Regular".to_string(),
            }],
            layers: BTreeMap::from([
                ("source_Regular".to_string(), empty_layer(600.0)),
                ("source_Bold".to_string(), empty_layer(700.0)),
            ]),
        }],
    );
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let mut working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let error = working_source
        .create_glyph_variation_source(
            "glyph_stem",
            ShiftCreateGlyphVariationSource {
                source_id: Some("glyphSource_duplicate".to_string()),
                name: "Duplicate".to_string(),
                layer_id: "source_Regular".to_string(),
                location: BTreeMap::new(),
            },
        )
        .expect_err("duplicate completed glyph source location should fail");

    assert!(matches!(
        error,
        ShiftSourceError::DuplicateGlyphVariationSourceLocation {
            glyph_name,
            source_id,
            existing_source_id,
        } if glyph_name == "stem"
            && source_id == "glyphSource_duplicate"
            && existing_source_id == "glyphSource_default"
    ));
    assert_eq!(working_source.revision(), 0);

    let sources = working_source
        .glyph_variation_source_locations("glyph_stem")
        .expect("glyph variation source locations should still resolve");
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].source_id, "glyphSource_default");
}

#[test]
fn working_source_deletes_glyph_variation_source_with_narrow_impact() {
    let mut package = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: vec![ShiftGlyphAxis {
                id: "axis_stemWidth".to_string(),
                name: "Stem Width".to_string(),
                minimum: 20.0,
                default: 40.0,
                maximum: 80.0,
            }],
            variation_sources: vec![ShiftGlyphSource {
                id: "glyphSource_bold".to_string(),
                name: "Bold".to_string(),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                layer_id: "source_Bold".to_string(),
            }],
            layers: BTreeMap::from([
                ("source_Regular".to_string(), empty_layer(600.0)),
                ("source_Bold".to_string(), empty_layer(700.0)),
            ]),
        }],
    );
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let mut working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let report = working_source
        .delete_glyph_variation_source("glyph_stem", "glyphSource_bold")
        .expect("glyph variation source deletion should succeed");

    assert_eq!(report.revision, 1);
    assert_eq!(report.source_id, "glyphSource_bold");
    assert_eq!(report.source_name, "Bold");
    assert_eq!(
        report.diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::UpdateGlyph {
                glyph_id: "glyph_stem".to_string(),
            }],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["glyphs/glyph_stem.json".to_string()],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![
                    DEPENDENCY_INDEX_PATH.to_string(),
                    INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
                ],
            },
        }
    );
    assert!(working_source
        .glyph_variation_source_locations("glyph_stem")
        .expect("glyph variation source locations should still resolve")
        .is_empty());
}

#[test]
fn working_source_missing_glyph_variation_source_delete_does_not_mutate() {
    let mut package = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: vec![ShiftGlyphSource {
                id: "glyphSource_bold".to_string(),
                name: "Bold".to_string(),
                location: BTreeMap::new(),
                layer_id: "source_Bold".to_string(),
            }],
            layers: BTreeMap::from([
                ("source_Regular".to_string(), empty_layer(600.0)),
                ("source_Bold".to_string(), empty_layer(700.0)),
            ]),
        }],
    );
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let mut working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let error = working_source
        .delete_glyph_variation_source("glyph_stem", "glyphSource_missing")
        .expect_err("missing glyph variation source delete should fail");

    assert!(matches!(
        error,
        ShiftSourceError::MissingGlyphVariationSource {
            glyph_id,
            source_id,
        } if glyph_id == "glyph_stem" && source_id == "glyphSource_missing"
    ));
    assert_eq!(working_source.revision(), 0);
    let sources = working_source
        .glyph_variation_source_locations("glyph_stem")
        .expect("glyph variation source locations should still resolve");
    assert_eq!(sources.len(), 1);
    assert_eq!(sources[0].source_id, "glyphSource_bold");
}

#[test]
fn working_source_updates_glyph_variation_source_with_narrow_impact() {
    let mut package = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: vec![ShiftGlyphAxis {
                id: "axis_stemWidth".to_string(),
                name: "Stem Width".to_string(),
                minimum: 20.0,
                default: 40.0,
                maximum: 80.0,
            }],
            variation_sources: vec![ShiftGlyphSource {
                id: "glyphSource_bold".to_string(),
                name: "Bold".to_string(),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                layer_id: "source_Bold".to_string(),
            }],
            layers: BTreeMap::from([
                ("source_Regular".to_string(), empty_layer(600.0)),
                ("source_Bold".to_string(), empty_layer(700.0)),
            ]),
        }],
    );
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let mut working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let report = working_source
        .update_glyph_variation_source(
            "glyph_stem",
            "glyphSource_bold",
            ShiftGlyphVariationSourceUpdate {
                name: "Black".to_string(),
                layer_id: "source_Bold".to_string(),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 76.0)]),
            },
        )
        .expect("glyph variation source update should succeed");

    assert_eq!(report.revision, 1);
    assert_eq!(report.source.source_name, "Black");
    assert_eq!(report.source.layer_id, "source_Bold");
    assert_eq!(
        report.source.values.get("axis_stemWidth"),
        Some(&ShiftGlyphVariationAxisValue {
            value: 76.0,
            source: ShiftGlyphVariationAxisValueSource::VariationSourceOverride,
        })
    );
    assert_eq!(
        report.diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::UpdateGlyph {
                glyph_id: "glyph_stem".to_string(),
            }],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["glyphs/glyph_stem.json".to_string()],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![
                    DEPENDENCY_INDEX_PATH.to_string(),
                    INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
                ],
            },
        }
    );
}

#[test]
fn working_source_rejects_blank_glyph_variation_source_update_without_mutating() {
    let mut package = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: vec![ShiftGlyphAxis {
                id: "axis_stemWidth".to_string(),
                name: "Stem Width".to_string(),
                minimum: 20.0,
                default: 40.0,
                maximum: 80.0,
            }],
            variation_sources: vec![ShiftGlyphSource {
                id: "glyphSource_bold".to_string(),
                name: "Bold".to_string(),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                layer_id: "source_Bold".to_string(),
            }],
            layers: BTreeMap::from([
                ("source_Regular".to_string(), empty_layer(600.0)),
                ("source_Bold".to_string(), empty_layer(700.0)),
            ]),
        }],
    );
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let mut working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let error = working_source
        .update_glyph_variation_source(
            "glyph_stem",
            "glyphSource_bold",
            ShiftGlyphVariationSourceUpdate {
                name: "   ".to_string(),
                layer_id: "source_Bold".to_string(),
                location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
            },
        )
        .expect_err("blank glyph variation source update should fail");

    assert!(matches!(
        error,
        ShiftSourceError::InvalidGlyphVariationSourceName {
            glyph_name,
            source_name,
        } if glyph_name == "stem" && source_name.is_empty()
    ));
    assert_eq!(working_source.revision(), 0);
    let sources = working_source
        .glyph_variation_source_locations("glyph_stem")
        .expect("glyph variation source locations should still resolve");
    assert_eq!(sources[0].source_name, "Bold");
}

#[test]
fn working_source_rejects_invalid_glyph_variation_source_update_without_mutating() {
    let mut package = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: vec![ShiftGlyphAxis {
                id: "axis_stemWidth".to_string(),
                name: "Stem Width".to_string(),
                minimum: 20.0,
                default: 40.0,
                maximum: 80.0,
            }],
            variation_sources: vec![
                ShiftGlyphSource {
                    id: "glyphSource_default".to_string(),
                    name: "Default".to_string(),
                    location: BTreeMap::new(),
                    layer_id: "source_Regular".to_string(),
                },
                ShiftGlyphSource {
                    id: "glyphSource_bold".to_string(),
                    name: "Bold".to_string(),
                    location: BTreeMap::from([("axis_stemWidth".to_string(), 72.0)]),
                    layer_id: "source_Bold".to_string(),
                },
            ],
            layers: BTreeMap::from([
                ("source_Regular".to_string(), empty_layer(600.0)),
                ("source_Bold".to_string(), empty_layer(700.0)),
            ]),
        }],
    );
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let mut working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let error = working_source
        .update_glyph_variation_source(
            "glyph_stem",
            "glyphSource_bold",
            ShiftGlyphVariationSourceUpdate {
                name: "Duplicate".to_string(),
                layer_id: "source_Regular".to_string(),
                location: BTreeMap::new(),
            },
        )
        .expect_err("duplicate completed glyph source location should fail");

    assert!(matches!(
        error,
        ShiftSourceError::DuplicateGlyphVariationSourceLocation {
            glyph_name,
            source_id,
            existing_source_id,
        } if glyph_name == "stem"
            && source_id == "glyphSource_bold"
            && existing_source_id == "glyphSource_default"
    ));
    assert_eq!(working_source.revision(), 0);

    let sources = working_source
        .glyph_variation_source_locations("glyph_stem")
        .expect("glyph variation source locations should still resolve");
    assert_eq!(sources[1].source_id, "glyphSource_bold");
    assert_eq!(sources[1].source_name, "Bold");
    assert_eq!(sources[1].layer_id, "source_Bold");
    assert_eq!(
        sources[1].values.get("axis_stemWidth"),
        Some(&ShiftGlyphVariationAxisValue {
            value: 72.0,
            source: ShiftGlyphVariationAxisValueSource::VariationSourceOverride,
        })
    );
}

#[test]
fn component_conditions_must_reference_global_axes() {
    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_18".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: Vec::new(),
            condition: Some(ShiftCondition::AxisRange {
                axis_id: "axis_missing".to_string(),
                min: Some(0.0),
                max: None,
            }),
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let package = package_with_single_source(vec![
        ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::from([("source_Regular".to_string(), component_layer)]),
        },
        ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
    ]);

    let error = package
        .validate()
        .expect_err("unknown condition axis should fail");

    assert!(matches!(
        error,
        ShiftSourceError::MissingConditionAxis {
            glyph_name,
            axis_id
        } if glyph_name == "A" && axis_id == "axis_missing"
    ));
}

#[test]
fn component_conditions_reject_empty_boolean_nodes_and_invalid_ranges() {
    let empty_condition_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_19".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: Vec::new(),
            condition: Some(ShiftCondition::And {
                conditions: Vec::new(),
            }),
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let invalid_range_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_20".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: Vec::new(),
            condition: Some(ShiftCondition::AxisRange {
                axis_id: "axis_wght".to_string(),
                min: Some(900.0),
                max: Some(100.0),
            }),
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let unreachable_range_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_21".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: Vec::new(),
            condition: Some(ShiftCondition::AxisRange {
                axis_id: "axis_wght".to_string(),
                min: Some(950.0),
                max: None,
            }),
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };

    let empty_error = package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer(empty_condition_layer),
    )
    .validate()
    .expect_err("empty boolean condition should fail");
    let range_error = package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer(invalid_range_layer),
    )
    .validate()
    .expect_err("invalid condition range should fail");
    let unreachable_error = package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer(unreachable_range_layer),
    )
    .validate()
    .expect_err("condition range outside axis domain should fail");

    assert!(matches!(
        empty_error,
        ShiftSourceError::EmptyCondition { glyph_name, kind }
            if glyph_name == "A" && kind == "and"
    ));
    assert!(matches!(
        range_error,
        ShiftSourceError::InvalidConditionRange {
            glyph_name,
            axis_id,
            min: Some(900.0),
            max: Some(100.0)
        } if glyph_name == "A" && axis_id == "axis_wght"
    ));
    assert!(matches!(
        unreachable_error,
        ShiftSourceError::InvalidConditionRange {
            glyph_name,
            axis_id,
            min: Some(950.0),
            max: None,
        } if glyph_name == "A" && axis_id == "axis_wght"
    ));
}

#[test]
fn component_graph_rejects_cycles_before_rendering_can_recurse_forever() {
    let a_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_22".to_string(),
            base_glyph_id: "glyph_B".to_string(),
            base_glyph_name: "B".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: Vec::new(),
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let b_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_23".to_string(),
            base_glyph_id: "glyph_A".to_string(),
            base_glyph_name: "A".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: Vec::new(),
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let package = package_with_single_source(vec![
        ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::from([("source_Regular".to_string(), a_layer)]),
        },
        ShiftGlyph {
            id: "glyph_B".to_string(),
            name: "B".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::from([("source_Regular".to_string(), b_layer)]),
        },
    ]);

    let error = package
        .validate()
        .expect_err("component cycle should fail validation");

    assert!(matches!(
        error,
        ShiftSourceError::ComponentCycle { path }
            if path == vec!["glyph_A", "glyph_B", "glyph_A"]
    ));
}

#[test]
fn axis_mappings_roundtrip_as_a_first_class_package_file() {
    let temp_dir = tempfile::tempdir().expect("temp dir should be created");
    let package_path = temp_dir.path().join("SpikeSans.shift");
    let mut package = package_with_axes(
        vec![
            ShiftAxis {
                id: "axis_wght".to_string(),
                tag: "wght".to_string(),
                name: "Weight".to_string(),
                minimum: 100.0,
                default: 400.0,
                maximum: 900.0,
                hidden: false,
                role: ShiftAxisRole::UserFacing,
            },
            ShiftAxis {
                id: "axis_stem".to_string(),
                tag: "STEM".to_string(),
                name: "Stem".to_string(),
                minimum: 0.0,
                default: 0.0,
                maximum: 1.0,
                hidden: true,
                role: ShiftAxisRole::Internal,
            },
        ],
        Vec::new(),
    );
    package.axis_mappings = vec![ShiftAxisMapping {
        id: "mapping_weight_to_stem".to_string(),
        name: "Weight drives stem".to_string(),
        input_axes: vec!["axis_wght".to_string()],
        output_axes: vec!["axis_stem".to_string()],
        samples: vec![ShiftAxisMappingSample {
            input_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
            output_location: BTreeMap::from([("axis_stem".to_string(), 1.0)]),
        }],
    }];

    save_package(&package, &package_path).expect("package should save");

    assert!(package_path.join("axis-mappings.json").exists());
    let loaded = load_package(&package_path).expect("package should load");

    assert_eq!(loaded.axis_mappings.len(), 1);
    assert_eq!(loaded.axis_mappings[0].id, "mapping_weight_to_stem");
    assert_eq!(loaded.axis_mappings[0].output_axes, vec!["axis_stem"]);
}

#[test]
fn package_rejects_blank_and_duplicate_axis_mapping_names() {
    let mut blank_name = package_with_weight_to_stem_mapping();
    blank_name.axis_mappings[0].name = "   ".to_string();
    let error = blank_name
        .validate()
        .expect_err("blank axis mapping names should fail validation");
    assert!(matches!(
        error,
        ShiftSourceError::InvalidAxisMappingName { mapping_name } if mapping_name == "   "
    ));

    let mut duplicate_name = package_with_weight_to_stem_mapping();
    duplicate_name.axis_mappings.push(ShiftAxisMapping {
        id: "mapping_second".to_string(),
        name: "Weight drives stem".to_string(),
        input_axes: vec!["axis_wght".to_string()],
        output_axes: vec!["axis_stem".to_string()],
        samples: vec![
            ShiftAxisMappingSample {
                input_location: BTreeMap::from([("axis_wght".to_string(), 100.0)]),
                output_location: BTreeMap::from([("axis_stem".to_string(), 0.0)]),
            },
            ShiftAxisMappingSample {
                input_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                output_location: BTreeMap::from([("axis_stem".to_string(), 0.5)]),
            },
        ],
    });
    let error = duplicate_name
        .validate()
        .expect_err("duplicate axis mapping names should fail validation");
    assert!(matches!(
        error,
        ShiftSourceError::DuplicateAxisMappingName { mapping_name }
            if mapping_name == "Weight drives stem"
    ));
}

#[test]
fn axis_mappings_reject_unknown_axes_and_empty_samples() {
    let base_axis = ShiftAxis {
        id: "axis_wght".to_string(),
        tag: "wght".to_string(),
        name: "Weight".to_string(),
        minimum: 100.0,
        default: 400.0,
        maximum: 900.0,
        hidden: false,
        role: ShiftAxisRole::UserFacing,
    };

    let mut missing_input = package_with_axes(vec![base_axis.clone()], Vec::new());
    missing_input.axis_mappings = vec![ShiftAxisMapping {
        id: "mapping_missing_input".to_string(),
        name: "Missing input".to_string(),
        input_axes: vec!["axis_missing".to_string()],
        output_axes: vec!["axis_wght".to_string()],
        samples: vec![ShiftAxisMappingSample {
            input_location: BTreeMap::new(),
            output_location: BTreeMap::from([("axis_wght".to_string(), 700.0)]),
        }],
    }];
    let input_error = missing_input
        .validate()
        .expect_err("unknown input axis should fail");

    assert!(matches!(
        input_error,
        ShiftSourceError::MissingAxisMappingInputAxis {
            mapping_id,
            axis_id
        } if mapping_id == "mapping_missing_input" && axis_id == "axis_missing"
    ));

    let mut missing_output = package_with_axes(vec![base_axis.clone()], Vec::new());
    missing_output.axis_mappings = vec![ShiftAxisMapping {
        id: "mapping_missing_output".to_string(),
        name: "Missing output".to_string(),
        input_axes: vec!["axis_wght".to_string()],
        output_axes: vec!["axis_missing".to_string()],
        samples: vec![ShiftAxisMappingSample {
            input_location: BTreeMap::from([("axis_wght".to_string(), 700.0)]),
            output_location: BTreeMap::new(),
        }],
    }];
    let output_error = missing_output
        .validate()
        .expect_err("unknown output axis should fail");

    assert!(matches!(
        output_error,
        ShiftSourceError::MissingAxisMappingOutputAxis {
            mapping_id,
            axis_id
        } if mapping_id == "mapping_missing_output" && axis_id == "axis_missing"
    ));

    let mut empty_samples = package_with_axes(vec![base_axis], Vec::new());
    empty_samples.axis_mappings = vec![ShiftAxisMapping {
        id: "mapping_empty".to_string(),
        name: "Empty".to_string(),
        input_axes: vec!["axis_wght".to_string()],
        output_axes: vec!["axis_wght".to_string()],
        samples: Vec::new(),
    }];
    let empty_error = empty_samples
        .validate()
        .expect_err("empty mapping should fail");

    assert!(matches!(
        empty_error,
        ShiftSourceError::EmptyAxisMapping { mapping_id } if mapping_id == "mapping_empty"
    ));
}

#[test]
fn axis_mappings_reject_ambiguous_sample_shapes() {
    let mut duplicate_input_axis = package_with_axes(vec![weight_axis()], Vec::new());
    duplicate_input_axis.axis_mappings = vec![ShiftAxisMapping {
        id: "mapping_duplicate_input_axis".to_string(),
        name: "Duplicate input axis".to_string(),
        input_axes: vec!["axis_wght".to_string(), "axis_wght".to_string()],
        output_axes: vec!["axis_wght".to_string()],
        samples: vec![ShiftAxisMappingSample {
            input_location: BTreeMap::from([("axis_wght".to_string(), 700.0)]),
            output_location: BTreeMap::from([("axis_wght".to_string(), 800.0)]),
        }],
    }];
    let duplicate_input_axis_error = duplicate_input_axis
        .validate()
        .expect_err("duplicate mapping input axis should fail");

    assert!(matches!(
        duplicate_input_axis_error,
        ShiftSourceError::DuplicateAxisMappingInputAxis { mapping_id, axis_id }
            if mapping_id == "mapping_duplicate_input_axis" && axis_id == "axis_wght"
    ));

    let mut duplicate_output_axis = package_with_axes(vec![weight_axis()], Vec::new());
    duplicate_output_axis.axis_mappings = vec![ShiftAxisMapping {
        id: "mapping_duplicate_output_axis".to_string(),
        name: "Duplicate output axis".to_string(),
        input_axes: vec!["axis_wght".to_string()],
        output_axes: vec!["axis_wght".to_string(), "axis_wght".to_string()],
        samples: vec![ShiftAxisMappingSample {
            input_location: BTreeMap::from([("axis_wght".to_string(), 700.0)]),
            output_location: BTreeMap::from([("axis_wght".to_string(), 800.0)]),
        }],
    }];
    let duplicate_output_axis_error = duplicate_output_axis
        .validate()
        .expect_err("duplicate mapping output axis should fail");

    assert!(matches!(
        duplicate_output_axis_error,
        ShiftSourceError::DuplicateAxisMappingOutputAxis { mapping_id, axis_id }
            if mapping_id == "mapping_duplicate_output_axis" && axis_id == "axis_wght"
    ));

    let mut missing_sample_input = package_with_axes(vec![weight_axis(), width_axis()], Vec::new());
    missing_sample_input.axis_mappings = vec![ShiftAxisMapping {
        id: "mapping_missing_sample_input".to_string(),
        name: "Missing sample input".to_string(),
        input_axes: vec!["axis_wght".to_string(), "axis_wdth".to_string()],
        output_axes: vec!["axis_wght".to_string()],
        samples: vec![ShiftAxisMappingSample {
            input_location: BTreeMap::from([("axis_wght".to_string(), 700.0)]),
            output_location: BTreeMap::from([("axis_wght".to_string(), 800.0)]),
        }],
    }];
    let missing_sample_input_error = missing_sample_input
        .validate()
        .expect_err("missing sample input axis should fail");

    assert!(matches!(
        missing_sample_input_error,
        ShiftSourceError::MissingAxisMappingSampleInput {
            mapping_id,
            sample_index: 0,
            axis_id,
        } if mapping_id == "mapping_missing_sample_input" && axis_id == "axis_wdth"
    ));

    let mut missing_sample_output = package_with_axes(vec![weight_axis()], Vec::new());
    missing_sample_output.axis_mappings = vec![ShiftAxisMapping {
        id: "mapping_missing_sample_output".to_string(),
        name: "Missing sample output".to_string(),
        input_axes: vec!["axis_wght".to_string()],
        output_axes: vec!["axis_wght".to_string()],
        samples: vec![ShiftAxisMappingSample {
            input_location: BTreeMap::from([("axis_wght".to_string(), 700.0)]),
            output_location: BTreeMap::from([("axis_wght_extra".to_string(), 800.0)]),
        }],
    }];
    let missing_sample_output_error = missing_sample_output
        .validate()
        .expect_err("missing sample output axis should fail");

    assert!(matches!(
        missing_sample_output_error,
        ShiftSourceError::MissingAxisMappingSampleOutput {
            mapping_id,
            sample_index: 0,
            axis_id,
        } if mapping_id == "mapping_missing_sample_output" && axis_id == "axis_wght"
    ));

    let mut duplicate_sample_input = package_with_axes(vec![weight_axis()], Vec::new());
    duplicate_sample_input.axis_mappings = vec![ShiftAxisMapping {
        id: "mapping_duplicate_sample_input".to_string(),
        name: "Duplicate sample input".to_string(),
        input_axes: vec!["axis_wght".to_string()],
        output_axes: vec!["axis_wght".to_string()],
        samples: vec![
            ShiftAxisMappingSample {
                input_location: BTreeMap::from([("axis_wght".to_string(), 700.0)]),
                output_location: BTreeMap::from([("axis_wght".to_string(), 750.0)]),
            },
            ShiftAxisMappingSample {
                input_location: BTreeMap::from([("axis_wght".to_string(), 700.0)]),
                output_location: BTreeMap::from([("axis_wght".to_string(), 800.0)]),
            },
        ],
    }];
    let duplicate_sample_input_error = duplicate_sample_input
        .validate()
        .expect_err("duplicate sample input location should fail");

    assert!(matches!(
        duplicate_sample_input_error,
        ShiftSourceError::DuplicateAxisMappingSampleInputLocation {
            mapping_id,
            sample_index: 1,
            existing_sample_index: 0,
        } if mapping_id == "mapping_duplicate_sample_input"
    ));
}

#[test]
fn axis_mappings_reject_implicit_chains_between_mappings() {
    let mut package = package_with_axes(
        vec![weight_axis(), internal_stem_axis(), width_axis()],
        Vec::new(),
    );
    package.axis_mappings = vec![
        ShiftAxisMapping {
            id: "mapping_weight_to_stem".to_string(),
            name: "Weight drives stem".to_string(),
            input_axes: vec!["axis_wght".to_string()],
            output_axes: vec!["axis_stem".to_string()],
            samples: vec![ShiftAxisMappingSample {
                input_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                output_location: BTreeMap::from([("axis_stem".to_string(), 1.0)]),
            }],
        },
        ShiftAxisMapping {
            id: "mapping_stem_to_width".to_string(),
            name: "Stem drives width".to_string(),
            input_axes: vec!["axis_stem".to_string()],
            output_axes: vec!["axis_wdth".to_string()],
            samples: vec![ShiftAxisMappingSample {
                input_location: BTreeMap::from([("axis_stem".to_string(), 1.0)]),
                output_location: BTreeMap::from([("axis_wdth".to_string(), 100.0)]),
            }],
        },
    ];

    let error = package
        .validate()
        .expect_err("implicit ordered mapping chains should fail");

    assert!(matches!(
        error,
        ShiftSourceError::AxisMappingOutputFeedsMappingInput {
            mapping_id,
            input_mapping_id,
            axis_id,
        } if mapping_id == "mapping_weight_to_stem"
            && input_mapping_id == "mapping_stem_to_width"
            && axis_id == "axis_stem"
    ));
}

#[test]
fn location_coordinates_must_stay_within_axis_ranges() {
    let mut source_out_of_range = package_with_axes(vec![weight_axis()], Vec::new());
    source_out_of_range.sources[0]
        .location
        .insert("axis_wght".to_string(), 1000.0);
    let source_error = source_out_of_range
        .validate()
        .expect_err("source coordinate outside axis range should fail");

    assert!(matches!(
        source_error,
        ShiftSourceError::AxisCoordinateOutOfRange {
            context,
            axis_id,
            value,
            minimum: 100.0,
            maximum: 900.0,
        } if context == "source 'source_Regular'" && axis_id == "axis_wght" && value == 1000.0
    ));

    let mut mapping_out_of_range =
        package_with_axes(vec![weight_axis(), internal_stem_axis()], Vec::new());
    mapping_out_of_range.axis_mappings = vec![ShiftAxisMapping {
        id: "mapping_bad".to_string(),
        name: "Bad mapping".to_string(),
        input_axes: vec!["axis_wght".to_string()],
        output_axes: vec!["axis_stem".to_string()],
        samples: vec![ShiftAxisMappingSample {
            input_location: BTreeMap::from([("axis_wght".to_string(), 700.0)]),
            output_location: BTreeMap::from([("axis_stem".to_string(), 2.0)]),
        }],
    }];
    let mapping_error = mapping_out_of_range
        .validate()
        .expect_err("mapping coordinate outside axis range should fail");

    assert!(matches!(
        mapping_error,
        ShiftSourceError::AxisCoordinateOutOfRange {
            context,
            axis_id,
            value,
            minimum: 0.0,
            maximum: 1.0,
        } if context == "axis mapping 'mapping_bad' sample 0 output"
            && axis_id == "axis_stem"
            && value == 2.0
    ));

    let glyph_source_out_of_range = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: vec![ShiftGlyphSource {
                id: "glyphSource_A_bad".to_string(),
                name: "Bad".to_string(),
                location: BTreeMap::from([("axis_wght".to_string(), 50.0)]),
                layer_id: "source_Regular".to_string(),
            }],
            layers: BTreeMap::from([(
                "source_Regular".to_string(),
                layer_with_line_contour(600.0),
            )]),
        }],
    );
    let glyph_source_error = glyph_source_out_of_range
        .validate()
        .expect_err("glyph variation source coordinate outside axis range should fail");

    assert!(matches!(
        glyph_source_error,
        ShiftSourceError::AxisCoordinateOutOfRange {
            context,
            axis_id,
            value,
            minimum: 100.0,
            maximum: 900.0,
        } if context == "glyph 'A' variation source 'glyphSource_A_bad'"
            && axis_id == "axis_wght"
            && value == 50.0
    ));

    let component_layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_24".to_string(),
            base_glyph_id: "glyph_stem".to_string(),
            base_glyph_name: "stem".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::from([("axis_stemWidth".to_string(), 90.0)]),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: Vec::new(),
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };
    let component_out_of_range = package_with_axes(
        vec![weight_axis()],
        glyphs_for_component_layer_with_local_base(component_layer),
    );
    let component_error = component_out_of_range
        .validate()
        .expect_err("component local coordinate outside base local axis range should fail");

    assert!(matches!(
        component_error,
        ShiftSourceError::AxisCoordinateOutOfRange {
            context,
            axis_id,
            value,
            minimum: 20.0,
            maximum: 80.0,
        } if context == "component on glyph 'A' targeting 'glyph_stem'"
            && axis_id == "axis_stemWidth"
            && value == 90.0
    ));
}

#[test]
fn variable_source_locations_must_be_unique_after_defaults() {
    let mut package = package_with_axes(vec![weight_axis()], Vec::new());
    package.sources.push(ShiftSource {
        id: "source_DefaultDuplicate".to_string(),
        name: "Default Duplicate".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 400.0)]),
    });

    let error = package
        .validate()
        .expect_err("duplicate completed source locations should fail for variable packages");

    assert!(matches!(
        error,
        ShiftSourceError::DuplicateSourceLocation {
            source_id,
            existing_source_id,
        } if source_id == "source_DefaultDuplicate" && existing_source_id == "source_Regular"
    ));
}

#[test]
fn working_source_completes_sparse_source_locations() {
    let mut package = package_with_axes(vec![weight_axis()], Vec::new());
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });

    let working_source = ShiftWorkingSource::new(package).expect("package is valid");
    let locations = working_source.source_locations();

    assert_eq!(locations.len(), 2);
    assert_eq!(locations[0].source_id, "source_Regular");
    assert_eq!(
        locations[0].values.get("axis_wght"),
        Some(&ShiftSourceAxisValue {
            value: 400.0,
            source: ShiftSourceAxisValueSource::AxisDefault,
        })
    );
    assert_eq!(locations[1].source_id, "source_Bold");
    assert_eq!(
        locations[1].values.get("axis_wght"),
        Some(&ShiftSourceAxisValue {
            value: 900.0,
            source: ShiftSourceAxisValueSource::SourceLocation,
        })
    );
}

#[test]
fn working_source_reports_source_layer_coverage() {
    let mut package = package_with_axes(
        vec![weight_axis()],
        vec![
            ShiftGlyph {
                id: "glyph_A".to_string(),
                name: "A".to_string(),
                unicodes: Vec::new(),
                local_axes: Vec::new(),
                variation_sources: Vec::new(),
                layers: BTreeMap::from([("source_Regular".to_string(), empty_layer(600.0))]),
            },
            ShiftGlyph {
                id: "glyph_B".to_string(),
                name: "B".to_string(),
                unicodes: Vec::new(),
                local_axes: Vec::new(),
                variation_sources: Vec::new(),
                layers: BTreeMap::from([
                    ("source_Regular".to_string(), empty_layer(600.0)),
                    ("source_Bold".to_string(), empty_layer(700.0)),
                ]),
            },
        ],
    );
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let coverage = working_source.source_layer_coverage();

    assert_eq!(coverage.len(), 2);
    assert_eq!(coverage[0].source_id, "source_Regular");
    assert_eq!(coverage[0].glyph_count, 2);
    assert_eq!(coverage[0].layer_count, 2);
    assert_eq!(coverage[0].missing_layer_count, 0);
    assert!(coverage[0].complete);
    assert!(coverage[0].interpolation_compatible);
    assert_eq!(coverage[1].source_id, "source_Bold");
    assert_eq!(coverage[1].source_name, "Bold");
    assert_eq!(coverage[1].glyph_count, 2);
    assert_eq!(coverage[1].layer_count, 1);
    assert_eq!(coverage[1].missing_layer_count, 1);
    assert!(!coverage[1].complete);
    assert!(coverage[1].interpolation_compatible);
    assert_eq!(coverage[1].present_layers[0].glyph_id, "glyph_B");
    assert_eq!(coverage[1].missing_layers[0].glyph_id, "glyph_A");
    assert_eq!(
        coverage[1].missing_layers[0].expected_layer_id,
        "source_Bold"
    );
}

#[test]
fn working_source_reports_source_interpolation_issues() {
    let mut package = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::from([
                ("source_Regular".to_string(), layer_with_line_contour(600.0)),
                ("source_Bold".to_string(), empty_layer(700.0)),
            ]),
        }],
    );
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let coverage = working_source.source_layer_coverage();

    assert_eq!(coverage[0].source_id, "source_Regular");
    assert!(!coverage[0].interpolation_compatible);
    assert_eq!(coverage[0].interpolation_issue_count, 1);
    assert_eq!(coverage[0].interpolation_issues[0].glyph_id, "glyph_A");
    assert_eq!(
        coverage[0].interpolation_issues[0].issue.kind,
        ShiftInterpolationCompatibilityIssueKind::ContourCountMismatch
    );
    assert_eq!(
        coverage[0].interpolation_issues[0].issue.reference_layer_id,
        "source_Bold"
    );
    assert_eq!(
        coverage[0].interpolation_issues[0].issue.layer_id,
        "source_Regular"
    );
    assert_eq!(coverage[1].source_id, "source_Bold");
    assert!(!coverage[1].interpolation_compatible);
    assert_eq!(coverage[1].interpolation_issue_count, 1);
    assert_eq!(coverage[1].interpolation_issues[0].glyph_name, "A");
    assert_eq!(
        coverage[1].interpolation_issues[0].issue.reference_layer_id,
        "source_Bold"
    );
    assert_eq!(
        coverage[1].interpolation_issues[0].issue.layer_id,
        "source_Regular"
    );
}

#[test]
fn working_source_creates_glyph_with_generated_name_id_and_default_layer() {
    let mut working_source =
        ShiftWorkingSource::new(package_with_single_source(vec![ShiftGlyph {
            id: "glyph_newGlyph".to_string(),
            name: "newGlyph".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::from([("source_Regular".to_string(), empty_layer(600.0))]),
        }]))
        .expect("package is valid");

    let report = working_source
        .create_glyph(ShiftCreateGlyph {
            glyph_id: None,
            name: "newGlyph".to_string(),
            unicodes: vec!["41".to_string()],
            default_layer: Some(empty_layer(500.0)),
        })
        .expect("glyph creation should succeed");

    assert_eq!(report.revision, 1);
    assert_eq!(report.glyph_id, "glyph_newGlyph_1");
    assert_eq!(report.glyph_name, "newGlyph.1");
    assert_eq!(
        report.diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::CreateGlyph {
                glyph_id: "glyph_newGlyph_1".to_string(),
            }],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["glyphs/glyph_newGlyph_1.json".to_string()],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![
                    DEPENDENCY_INDEX_PATH.to_string(),
                    INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
                ],
            },
        }
    );

    let glyph = working_source
        .package()
        .glyphs
        .iter()
        .find(|glyph| glyph.id == "glyph_newGlyph_1")
        .expect("created glyph should exist");
    assert_eq!(glyph.name, "newGlyph.1");
    assert_eq!(glyph.unicodes, vec!["0041".to_string()]);
    assert_eq!(
        glyph
            .layers
            .get("source_Regular")
            .expect("default source layer should be created")
            .advance_width,
        500.0
    );
    assert!(working_source
        .glyph_dependencies("glyph_newGlyph_1")
        .expect("dependency index should include created glyph")
        .component_dependents
        .is_empty());
}

#[test]
fn working_source_create_glyph_uses_new_glyph_for_blank_names() {
    let mut working_source =
        ShiftWorkingSource::new(package_with_single_source(Vec::new())).expect("package is valid");

    let report = working_source
        .create_glyph(ShiftCreateGlyph {
            glyph_id: None,
            name: "   ".to_string(),
            unicodes: Vec::new(),
            default_layer: None,
        })
        .expect("blank glyph name should use fallback");

    assert_eq!(report.glyph_id, "glyph_newGlyph");
    assert_eq!(report.glyph_name, "newGlyph");
    assert_eq!(working_source.revision(), 1);
}

#[test]
fn working_source_rejects_invalid_glyph_create_without_mutating() {
    let mut working_source =
        ShiftWorkingSource::new(package_with_single_source(vec![ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: vec!["0041".to_string()],
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        }]))
        .expect("package is valid");

    let error = working_source
        .create_glyph(ShiftCreateGlyph {
            glyph_id: Some("glyph_A".to_string()),
            name: "B".to_string(),
            unicodes: Vec::new(),
            default_layer: None,
        })
        .expect_err("duplicate explicit glyph id should fail");
    assert!(matches!(
        error,
        ShiftSourceError::DuplicateGlyphId { glyph_id } if glyph_id == "glyph_A"
    ));
    assert_eq!(working_source.revision(), 0);
    assert!(working_source
        .package()
        .glyphs
        .iter()
        .all(|glyph| glyph.name != "B"));

    let error = working_source
        .create_glyph(ShiftCreateGlyph {
            glyph_id: None,
            name: "B".to_string(),
            unicodes: vec!["not_hex".to_string()],
            default_layer: None,
        })
        .expect_err("invalid unicode should fail");
    assert!(matches!(
        error,
        ShiftSourceError::InvalidUnicode { glyph_name, value }
            if glyph_name == "B" && value == "not_hex"
    ));
    assert_eq!(working_source.revision(), 0);
    assert!(working_source
        .package()
        .glyphs
        .iter()
        .all(|glyph| glyph.name != "B"));

    let error = working_source
        .create_glyph(ShiftCreateGlyph {
            glyph_id: None,
            name: "B".to_string(),
            unicodes: vec!["110000".to_string()],
            default_layer: None,
        })
        .expect_err("out-of-range unicode should fail");
    assert!(matches!(
        error,
        ShiftSourceError::InvalidUnicode { glyph_name, value }
            if glyph_name == "B" && value == "110000"
    ));
    assert_eq!(working_source.revision(), 0);
    assert!(working_source
        .package()
        .glyphs
        .iter()
        .all(|glyph| glyph.name != "B"));

    let error = working_source
        .create_glyph(ShiftCreateGlyph {
            glyph_id: None,
            name: "B".to_string(),
            unicodes: vec!["0041".to_string()],
            default_layer: None,
        })
        .expect_err("duplicate unicode ownership should fail");
    assert!(matches!(
        error,
        ShiftSourceError::DuplicateUnicode {
            value,
            glyph_name,
            existing_glyph_name,
        } if value == "0041" && glyph_name == "B" && existing_glyph_name == "A"
    ));
    assert_eq!(working_source.revision(), 0);
    assert!(working_source
        .package()
        .glyphs
        .iter()
        .all(|glyph| glyph.name != "B"));
}

#[test]
fn working_source_creates_glyph_source_layer_and_rebuilds_coverage() {
    let mut package = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::from([(
                "source_Regular".to_string(),
                layer_with_line_contour(600.0),
            )]),
        }],
    );
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let mut working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let report = working_source
        .create_glyph_source_layer(
            "glyph_A",
            "source_Bold",
            ShiftCreateGlyphSourceLayer {
                layer: layer_with_line_contour(700.0),
            },
        )
        .expect("glyph source layer creation should succeed");

    assert_eq!(report.revision, 1);
    assert_eq!(report.glyph_id, "glyph_A");
    assert_eq!(report.glyph_name, "A");
    assert_eq!(report.source_id, "source_Bold");
    assert_eq!(report.source_name, "Bold");
    assert_eq!(
        report.diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::UpdateGlyph {
                glyph_id: "glyph_A".to_string(),
            }],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["glyphs/glyph_A.json".to_string()],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![
                    DEPENDENCY_INDEX_PATH.to_string(),
                    INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
                ],
            },
        }
    );

    let coverage = working_source.source_layer_coverage();
    assert_eq!(coverage[1].source_id, "source_Bold");
    assert_eq!(coverage[1].missing_layer_count, 0);
    assert!(coverage[1].complete);
    assert!(coverage[1].interpolation_compatible);
}

#[test]
fn working_source_rejects_duplicate_glyph_source_layer_without_mutating() {
    let mut working_source =
        ShiftWorkingSource::new(package_with_axes(vec![weight_axis()], Vec::new()))
            .expect("package is valid");

    let error = working_source
        .create_glyph_source_layer(
            "glyph_missing",
            "source_Regular",
            ShiftCreateGlyphSourceLayer {
                layer: empty_layer(600.0),
            },
        )
        .expect_err("missing glyph should fail before layer insertion");
    assert!(matches!(
        error,
        ShiftSourceError::MissingGlyph { glyph_id } if glyph_id == "glyph_missing"
    ));

    let mut working_source = ShiftWorkingSource::new(package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::from([("source_Regular".to_string(), empty_layer(600.0))]),
        }],
    ))
    .expect("package is valid");

    let error = working_source
        .create_glyph_source_layer(
            "glyph_A",
            "source_Regular",
            ShiftCreateGlyphSourceLayer {
                layer: empty_layer(700.0),
            },
        )
        .expect_err("existing layer should not be overwritten");

    assert!(matches!(
        error,
        ShiftSourceError::GlyphLayerAlreadyExists { glyph_id, layer_id }
            if glyph_id == "glyph_A" && layer_id == "source_Regular"
    ));
    assert_eq!(working_source.revision(), 0);
    let coverage = working_source.source_layer_coverage();
    assert_eq!(coverage[0].layer_count, 1);
    assert!(coverage[0].complete);
}

#[test]
fn working_source_rejects_invalid_glyph_source_layer_without_mutating() {
    let mut package = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::from([("source_Regular".to_string(), empty_layer(600.0))]),
        }],
    );
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let mut working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let error = working_source
        .create_glyph_source_layer(
            "glyph_A",
            "source_Bold",
            ShiftCreateGlyphSourceLayer {
                layer: layer_with_component("glyph_Missing", "Missing"),
            },
        )
        .expect_err("candidate validation should reject invalid new layer");

    assert!(matches!(
        error,
        ShiftSourceError::MissingComponentBase {
            glyph_name,
            base_glyph_id,
        } if glyph_name == "A" && base_glyph_id == "glyph_Missing"
    ));
    assert_eq!(working_source.revision(), 0);
    let coverage = working_source.source_layer_coverage();
    assert_eq!(coverage[1].source_id, "source_Bold");
    assert_eq!(coverage[1].missing_layer_count, 1);
    assert!(!coverage[1].complete);
}

#[test]
fn working_source_previews_glyph_source_layer_delete_references() {
    let mut package = package_with_compatible_two_layer_glyph();
    package.glyphs[0].variation_sources.push(ShiftGlyphSource {
        id: "glyphSource_Bold".to_string(),
        name: "Bold correction".to_string(),
        layer_id: "source_Bold".to_string(),
        location: BTreeMap::new(),
    });
    let working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let preview = working_source
        .preview_delete_glyph_source_layer("glyph_A", "source_Bold")
        .expect("glyph source layer delete should preview");

    assert_eq!(preview.glyph_id, "glyph_A");
    assert_eq!(preview.glyph_name, "A");
    assert_eq!(preview.source_id, "source_Bold");
    assert_eq!(preview.source_name, "Bold");
    assert!(!preview.can_delete_without_cascade);
    assert_eq!(
        preview.glyph_variation_source_uses,
        vec![ShiftGlyphVariationSourceUse {
            glyph_id: "glyph_A".to_string(),
            glyph_name: "A".to_string(),
            source_id: "glyphSource_Bold".to_string(),
            source_name: "Bold correction".to_string(),
            layer_id: "source_Bold".to_string(),
        }]
    );
}

#[test]
fn working_source_deletes_glyph_source_layer_with_narrow_impact() {
    let mut working_source = ShiftWorkingSource::new(package_with_compatible_two_layer_glyph())
        .expect("package is valid");

    let report = working_source
        .delete_glyph_source_layer("glyph_A", "source_Bold")
        .expect("unreferenced glyph source layer delete should succeed");

    assert_eq!(report.revision, 1);
    assert_eq!(report.glyph_id, "glyph_A");
    assert_eq!(report.glyph_name, "A");
    assert_eq!(report.source_id, "source_Bold");
    assert_eq!(report.source_name, "Bold");
    assert_eq!(
        report.diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::UpdateGlyph {
                glyph_id: "glyph_A".to_string(),
            }],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["glyphs/glyph_A.json".to_string()],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![
                    DEPENDENCY_INDEX_PATH.to_string(),
                    INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string(),
                ],
            },
        }
    );
    assert!(!working_source
        .package()
        .glyphs
        .iter()
        .find(|glyph| glyph.id == "glyph_A")
        .expect("glyph should remain")
        .layers
        .contains_key("source_Bold"));
    let coverage = working_source.source_layer_coverage();
    assert_eq!(coverage[1].source_id, "source_Bold");
    assert_eq!(coverage[1].missing_layer_count, 1);
    assert!(!coverage[1].complete);
}

#[test]
fn working_source_rejects_referenced_glyph_source_layer_delete_without_mutating() {
    let mut package = package_with_compatible_two_layer_glyph();
    package.glyphs[0].variation_sources.push(ShiftGlyphSource {
        id: "glyphSource_Bold".to_string(),
        name: "Bold correction".to_string(),
        layer_id: "source_Bold".to_string(),
        location: BTreeMap::new(),
    });
    let mut working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let error = working_source
        .delete_glyph_source_layer("glyph_A", "source_Bold")
        .expect_err("referenced glyph source layer delete should fail");

    assert!(matches!(
        error,
        ShiftSourceError::GlyphLayerHasReferences {
            glyph_id,
            layer_id,
            glyph_variation_source_use_count,
        } if glyph_id == "glyph_A"
            && layer_id == "source_Bold"
            && glyph_variation_source_use_count == 1
    ));
    assert_eq!(working_source.revision(), 0);
    assert!(working_source
        .package()
        .glyphs
        .iter()
        .find(|glyph| glyph.id == "glyph_A")
        .expect("glyph should remain")
        .layers
        .contains_key("source_Bold"));
}

#[test]
fn working_source_missing_glyph_source_layer_delete_does_not_mutate() {
    let mut working_source = ShiftWorkingSource::new(package_with_compatible_two_layer_glyph())
        .expect("package is valid");

    let error = working_source
        .delete_glyph_source_layer("glyph_A", "source_Missing")
        .expect_err("missing source should fail");
    assert!(matches!(
        error,
        ShiftSourceError::MissingSource { source_id } if source_id == "source_Missing"
    ));
    assert_eq!(working_source.revision(), 0);

    let mut package = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::from([("source_Regular".to_string(), empty_layer(600.0))]),
        }],
    );
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let mut working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let error = working_source
        .delete_glyph_source_layer("glyph_A", "source_Bold")
        .expect_err("missing layer should fail");
    assert!(matches!(
        error,
        ShiftSourceError::MissingGlyphLayer { glyph_id, layer_id }
            if glyph_id == "glyph_A" && layer_id == "source_Bold"
    ));
    assert_eq!(working_source.revision(), 0);
}

#[test]
fn working_source_creates_source_with_generated_id_and_completed_location() {
    let mut working_source =
        ShiftWorkingSource::new(package_with_axes(vec![weight_axis()], Vec::new()))
            .expect("package is valid");

    let report = working_source
        .create_source(ShiftCreateSource {
            source_id: None,
            name: "Bold".to_string(),
            location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
        })
        .expect("source creation should succeed");

    assert_eq!(report.revision, 1);
    assert_eq!(report.source_id, "source_Bold");
    assert_eq!(report.source.source_name, "Bold");
    assert_eq!(
        report.source.values.get("axis_wght"),
        Some(&ShiftSourceAxisValue {
            value: 900.0,
            source: ShiftSourceAxisValueSource::SourceLocation,
        })
    );
    assert_eq!(
        report.diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::UpdateSources],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["sources.json".to_string()],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string()],
            },
        }
    );

    assert!(working_source
        .source_locations()
        .iter()
        .any(|source| source.source_id == "source_Bold"));
}

#[test]
fn working_source_create_source_uses_new_source_for_blank_names() {
    let mut package = package_with_axes(vec![weight_axis()], Vec::new());
    package.sources.push(ShiftSource {
        id: "source_New_Source".to_string(),
        name: "New Source".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let mut working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let report = working_source
        .create_source(ShiftCreateSource {
            source_id: None,
            name: "   ".to_string(),
            location: BTreeMap::from([("axis_wght".to_string(), 700.0)]),
        })
        .expect("blank source name should use fallback");

    assert_eq!(report.revision, 1);
    assert_eq!(report.source_id, "source_New_Source_1");
    assert_eq!(report.source.source_name, "New Source.1");
}

#[test]
fn working_source_updates_source_with_narrow_impact() {
    let mut package = package_with_axes(vec![weight_axis()], Vec::new());
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let mut working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let report = working_source
        .update_source(
            "source_Bold",
            ShiftSourceUpdate {
                name: "Black".to_string(),
                location: BTreeMap::from([("axis_wght".to_string(), 800.0)]),
            },
        )
        .expect("source update should succeed");

    assert_eq!(report.revision, 1);
    assert_eq!(report.source_id, "source_Bold");
    assert_eq!(report.source.source_name, "Black");
    assert_eq!(
        report.source.values.get("axis_wght"),
        Some(&ShiftSourceAxisValue {
            value: 800.0,
            source: ShiftSourceAxisValueSource::SourceLocation,
        })
    );
    assert_eq!(
        report.diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::UpdateSources],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["sources.json".to_string()],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string()],
            },
        }
    );
}

#[test]
fn working_source_rejects_invalid_source_update_without_mutating() {
    let mut working_source =
        ShiftWorkingSource::new(package_with_axes(vec![weight_axis()], Vec::new()))
            .expect("package is valid");

    let error = working_source
        .update_source(
            "source_Regular",
            ShiftSourceUpdate {
                name: "Regular".to_string(),
                location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
            },
        )
        .expect_err("moving the default source should fail");

    assert!(matches!(
        error,
        ShiftSourceError::DefaultSourceLocationNotAtAxisDefault {
            source_id,
            axis_id,
            value,
            default,
        } if source_id == "source_Regular"
            && axis_id == "axis_wght"
            && value == 900.0
            && default == 400.0
    ));
    assert_eq!(working_source.revision(), 0);
    let regular = working_source
        .source_locations()
        .into_iter()
        .find(|source| source.source_id == "source_Regular")
        .expect("default source should remain");
    assert_eq!(
        regular.values.get("axis_wght"),
        Some(&ShiftSourceAxisValue {
            value: 400.0,
            source: ShiftSourceAxisValueSource::AxisDefault,
        })
    );

    let error = working_source
        .update_source(
            "source_Regular",
            ShiftSourceUpdate {
                name: "   ".to_string(),
                location: BTreeMap::new(),
            },
        )
        .expect_err("blank source name should fail");

    assert!(matches!(
        error,
        ShiftSourceError::InvalidSourceName { source_name } if source_name.is_empty()
    ));
    assert_eq!(working_source.revision(), 0);
}

#[test]
fn working_source_deletes_source_with_narrow_impact() {
    let mut package = package_with_axes(vec![weight_axis()], Vec::new());
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let mut working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let report = working_source
        .delete_source("source_Bold")
        .expect("unreferenced source delete should succeed");

    assert_eq!(report.revision, 1);
    assert_eq!(report.source_id, "source_Bold");
    assert_eq!(report.source_name, "Bold");
    assert_eq!(
        report.diff,
        ShiftPackageDiff {
            changes: vec![ShiftPackageChange::UpdateSources],
            impact: ShiftWriteImpact {
                canonical_paths: vec!["sources.json".to_string()],
                removed_canonical_paths: Vec::new(),
                derived_paths: vec![INTERPOLATION_COMPATIBILITY_INDEX_PATH.to_string()],
            },
        }
    );
    assert!(!working_source
        .source_locations()
        .iter()
        .any(|source| source.source_id == "source_Bold"));
}

#[test]
fn working_source_previews_delete_source_default_blocker() {
    let working_source =
        ShiftWorkingSource::new(package_with_axes(vec![weight_axis()], Vec::new()))
            .expect("package is valid");

    let preview = working_source
        .preview_delete_source("source_Regular")
        .expect("default source should preview");

    assert_eq!(preview.source_id, "source_Regular");
    assert_eq!(preview.source_name, "Regular");
    assert!(preview.is_default_source);
    assert!(preview.layer_uses.is_empty());
    assert!(preview.glyph_variation_source_uses.is_empty());
    assert!(!preview.can_delete_without_cascade);
}

#[test]
fn working_source_previews_delete_source_references() {
    let mut package = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: vec![ShiftGlyphSource {
                id: "glyphSource_Bold".to_string(),
                name: "Bold correction".to_string(),
                layer_id: "source_Bold".to_string(),
                location: BTreeMap::new(),
            }],
            layers: BTreeMap::from([
                ("source_Regular".to_string(), empty_layer(600.0)),
                ("source_Bold".to_string(), empty_layer(700.0)),
            ]),
        }],
    );
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let preview = working_source
        .preview_delete_source("source_Bold")
        .expect("referenced source should preview");

    assert_eq!(preview.source_id, "source_Bold");
    assert_eq!(preview.source_name, "Bold");
    assert!(!preview.is_default_source);
    assert!(!preview.can_delete_without_cascade);
    assert_eq!(preview.layer_uses.len(), 1);
    assert_eq!(preview.layer_uses[0].glyph_id, "glyph_A");
    assert_eq!(preview.layer_uses[0].glyph_name, "A");
    assert_eq!(preview.layer_uses[0].layer_id, "source_Bold");
    assert_eq!(preview.glyph_variation_source_uses.len(), 1);
    assert_eq!(
        preview.glyph_variation_source_uses[0].source_id,
        "glyphSource_Bold"
    );
    assert_eq!(
        preview.glyph_variation_source_uses[0].source_name,
        "Bold correction"
    );
    assert_eq!(
        preview.glyph_variation_source_uses[0].layer_id,
        "source_Bold"
    );
}

#[test]
fn working_source_previews_delete_source_unreferenced() {
    let mut package = package_with_axes(vec![weight_axis()], Vec::new());
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let preview = working_source
        .preview_delete_source("source_Bold")
        .expect("unreferenced source should preview");

    assert_eq!(preview.source_id, "source_Bold");
    assert_eq!(preview.source_name, "Bold");
    assert!(!preview.is_default_source);
    assert!(preview.layer_uses.is_empty());
    assert!(preview.glyph_variation_source_uses.is_empty());
    assert!(preview.can_delete_without_cascade);
}

#[test]
fn working_source_rejects_referenced_source_delete_without_mutating() {
    let mut package = package_with_axes(
        vec![weight_axis()],
        vec![ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: vec![ShiftGlyphSource {
                id: "glyphSource_Bold".to_string(),
                name: "Bold correction".to_string(),
                layer_id: "source_Bold".to_string(),
                location: BTreeMap::new(),
            }],
            layers: BTreeMap::from([
                ("source_Regular".to_string(), empty_layer(600.0)),
                ("source_Bold".to_string(), empty_layer(700.0)),
            ]),
        }],
    );
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
    });
    let mut working_source = ShiftWorkingSource::new(package).expect("package is valid");

    let error = working_source
        .delete_source("source_Bold")
        .expect_err("referenced source delete should fail");

    assert!(matches!(
        error,
        ShiftSourceError::SourceHasReferences {
            source_id,
            layer_use_count,
            glyph_variation_source_use_count,
        } if source_id == "source_Bold"
            && layer_use_count == 1
            && glyph_variation_source_use_count == 1
    ));
    assert_eq!(working_source.revision(), 0);
    assert!(working_source
        .source_locations()
        .iter()
        .any(|source| source.source_id == "source_Bold"));
}

#[test]
fn working_source_rejects_default_source_delete_without_mutating() {
    let mut working_source =
        ShiftWorkingSource::new(package_with_axes(vec![weight_axis()], Vec::new()))
            .expect("package is valid");

    let error = working_source
        .delete_source("source_Regular")
        .expect_err("default source delete should fail");

    assert!(matches!(
        error,
        ShiftSourceError::CannotDeleteDefaultSource { source_id } if source_id == "source_Regular"
    ));
    assert_eq!(working_source.revision(), 0);
    assert_eq!(working_source.source_locations().len(), 1);
}

#[test]
fn working_source_missing_source_delete_does_not_mutate() {
    let mut working_source =
        ShiftWorkingSource::new(package_with_axes(vec![weight_axis()], Vec::new()))
            .expect("package is valid");

    let error = working_source
        .delete_source("source_Missing")
        .expect_err("missing source delete should fail");

    assert!(matches!(
        error,
        ShiftSourceError::MissingSource { source_id } if source_id == "source_Missing"
    ));
    assert_eq!(working_source.revision(), 0);
    assert_eq!(working_source.source_locations().len(), 1);
}

fn package_with_single_source(glyphs: Vec<ShiftGlyph>) -> ShiftPackage {
    package_with_axes(Vec::new(), glyphs)
}

fn package_with_component_dependency() -> ShiftPackage {
    let layer = ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_25".to_string(),
            base_glyph_id: "glyph_A".to_string(),
            base_glyph_name: "A".to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: Vec::new(),
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    };

    package_with_single_source(vec![
        ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: vec!["0041".to_string()],
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
        ShiftGlyph {
            id: "glyph_Aacute".to_string(),
            name: "Aacute".to_string(),
            unicodes: vec!["00C1".to_string()],
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::from([("source_Regular".to_string(), layer)]),
        },
    ])
}

fn rename_base_glyph_and_component_label_cache(package: &mut ShiftPackage, new_name: &str) {
    package
        .glyphs
        .iter_mut()
        .find(|glyph| glyph.id == "glyph_A")
        .expect("base glyph should exist")
        .name = new_name.to_string();
    package
        .glyphs
        .iter_mut()
        .find(|glyph| glyph.id == "glyph_Aacute")
        .expect("dependent glyph should exist")
        .layers
        .get_mut("source_Regular")
        .expect("dependent layer should exist")
        .components[0]
        .base_glyph_name = new_name.to_string();
}

fn package_with_compatible_two_layer_glyph() -> ShiftPackage {
    let mut package = package_with_single_source(vec![ShiftGlyph {
        id: "glyph_A".to_string(),
        name: "A".to_string(),
        unicodes: vec!["0041".to_string()],
        local_axes: Vec::new(),
        variation_sources: Vec::new(),
        layers: BTreeMap::from([
            ("source_Regular".to_string(), layer_with_line_contour(600.0)),
            ("source_Bold".to_string(), layer_with_line_contour(700.0)),
        ]),
    }]);
    package.sources.push(ShiftSource {
        id: "source_Bold".to_string(),
        name: "Bold".to_string(),
        location: BTreeMap::new(),
    });
    package
}

fn layer_with_line_contour(width: f64) -> ShiftGlyphLayer {
    ShiftGlyphLayer {
        advance_width: width,
        advance_height: None,
        contours: vec![ShiftContour {
            points: vec![
                ShiftPoint {
                    x: 0.0,
                    y: 0.0,
                    point_type: ShiftPointType::OnCurve,
                    smooth: false,
                },
                ShiftPoint {
                    x: 100.0,
                    y: 0.0,
                    point_type: ShiftPointType::OnCurve,
                    smooth: false,
                },
            ],
            closed: true,
        }],
        components: Vec::new(),
        anchors: Vec::new(),
        guidelines: Vec::new(),
    }
}

fn empty_layer(width: f64) -> ShiftGlyphLayer {
    ShiftGlyphLayer {
        advance_width: width,
        advance_height: None,
        contours: Vec::new(),
        components: Vec::new(),
        anchors: Vec::new(),
        guidelines: Vec::new(),
    }
}

fn layer_with_component(base_glyph_id: &str, base_glyph_name: &str) -> ShiftGlyphLayer {
    ShiftGlyphLayer {
        advance_width: 600.0,
        advance_height: None,
        contours: Vec::new(),
        components: vec![ShiftComponent {
            id: "component_26".to_string(),
            base_glyph_id: base_glyph_id.to_string(),
            base_glyph_name: base_glyph_name.to_string(),
            transform: DecomposedTransform::identity(),
            location: BTreeMap::new(),
            axis_inheritance: ShiftAxisInheritance::InheritParent,
            variation_sources: Vec::new(),
            condition: None,
        }],
        anchors: Vec::new(),
        guidelines: Vec::new(),
    }
}

fn weight_axis() -> ShiftAxis {
    ShiftAxis {
        id: "axis_wght".to_string(),
        tag: "wght".to_string(),
        name: "Weight".to_string(),
        minimum: 100.0,
        default: 400.0,
        maximum: 900.0,
        hidden: false,
        role: ShiftAxisRole::UserFacing,
    }
}

fn internal_stem_axis() -> ShiftAxis {
    ShiftAxis {
        id: "axis_stem".to_string(),
        tag: "STEM".to_string(),
        name: "Stem".to_string(),
        minimum: 0.0,
        default: 0.0,
        maximum: 1.0,
        hidden: true,
        role: ShiftAxisRole::Internal,
    }
}

fn width_axis() -> ShiftAxis {
    ShiftAxis {
        id: "axis_wdth".to_string(),
        tag: "wdth".to_string(),
        name: "Width".to_string(),
        minimum: 50.0,
        default: 100.0,
        maximum: 200.0,
        hidden: false,
        role: ShiftAxisRole::UserFacing,
    }
}

fn package_with_weight_to_stem_mapping() -> ShiftPackage {
    let mut package = package_with_axes(vec![weight_axis(), internal_stem_axis()], Vec::new());
    package.axis_mappings = vec![ShiftAxisMapping {
        id: "mapping_weight_to_stem".to_string(),
        name: "Weight drives stem".to_string(),
        input_axes: vec!["axis_wght".to_string()],
        output_axes: vec!["axis_stem".to_string()],
        samples: vec![
            ShiftAxisMappingSample {
                input_location: BTreeMap::from([("axis_wght".to_string(), 100.0)]),
                output_location: BTreeMap::from([("axis_stem".to_string(), 0.0)]),
            },
            ShiftAxisMappingSample {
                input_location: BTreeMap::from([("axis_wght".to_string(), 900.0)]),
                output_location: BTreeMap::from([("axis_stem".to_string(), 1.0)]),
            },
        ],
    }];
    package
}

fn glyphs_for_component_layer(layer: ShiftGlyphLayer) -> Vec<ShiftGlyph> {
    vec![
        ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::from([("source_Regular".to_string(), layer)]),
        },
        ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
    ]
}

fn glyphs_for_component_layer_with_local_base(layer: ShiftGlyphLayer) -> Vec<ShiftGlyph> {
    vec![
        ShiftGlyph {
            id: "glyph_A".to_string(),
            name: "A".to_string(),
            unicodes: Vec::new(),
            local_axes: Vec::new(),
            variation_sources: Vec::new(),
            layers: BTreeMap::from([("source_Regular".to_string(), layer)]),
        },
        ShiftGlyph {
            id: "glyph_stem".to_string(),
            name: "stem".to_string(),
            unicodes: Vec::new(),
            local_axes: vec![ShiftGlyphAxis {
                id: "axis_stemWidth".to_string(),
                name: "Stem Width".to_string(),
                minimum: 20.0,
                default: 40.0,
                maximum: 80.0,
            }],
            variation_sources: Vec::new(),
            layers: BTreeMap::new(),
        },
    ]
}

fn package_with_axes(axes: Vec<ShiftAxis>, glyphs: Vec<ShiftGlyph>) -> ShiftPackage {
    ShiftPackage {
        manifest: ShiftManifest {
            format: SHIFT_SOURCE_FORMAT.to_string(),
            version: SHIFT_SOURCE_VERSION,
            family_id: "family_Spike_Sans".to_string(),
            default_source_id: Some("source_Regular".to_string()),
        },
        font: ShiftFontInfo {
            metadata: FontMetadata::with_names("Spike Sans".to_string(), "Regular".to_string()),
            metrics: FontMetrics::default(),
        },
        axes,
        sources: vec![ShiftSource {
            id: "source_Regular".to_string(),
            name: "Regular".to_string(),
            location: BTreeMap::new(),
        }],
        axis_mappings: Vec::new(),
        glyphs,
    }
}
