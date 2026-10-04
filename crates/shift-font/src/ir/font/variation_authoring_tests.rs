use crate::{
    test_support::sample_variable_font, Axis, AxisId, CoreError, DesignLocation, FontChange,
    SourceId,
};

#[test]
fn restoring_axis_deletion_preserves_collapsed_sources_and_all_glyph_geometry() {
    let mut font = sample_variable_font();
    font.add_axis(Axis::width()).unwrap();
    let before = font.clone();
    let mut deleted = before.clone();
    deleted.remove_axis(before.axes()[0].id()).unwrap();

    let changes = font
        .restore_variation_authoring(deleted.variation_authoring())
        .unwrap();
    assert_eq!(font, deleted);
    assert_eq!(font.sources().len(), 3);
    assert_eq!(font.axes().len(), 1);
    assert_eq!(font.axes()[0].tag(), "wdth");
    assert_eq!(
        font.glyphs().collect::<Vec<_>>(),
        before.glyphs().collect::<Vec<_>>()
    );
    assert!(changes
        .changes
        .iter()
        .any(|change| matches!(change, FontChange::AxisDeleted(_))));

    font.restore_variation_authoring(before.variation_authoring())
        .unwrap();
    assert_eq!(font, before);
}

#[test]
fn malformed_structural_snapshots_fail_before_changing_any_font_data() {
    let mut font = sample_variable_font();
    let before = font.clone();
    for case in 0..6 {
        let mut target = before.variation_authoring();
        match case {
            0 => target.sources.push(target.sources[0].clone()),
            1 => target.axes.push(target.axes[0].clone()),
            2 => target.default_source_id = Some(SourceId::from_raw("missing")),
            3 => {
                let mut location = DesignLocation::new();
                location.set(AxisId::from_raw("missing"), 400.0);
                target.sources[0].set_location(location);
            }
            4 => {
                let mut location = DesignLocation::new();
                location.set(target.axes[0].id(), f64::NAN);
                target.sources[0].set_location(location);
            }
            5 => target.sources[0].set_line_gap(Some(f64::INFINITY)),
            _ => unreachable!(),
        }
        let error = font.restore_variation_authoring(target).unwrap_err();
        match case {
            0 => assert!(matches!(error, CoreError::DuplicateSourceId(_))),
            1 => assert!(matches!(
                error,
                CoreError::InvalidEntityOrder { kind: "axis", .. }
            )),
            2 => assert!(matches!(error, CoreError::SourceNotFound(_))),
            3 => assert!(matches!(error, CoreError::AxisNotFound(_))),
            4 | 5 => assert!(matches!(error, CoreError::InvalidSourceName(_))),
            _ => unreachable!(),
        }
        assert_eq!(font, before);
    }
}

#[test]
fn a_snapshot_is_owned_and_does_not_change_when_the_font_changes() {
    let mut font = sample_variable_font();
    let snapshot = font.variation_authoring();
    let original = snapshot.named_instances.clone();
    font.remove_named_instance(original[0].id()).unwrap();
    assert_eq!(snapshot.named_instances, original);
    assert!(font.named_instances().is_empty());
    font.restore_variation_authoring(snapshot).unwrap();
    assert_eq!(font.named_instances(), original);
}
