//! Property tests of the rules that axis normalization, axis maps, component
//! transforms and interpolation share: each property holds for every input
//! proptest generates, and a failure shrinks to the smallest case it finds.

use proptest::prelude::*;
use shift_font::{
    Axis, AxisRange, Contour, DecomposedTransform, DesignLocation, Font, Glyph, GlyphLayer,
    LayerId, PointType, Source, SourceId, Transform, kurbo, piecewise_map,
};

/// A finite coordinate, sometimes exactly zero or negative zero.
fn coordinate() -> impl Strategy<Value = f64> {
    prop_oneof![
        8 => -10_000.0..10_000.0f64,
        1 => Just(0.0),
        1 => Just(-0.0),
    ]
}

/// The distance from an axis's default to one of its ends, sometimes none.
fn extent() -> impl Strategy<Value = f64> {
    prop_oneof![
        1 => Just(0.0),
        4 => 0.001..10_000.0f64,
    ]
}

fn axis_range() -> impl Strategy<Value = AxisRange> {
    (coordinate(), extent(), extent()).prop_map(|(default, below, above)| AxisRange {
        minimum: default - below,
        default,
        maximum: default + above,
    })
}

/// A tolerance for comparing values computed on a range of this size.
fn tolerance(range: &AxisRange) -> f64 {
    1e-9 * (1.0 + range.minimum.abs() + range.maximum.abs())
}

proptest! {
    #[test]
    fn axis_range_sends_its_ends_to_minus_one_zero_and_one(range in axis_range()) {
        prop_assert_eq!(range.normalize(range.default), 0.0);
        if range.minimum < range.default {
            prop_assert_eq!(range.normalize(range.minimum), -1.0);
        }
        if range.maximum > range.default {
            prop_assert_eq!(range.normalize(range.maximum), 1.0);
        }
    }

    #[test]
    fn axis_range_sends_a_side_without_extent_to_zero(
        range in axis_range(),
        beyond in 0.0..1_000.0f64,
    ) {
        if range.minimum == range.default {
            prop_assert_eq!(range.normalize(range.default - beyond), 0.0);
        }
        if range.maximum == range.default {
            prop_assert_eq!(range.normalize(range.default + beyond), 0.0);
        }
    }

    #[test]
    fn axis_range_normalizes_monotonically(
        range in axis_range(),
        a in 0.0..=1.0f64,
        b in 0.0..=1.0f64,
    ) {
        let span = range.maximum - range.minimum;
        let (low, high) = (a.min(b), a.max(b));
        let (low, high) = (range.minimum + low * span, range.minimum + high * span);
        prop_assert!(
            range.normalize(low) <= range.normalize(high),
            "{low} -> {}, {high} -> {}",
            range.normalize(low),
            range.normalize(high)
        );
    }

    #[test]
    fn axis_range_denormalizes_what_it_normalizes(range in axis_range(), t in 0.0..=1.0f64) {
        let value = range.minimum + t * (range.maximum - range.minimum);
        let round_trip = range.denormalize(range.normalize(value));
        prop_assert!(
            (round_trip - value).abs() <= tolerance(&range),
            "{value} -> {} -> {round_trip}",
            range.normalize(value)
        );
    }

    #[test]
    fn axis_range_normalizes_what_it_denormalizes(range in axis_range(), t in 0.0..=1.0f64) {
        // Each side with extent, at the same fraction of the way to its end.
        let sides = [(range.minimum < range.default, -t), (range.maximum > range.default, t)];
        for (has_extent, t) in sides {
            if !has_extent {
                continue;
            }
            let round_trip = range.normalize(range.denormalize(t));
            prop_assert!((round_trip - t).abs() <= 1e-9, "{t} -> {round_trip}");
        }
    }
}

/// Map points sorted by input, with distinct inputs and non-decreasing outputs.
fn increasing_map() -> impl Strategy<Value = Vec<(f64, f64)>> {
    (
        coordinate(),
        coordinate(),
        prop::collection::vec((0.001..1_000.0f64, 0.0..1_000.0f64), 0..6),
    )
        .prop_map(|(input, output, steps)| {
            let mut points = vec![(input, output)];
            for (dx, dy) in steps {
                let (x, y) = *points.last().expect("a first point");
                points.push((x + dx, y + dy));
            }
            points
        })
}

proptest! {
    #[test]
    fn piecewise_map_passes_through_its_points(points in increasing_map()) {
        for &(input, output) in &points {
            let mapped = piecewise_map(input, &points);
            prop_assert!(
                (mapped - output).abs() <= 1e-9 * (1.0 + output.abs() + input.abs()),
                "{input} maps to {mapped}, not {output}"
            );
        }
    }

    #[test]
    fn piecewise_map_is_monotonic_over_increasing_points(
        points in increasing_map(),
        a in -20_000.0..20_000.0f64,
        b in -20_000.0..20_000.0f64,
    ) {
        let (low, high) = (a.min(b), a.max(b));
        let (low_mapped, high_mapped) = (piecewise_map(low, &points), piecewise_map(high, &points));
        let slack = 1e-9 * (1.0 + low_mapped.abs() + high_mapped.abs());
        prop_assert!(
            low_mapped <= high_mapped + slack,
            "{low} -> {low_mapped}, {high} -> {high_mapped}"
        );
    }
}

fn matrix() -> impl Strategy<Value = Transform> {
    prop::array::uniform6(-100.0..100.0f64).prop_map(Transform::from_values)
}

fn point() -> impl Strategy<Value = kurbo::Point> {
    (coordinate(), coordinate()).prop_map(|(x, y)| kurbo::Point::new(x, y))
}

fn close(a: kurbo::Point, b: kurbo::Point, scale: f64) -> bool {
    (a - b).hypot() <= 1e-9 * (1.0 + scale)
}

proptest! {
    #[test]
    fn composing_transforms_applies_the_inner_one_first(
        outer in matrix(),
        inner in matrix(),
        point in point(),
    ) {
        let composed = outer.compose(inner).transform_point(point);
        let sequential = outer.transform_point(inner.transform_point(point));
        let scale = sequential.to_vec2().hypot() + 1e4 * 1e4;
        prop_assert!(close(composed, sequential, scale), "{composed:?} != {sequential:?}");
    }

    /// A matrix decomposed into translate, rotate, scale and skew composes
    /// back to the same matrix, as importing a UFO component matrix needs.
    #[test]
    #[ignore = "finding: DecomposedTransform::from_matrix drops a skew (spike note)"]
    fn decomposing_a_matrix_composes_back_to_it(
        matrix in matrix(),
        point in point(),
    ) {
        let determinant = matrix.xx * matrix.yy - matrix.xy * matrix.yx;
        prop_assume!(determinant.abs() > 1e-3);

        let rebuilt = DecomposedTransform::from_matrix(&matrix).to_matrix();
        let (expected, actual) = (matrix.transform_point(point), rebuilt.transform_point(point));
        prop_assert!(
            close(expected, actual, expected.to_vec2().hypot() + 1e6),
            "{matrix:?} rebuilds as {rebuilt:?}"
        );
    }
}

/// The smallest case of the decomposition finding: an italic slant, as a
/// UFO component or a slanted layer carries it.
#[test]
#[ignore = "finding: DecomposedTransform::from_matrix drops a skew (spike note)"]
fn a_slanted_matrix_keeps_its_slant() {
    let slant = Transform::from_values([1.0, 0.0, 0.2, 1.0, 0.0, 0.0]);
    let rebuilt = DecomposedTransform::from_matrix(&slant).to_matrix();
    let top = kurbo::Point::new(0.0, 100.0);

    assert_eq!(slant.transform_point(top), kurbo::Point::new(20.0, 100.0));
    assert_eq!(
        rebuilt.transform_point(top),
        slant.transform_point(top),
        "{rebuilt:?}"
    );
}

/// A square whose size and position differ per master, so a master that
/// interpolates to anything but itself shows in every coordinate.
fn square(source_id: SourceId, index: usize) -> GlyphLayer {
    let size = 100.0 + 37.0 * index as f64;
    let origin = 11.0 * index as f64;
    let mut layer = GlyphLayer::with_width(LayerId::new(), source_id, size + 50.0);
    let mut contour = Contour::new();
    for (x, y) in [(0.0, 0.0), (0.0, size), (size, size), (size, 0.0)] {
        contour.add_point(origin + x, origin + y, PointType::OnCurve, false);
    }
    contour.close();
    layer.add_contour(contour);
    layer
}

fn points(layer: &GlyphLayer) -> Vec<kurbo::Point> {
    layer
        .contours_iter()
        .flat_map(|contour| contour.points().iter().map(shift_font::Point::position))
        .collect()
}

/// One coordinate of a master: the axis's minimum, default or maximum, or a
/// fraction of the way between its minimum and maximum.
#[derive(Clone, Copy, Debug)]
enum Place {
    Minimum,
    Default,
    Maximum,
    Between(f64),
}

fn place() -> impl Strategy<Value = Place> {
    prop_oneof![
        Just(Place::Minimum),
        Just(Place::Default),
        Just(Place::Maximum),
        (0.05..0.95f64).prop_map(Place::Between),
    ]
}

#[derive(Clone, Debug)]
struct AxisSetup {
    minimum: f64,
    default: f64,
    maximum: f64,
}

fn axis_setup() -> impl Strategy<Value = AxisSetup> {
    (
        -1_000.0..1_000.0f64,
        1.0..1_000.0f64,
        0..3usize,
        0.1..0.9f64,
    )
        .prop_map(|(minimum, extent, at, fraction)| {
            let maximum = minimum + extent;
            let default = match at {
                0 => minimum,
                1 => maximum,
                _ => minimum + fraction * extent,
            };
            AxisSetup {
                minimum,
                default,
                maximum,
            }
        })
}

impl AxisSetup {
    fn at(&self, place: Place) -> f64 {
        match place {
            Place::Minimum => self.minimum,
            Place::Default => self.default,
            Place::Maximum => self.maximum,
            Place::Between(fraction) => self.minimum + fraction * (self.maximum - self.minimum),
        }
    }
}

fn masters_setup() -> impl Strategy<Value = (Vec<AxisSetup>, Vec<Vec<Place>>)> {
    (1..=2usize).prop_flat_map(|axes| {
        (
            prop::collection::vec(axis_setup(), axes),
            prop::collection::vec(prop::collection::vec(place(), axes), 0..5),
        )
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(128))]

    #[test]
    fn every_master_interpolates_to_itself((axes, places) in masters_setup()) {
        let mut font = Font::new();
        let tags = ["wght", "wdth"];
        let mut ids = Vec::new();
        for (setup, tag) in axes.iter().zip(tags) {
            let axis = Axis::new(tag.into(), tag.into(), setup.minimum, setup.default, setup.maximum);
            ids.push(axis.id());
            font.add_axis(axis).expect("a valid axis");
        }

        let mut locations: Vec<Vec<f64>> = vec![axes.iter().map(|axis| axis.default).collect()];
        for master in &places {
            let location: Vec<f64> = axes.iter().zip(master).map(|(axis, place)| axis.at(*place)).collect();
            if !locations.contains(&location) {
                locations.push(location);
            }
        }

        let default_id = font.default_source_id().expect("a default source");
        let mut glyph = Glyph::new("square");
        let mut masters = Vec::new();
        for (index, values) in locations.iter().enumerate() {
            let location: DesignLocation = ids.iter().copied().zip(values.iter().copied()).collect();
            let source_id = if index == 0 {
                font.source_mut(default_id).expect("the default source").set_location(location);
                default_id
            } else {
                font.add_source(Source::new(format!("Master {index}"), location))
            };
            let layer = square(source_id, index);
            masters.push((source_id, layer.clone()));
            glyph.set_layer(layer);
        }
        font.insert_glyph(glyph).expect("a new glyph");

        let glyph = font.glyph_by_name("square").expect("the glyph");
        let interpolation = font
            .glyph_interpolation(glyph.id())
            .expect("an interpolation")
            .expect("compatible masters");
        for (source_id, expected) in masters {
            let source = font.source(source_id).expect("the source");
            let resolved = interpolation
                .resolve(source.location(), font.axes())
                .expect("resolves at a master");
            prop_assert!(
                (resolved.width() - expected.width()).abs() <= 1e-6,
                "{} at {:?}: width {} instead of {}",
                source.name(),
                source.location(),
                resolved.width(),
                expected.width()
            );
            for (actual, wanted) in points(&resolved).into_iter().zip(points(&expected)) {
                prop_assert!(
                    (actual - wanted).hypot() <= 1e-6,
                    "{} at {:?}: point {actual:?} instead of {wanted:?}",
                    source.name(),
                    source.location()
                );
            }
        }
    }
}
