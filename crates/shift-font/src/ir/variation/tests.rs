use super::*;
use crate::{AxisId, AxisMappingPoint};

const WEIGHT: AxisRange = AxisRange {
    minimum: 100.0,
    default: 400.0,
    maximum: 900.0,
};

#[test]
fn axis_range_maps_its_bounds_to_minus_one_zero_and_one() {
    assert_eq!(WEIGHT.normalize(100.0), -1.0);
    assert_eq!(WEIGHT.normalize(400.0), 0.0);
    assert_eq!(WEIGHT.normalize(900.0), 1.0);
    assert_eq!(WEIGHT.normalize(250.0), -0.5);
    assert_eq!(WEIGHT.normalize(650.0), 0.5);
}

#[test]
fn axis_range_with_no_extent_on_one_side_keeps_a_value_there_finite() {
    let one_sided = AxisRange {
        minimum: 400.0,
        default: 400.0,
        maximum: 900.0,
    };

    // fontdrasil keeps the value's distance from the default, as fontTools
    // extrapolates; region evaluation clamps it.
    assert_eq!(one_sided.normalize(300.0), -100.0);
    assert_eq!(one_sided.normalize(900.0), 1.0);
}

#[test]
fn axis_range_extrapolates_outside_it_as_fonttools_does_without_clamping() {
    assert_eq!(WEIGHT.normalize(1400.0), 501.0);
    assert_eq!(WEIGHT.normalize(-200.0), -301.0);
}

#[test]
fn axis_range_that_runs_backwards_normalizes_in_its_own_direction() {
    let reversed = AxisRange {
        minimum: 900.0,
        default: 400.0,
        maximum: 100.0,
    };

    assert_eq!(reversed.normalize(900.0), -1.0);
    assert_eq!(reversed.normalize(650.0), -0.5);
    assert_eq!(reversed.normalize(100.0), 1.0);
    assert_eq!(reversed.denormalize(-1.0), 900.0);
    assert_eq!(reversed.denormalize(1.0), 100.0);
}

#[test]
fn axis_range_snaps_rounding_error_to_the_default_and_bounds() {
    assert_eq!(WEIGHT.normalize(400.0 + 1e-10), 0.0);
    assert_eq!(WEIGHT.normalize(900.0 - 1e-10), 1.0);
    assert_eq!(WEIGHT.normalize(100.0 + 1e-10), -1.0);
    assert!(WEIGHT.normalize(400.0 + 1e-3) > 0.0);
}

#[test]
fn maps_independent_axes_before_cross_axis_mappings() {
    let weight = Axis::weight();
    let width = Axis::width();
    let mut optical = Axis::continuous_with_id(
        AxisId::new(),
        "opsz".to_string(),
        "Optical size".to_string(),
        8.0,
        12.0,
        72.0,
    );
    optical.set_role(AxisRole::Internal);
    let axes = vec![weight.clone(), width.clone(), optical.clone()];

    let independent = AxisMapping::new(
        "Weight curve".to_string(),
        vec![weight.id()],
        vec![weight.id()],
        vec![
            point(&[(weight.id(), 100.0)], &[(weight.id(), 100.0)]),
            point(&[(weight.id(), 400.0)], &[(weight.id(), 400.0)]),
            point(&[(weight.id(), 900.0)], &[(weight.id(), 800.0)]),
        ],
    );
    let cross = AxisMapping::new(
        "Optical compensation".to_string(),
        vec![weight.id(), width.id()],
        vec![optical.id()],
        vec![point(
            &[(weight.id(), 800.0), (width.id(), 125.0)],
            &[(optical.id(), 72.0)],
        )],
    );

    let external = external_location(&[
        (weight.id(), 900.0),
        (width.id(), 125.0),
        (optical.id(), 40.0),
    ]);
    let mapped = map_location(&external, &axes, &[independent, cross]).unwrap();

    assert!((mapped.get(&weight.id()).unwrap() - 800.0).abs() < 0.001);
    assert!((mapped.get(&width.id()).unwrap() - 125.0).abs() < 0.001);
    assert!((mapped.get(&optical.id()).unwrap() - 72.0).abs() < 0.001);
}

#[test]
fn design_normalization_anchors_the_user_ends_for_reversed_and_nonmonotonic_mappings() {
    // As fontdrasil normalizes: -1 and 1 sit at the design values of the
    // user minimum and maximum, not at the design extremes.
    for (points, minimum, default, maximum) in [
        (
            vec![(100.0, 900.0), (400.0, 400.0), (900.0, 100.0)],
            900.0,
            400.0,
            100.0,
        ),
        (
            vec![(100.0, 30.0), (400.0, 86.0), (700.0, 180.0), (900.0, 160.0)],
            30.0,
            86.0,
            160.0,
        ),
    ] {
        let mut font = Font::empty();
        let axis = Axis::weight();
        font.add_axis(axis.clone()).unwrap();
        font.set_axis_mappings(vec![AxisMapping::new(
            "Weight mapping".to_string(),
            vec![axis.id()],
            vec![axis.id()],
            points
                .into_iter()
                .map(|(input, output)| point(&[(axis.id(), input)], &[(axis.id(), output)]))
                .collect(),
        )])
        .unwrap();
        let normalization = font.design_normalization().unwrap();
        let range = normalization[0].range;
        assert!((range.minimum - minimum).abs() < 1e-9);
        assert!((range.default - default).abs() < 1e-9);
        assert!((range.maximum - maximum).abs() < 1e-9);
        assert!((normalization[0].normalize(minimum) + 1.0).abs() < 1e-9);
        assert!(normalization[0].normalize(default).abs() < 1e-9);
        assert!((normalization[0].normalize(maximum) - 1.0).abs() < 1e-9);
    }
}

#[test]
fn design_normalization_keeps_unmapped_and_internal_axis_bounds() {
    let mut font = Font::empty();
    let weight = Axis::weight();
    let mut width = Axis::width();
    width.set_role(AxisRole::Internal);
    font.add_axis(weight.clone()).unwrap();
    font.add_axis(width.clone()).unwrap();
    let normalization = font.design_normalization().unwrap();
    for (axis, normalization) in [weight, width].iter().zip(normalization) {
        assert_eq!(normalization.axis_id, axis.id());
        assert_eq!(normalization.range, axis.kind().range());
    }
}

#[test]
fn one_sided_axes_merge_equivalent_normalized_mapping_points() {
    let axis = Axis::with_id(
        AxisId::from_raw("one-sided"),
        "wght".to_string(),
        "Weight".to_string(),
        300.0,
        300.0,
        800.0,
    );
    let mapping = AxisMapping::new(
        "Weight curve".to_string(),
        vec![axis.id()],
        vec![axis.id()],
        vec![
            point(&[(axis.id(), 300.0)], &[(axis.id(), 300.0)]),
            point(&[(axis.id(), 300.0)], &[(axis.id(), 300.0)]),
            point(&[(axis.id(), 800.0)], &[(axis.id(), 800.0)]),
        ],
    );

    let basis = AxisMappingBasis::try_from((&mapping, [axis].as_slice())).unwrap();

    assert_eq!(basis.basis().deltas().len(), 2);
}

#[test]
fn unmapping_recovers_the_external_controls_a_mapping_took() {
    let weight = Axis::weight();
    let width = Axis::width();
    let mut optical = Axis::continuous_with_id(
        AxisId::new(),
        "opsz".to_string(),
        "Optical size".to_string(),
        8.0,
        12.0,
        72.0,
    );
    optical.set_role(AxisRole::Internal);
    let axes = vec![weight.clone(), width.clone(), optical.clone()];
    let mappings = [
        AxisMapping::new(
            "Weight curve".to_string(),
            vec![weight.id()],
            vec![weight.id()],
            vec![
                point(&[(weight.id(), 100.0)], &[(weight.id(), 100.0)]),
                point(&[(weight.id(), 400.0)], &[(weight.id(), 400.0)]),
                point(&[(weight.id(), 700.0)], &[(weight.id(), 520.0)]),
                point(&[(weight.id(), 900.0)], &[(weight.id(), 800.0)]),
            ],
        ),
        AxisMapping::new(
            "Optical compensation".to_string(),
            vec![weight.id(), width.id()],
            vec![optical.id()],
            vec![point(
                &[(weight.id(), 800.0), (width.id(), 125.0)],
                &[(optical.id(), 72.0)],
            )],
        ),
    ];
    let bases: Vec<AxisMappingBasis> = mappings
        .iter()
        .map(|mapping| AxisMappingBasis::try_from((mapping, axes.as_slice())).unwrap())
        .collect();

    for (controlled_weight, controlled_width) in [
        (100.0, 75.0),
        (250.0, 100.0),
        (650.0, 110.0),
        (900.0, 125.0),
    ] {
        let external = external_location(&[
            (weight.id(), controlled_weight),
            (width.id(), controlled_width),
        ]);
        let design = map_location_with_bases(&external, &axes, &bases).unwrap();

        let recovered = unmap_location_with_bases(&design, &axes, &bases);

        assert!((recovered.value_on(&weight) - controlled_weight).abs() < 1e-9);
        assert!((recovered.value_on(&width) - controlled_width).abs() < 1e-9);
        assert_eq!(recovered.get(&optical.id()), None);
    }
}

#[test]
fn an_axis_no_mapping_outputs_keeps_its_design_value() {
    let mut axis = Axis::discrete_with_id(
        AxisId::from_raw("ital"),
        "ital".to_string(),
        "Italic".to_string(),
        vec![0.0, 1.0],
        0.0,
    );
    axis.set_role(AxisRole::External);
    let design = DesignLocation::from([(axis.id(), 0.8)]);

    let recovered = unmap_location_with_bases(&design, std::slice::from_ref(&axis), &[]);

    assert_eq!(recovered.get(&axis.id()), Some(0.8));
}

#[test]
fn external_locations_cannot_set_internal_axes_directly() {
    let mut optical = Axis::continuous_with_id(
        AxisId::new(),
        "opsz".to_string(),
        "Optical size".to_string(),
        8.0,
        12.0,
        72.0,
    );
    optical.set_role(AxisRole::Internal);
    let external = external_location(&[(optical.id(), 40.0)]);

    let mapped = map_location(&external, &[optical.clone()], &[]).unwrap();

    assert_eq!(mapped.get(&optical.id()), Some(12.0));
}

fn point(input: &[(AxisId, f64)], output: &[(AxisId, f64)]) -> AxisMappingPoint {
    AxisMappingPoint {
        description: None,
        input: location(input),
        output: location(output),
    }
}

fn external_location(values: &[(AxisId, f64)]) -> ExternalLocation {
    ExternalLocation::from_untyped(location(values))
}

fn location(values: &[(AxisId, f64)]) -> Location {
    let location: Location = values
        .iter()
        .map(|(axis_id, value)| (*axis_id, *value))
        .collect();
    location
}
