//! Axis mappings and interpolation agree with fontdrasil, which fontc uses
//! to compile the exported font, so the editor previews what ships.

use shift_font::{
    Axis, AxisId, AxisMapping, AxisMappingPoint, Contour, DesignLocation, ExternalLocation, Font,
    Glyph, GlyphLayer, LayerId, Location, PointType, Source, SourceId,
};

fn mapping(axis: AxisId, points: &[(f64, f64)]) -> AxisMapping {
    AxisMapping::new(
        "Weight mapping".to_string(),
        vec![axis],
        vec![axis],
        points
            .iter()
            .map(|(user, design)| AxisMappingPoint {
                description: None,
                input: Location::from([(axis, *user)]),
                output: Location::from([(axis, *design)]),
            })
            .collect(),
    )
}

/// A one-axis font whose user range is `minimum..=maximum` around `default`.
fn weight_font(minimum: f64, default: f64, maximum: f64, points: &[(f64, f64)]) -> (Font, AxisId) {
    let mut font = Font::new();
    let axis = Axis::new("wght".into(), "Weight".into(), minimum, default, maximum);
    let axis_id = axis.id();
    font.add_axis(axis).unwrap();
    font.set_axis_mappings(vec![mapping(axis_id, points)])
        .unwrap();
    (font, axis_id)
}

fn design_at(font: &Font, axis: AxisId, user: f64) -> f64 {
    let external = ExternalLocation::from([(axis, user)]);
    font.mapped_location(&external).unwrap().get(&axis).unwrap()
}

fn square(source_id: SourceId, size: f64) -> GlyphLayer {
    let mut layer = GlyphLayer::with_width(LayerId::new(), source_id, size + 100.0);
    let mut contour = Contour::new();
    for (x, y) in [(0.0, 0.0), (0.0, size), (size, size), (size, 0.0)] {
        contour.add_point(x, y, PointType::OnCurve, false);
    }
    contour.close();
    layer.add_contour(contour);
    layer
}

#[test]
fn design_values_below_a_minimum_default_keep_their_range() {
    // Glyphs sources whose default master is the lightest, with stem widths
    // as design values: the design values all sit below the user default.
    let (font, axis) = weight_font(300.0, 300.0, 700.0, &[(300.0, 62.0), (700.0, 158.0)]);

    let normalization = &font.design_normalization().unwrap()[0];
    assert_eq!(
        (
            normalization.minimum,
            normalization.default,
            normalization.maximum
        ),
        (62.0, 62.0, 158.0)
    );
    assert!((design_at(&font, axis, 500.0) - 110.0).abs() < 1e-9);
}

#[test]
fn a_value_a_rounding_error_past_the_axis_end_maps_to_the_end() {
    let (font, axis) = weight_font(
        100.0,
        400.0,
        900.0,
        &[(100.0, 30.0), (400.0, 86.0), (900.0, 180.0)],
    );

    assert!((design_at(&font, axis, 900.0 + 1e-12) - 180.0).abs() < 1e-6);
}

#[test]
fn a_default_master_reached_through_a_fractional_mapping_interpolates_to_itself() {
    // The mapped default lands a rounding error away from the default master.
    let points = [
        (-3.770919534716331, 1.5053288752212395),
        (1.0, 1.5424588859054178),
        (2.0, 1.5682032509525166),
    ];
    let (mut font, axis) = weight_font(-3.770919534716331, 2.0, 2.0, &points);

    let default_id = font.default_source_id().unwrap();
    let mut placed = Vec::new();
    // Masters sit at the authored design values, as a designspace places them.
    for (index, design) in [points[2].1, points[0].1].into_iter().enumerate() {
        let location = DesignLocation::from([(axis, design)]);
        let source_id = if index == 0 {
            font.source_mut(default_id).unwrap().set_location(location);
            default_id
        } else {
            font.add_source(Source::new(format!("Master {index}"), location))
        };
        placed.push((source_id, 100.0 + 50.0 * index as f64));
    }
    let mut glyph = Glyph::new("square");
    for (source_id, size) in &placed {
        glyph.set_layer(square(*source_id, *size));
    }
    let glyph_id = font.insert_glyph(glyph).unwrap();

    let interpolation = font.glyph_interpolation(glyph_id).unwrap().unwrap();
    for (source_id, size) in placed {
        let source = font.source(source_id).unwrap();
        let layer = interpolation
            .resolve(source.location(), font.axes())
            .unwrap();
        assert!((layer.width() - (size + 100.0)).abs() < 1e-9);
    }
}

#[test]
fn normalization_treats_a_rounding_error_from_the_default_as_the_default() {
    let (font, _) = weight_font(
        -20.0,
        -20.0,
        8.0,
        &[(-20.0, 78.0), (-18.0, 78.0), (8.0, 80.0)],
    );
    let normalization = &font.design_normalization().unwrap()[0];

    assert_eq!(normalization.normalize(78.0), 0.0);
    assert_eq!(normalization.normalize(78.0 + 1e-13), 0.0);
    assert_eq!(normalization.normalize(80.0), 1.0);
}
