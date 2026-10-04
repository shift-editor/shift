use crate::{
    test_support::sample_variable_font, Axis, AxisKind, CoreError, DesignLocation, Font, Source,
};

#[test]
fn axis_edit_cannot_strand_a_master_and_failed_replacement_preserves_the_font() {
    let mut font = Font::new();
    let axis = Axis::weight();
    font.add_axis(axis.clone()).unwrap();
    let mut location = DesignLocation::new();
    location.set(axis.id(), 900.0);
    font.add_source(Source::new("Black".to_string(), location));
    let before = font.clone();
    let replacement = Axis::with_id(
        axis.id(),
        "wght".to_string(),
        "Weight".to_string(),
        100.0,
        400.0,
        700.0,
    );
    assert!(
        matches!(font.replace_axis(replacement), Err(CoreError::InvalidAxis { message, .. }) if message.contains("Black"))
    );
    assert_eq!(font, before);
}

#[test]
fn default_origin_is_preserved_for_both_explicit_and_implicit_master_coordinates() {
    for explicit in [false, true] {
        let mut font = Font::new();
        let axis = Axis::weight();
        font.add_axis(axis.clone()).unwrap();
        if explicit {
            let mut location = DesignLocation::new();
            location.set(axis.id(), 400.0);
            let source_id = font.default_source_id().unwrap();
            font.source_mut(source_id).unwrap().set_location(location);
        }
        let before = font.clone();
        let replacement = Axis::with_id(
            axis.id(),
            "wght".to_string(),
            "Weight".to_string(),
            100.0,
            500.0,
            900.0,
        );
        assert!(
            matches!(font.replace_axis(replacement), Err(CoreError::InvalidAxis { message, .. }) if message.contains("origin"))
        );
        assert_eq!(font, before);
    }
}

#[test]
fn a_small_default_shift_is_still_an_origin_change() {
    let mut font = Font::new();
    let axis = Axis::new("TEST".to_string(), "Small".to_string(), 0.0, 1e-8, 1e-7);
    font.add_axis(axis.clone()).unwrap();
    let before = font.clone();
    let replacement = Axis::with_id(
        axis.id(),
        "TEST".to_string(),
        "Small".to_string(),
        0.0,
        2e-8,
        1e-7,
    );
    assert!(matches!(
        font.replace_axis(replacement),
        Err(CoreError::InvalidAxis { .. })
    ));
    assert_eq!(font, before);
}

#[test]
fn range_expansion_does_not_relocate_masters_or_layer_only_sources() {
    let mut font = Font::new();
    let axis = Axis::weight();
    font.add_axis(axis.clone()).unwrap();
    let mut background = Source::layer("Background".to_string());
    let mut location = DesignLocation::new();
    location.set(axis.id(), 2000.0);
    background.set_location(location);
    font.add_source(background);
    let before = font.clone();
    let replacement = Axis::with_id(
        axis.id(),
        "wght".to_string(),
        "Weight".to_string(),
        0.0,
        400.0,
        1000.0,
    );
    font.replace_axis(replacement).unwrap();
    assert_eq!(font.sources(), before.sources());
    assert_eq!(font.axis(axis.id()).unwrap().minimum(), 0.0);
    assert_eq!(font.axis(axis.id()).unwrap().maximum(), 1000.0);
}

#[test]
fn mapped_ranges_require_mapping_authoring_but_renames_preserve_design_locations() {
    let mut font = sample_variable_font();
    let axis = font.axes()[0].clone();
    let before = font.clone();
    let mut replacement = axis.clone();
    replacement.set_kind(AxisKind::Continuous {
        minimum: 100.0,
        default: 400.0,
        maximum: 1000.0,
    });
    assert!(
        matches!(font.replace_axis(replacement), Err(CoreError::InvalidAxis { message, .. }) if message.contains("mapping authoring"))
    );
    assert_eq!(font, before);
    let mut renamed = Axis::with_id(
        axis.id(),
        "WGHT".to_string(),
        "Mass".to_string(),
        axis.minimum(),
        axis.default(),
        axis.maximum(),
    );
    renamed.set_labels(axis.labels().to_vec());
    font.replace_axis(renamed).unwrap();
    assert_eq!(font.sources(), before.sources());
    assert_eq!(font.named_instances(), before.named_instances());
    assert_eq!(font.axis_mappings(), before.axis_mappings());
    assert_eq!(font.axis(axis.id()).unwrap().tag(), "WGHT");
}

#[test]
fn axis_tag_uniqueness_is_owned_by_the_model_not_the_cli() {
    let mut font = Font::new();
    let axis = Axis::weight();
    font.add_axis(axis.clone()).unwrap();
    font.add_axis(Axis::width()).unwrap();
    let before = font.clone();
    let replacement = Axis::with_id(
        axis.id(),
        "wdth".to_string(),
        "Weight".to_string(),
        100.0,
        400.0,
        900.0,
    );
    assert!(matches!(
        font.replace_axis(replacement),
        Err(CoreError::DuplicateAxisTag(_))
    ));
    assert_eq!(font, before);
}
