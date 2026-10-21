use crate::test_support::{closed_contour, sample_variable_font};
use crate::{
    Contour, DesignLocation, Font, GlyphLayer, KerningGroup, KerningGroupId, KerningPair,
    KerningPosition, KerningSide, PointType, SourceId,
};

use super::{Charset, Check, CheckOptions, check_font, check_font_with, check_glyph};

fn checks(font: &Font) -> Vec<Check> {
    check_font(font)
        .unwrap()
        .into_iter()
        .map(|finding| finding.check)
        .collect()
}

fn source_named(font: &Font, name: &str) -> SourceId {
    font.sources()
        .iter()
        .find(|source| source.name() == name)
        .unwrap()
        .id()
}

/// Changes glyph `A`'s layer in the master named `source`.
fn edit_layer(font: &mut Font, source: &str, edit: impl FnOnce(&mut GlyphLayer)) {
    let source_id = source_named(font, source);
    let glyph_id = font.glyph_id_by_name("A").unwrap();
    let mut glyph = font.pop_glyph(glyph_id).unwrap();
    edit(glyph.layer_for_source_mut(&source_id).unwrap());
    font.insert_glyph(glyph).unwrap();
}

/// The interpolation checks reported for glyph `A`.
fn glyph_a_checks(font: &Font) -> Vec<Check> {
    glyph_a_findings(font)
        .into_iter()
        .filter(|check| check.code().starts_with('I'))
        .collect()
}

fn glyph_a_findings(font: &Font) -> Vec<Check> {
    let glyph_id = font.glyph_id_by_name("A").unwrap();
    check_glyph(font, &glyph_id)
        .unwrap()
        .into_iter()
        .map(|finding| finding.check)
        .collect()
}

fn first_contour(layer: &mut GlyphLayer) -> &mut Contour {
    layer.contours_iter_mut().next().unwrap()
}

fn square(x: f64, y: f64, size: f64) -> Contour {
    closed_contour(&[(x, y), (x, y + size), (x + size, y + size), (x + size, y)])
}

#[test]
fn the_sample_font_interpolates_cleanly() {
    assert!(glyph_a_checks(&sample_variable_font()).is_empty());
}

#[test]
fn reports_a_contour_that_starts_at_a_different_point() {
    let mut font = sample_variable_font();
    edit_layer(&mut font, "Bold", |layer| {
        first_contour(layer).points_mut().rotate_left(1);
    });

    assert_eq!(glyph_a_checks(&font), [Check::WrongStartPoint]);
}

#[test]
fn reports_a_contour_that_runs_the_other_way() {
    let mut font = sample_variable_font();
    edit_layer(&mut font, "Bold", |layer| first_contour(layer).reverse());

    assert_eq!(glyph_a_checks(&font), [Check::WrongContourDirection]);
}

#[test]
fn reports_contours_in_each_others_place() {
    let mut font = sample_variable_font();
    for (source, swapped) in [("Regular", false), ("Bold", true)] {
        edit_layer(&mut font, source, |layer| {
            let (low, high) = (square(100.0, 100.0, 60.0), square(400.0, 600.0, 60.0));
            let (first, second) = if swapped { (high, low) } else { (low, high) };
            layer.add_contour(first);
            layer.add_contour(second);
        });
    }

    assert_eq!(glyph_a_checks(&font), [Check::WrongContourOrder]);
}

#[test]
fn reports_a_master_whose_structure_differs() {
    let mut font = sample_variable_font();
    edit_layer(&mut font, "Bold", |layer| {
        first_contour(layer).points_mut().pop();
    });

    assert_eq!(glyph_a_checks(&font), [Check::IncompatibleMaster]);
}

#[test]
fn reports_masters_at_the_same_location() {
    let mut font = sample_variable_font();
    let bold = font
        .source(&source_named(&font, "Bold"))
        .unwrap()
        .location()
        .clone();
    let medium = source_named(&font, "Medium");
    font.source_mut(&medium).unwrap().set_location(bold);

    assert!(checks(&font).contains(&Check::DuplicateMasterLocation));
}

#[test]
fn reports_a_master_outside_its_axis() {
    let mut font = sample_variable_font();
    let axis = font.axes()[0].id();
    let location = DesignLocation::from([(axis, 2000.0)]);
    let bold = source_named(&font, "Bold");
    font.source_mut(&bold).unwrap().set_location(location);

    assert!(checks(&font).contains(&Check::MasterOutsideAxis));
}

#[test]
fn reports_a_font_without_a_master_at_the_default() {
    let mut font = sample_variable_font();
    let axis = font.axes()[0].id();
    let location = DesignLocation::from([(axis, 500.0)]);
    let regular = font.default_source_id().unwrap();
    font.source_mut(&regular).unwrap().set_location(location);

    assert!(checks(&font).contains(&Check::NoDefaultMaster));
}

#[test]
fn reports_kerning_through_an_empty_group() {
    let mut font = sample_variable_font();
    let regular = font.default_source_id().unwrap();
    let empty = KerningGroupId::from_raw("empty");
    let first = font
        .kerning()
        .group_id(KerningPosition::First, "A")
        .unwrap()
        .clone();
    let kerning = font.kerning_mut();
    kerning
        .set_group(
            empty.clone(),
            KerningGroup::new(KerningPosition::Second, "Empty", Vec::new()),
        )
        .unwrap();
    kerning.set_value(regular, KerningPair::groups(first, empty), -30.0);

    assert!(checks(&font).contains(&Check::EmptyKerningGroup));
}

#[test]
fn reports_kerning_that_names_a_missing_glyph() {
    let mut font = sample_variable_font();
    let regular = font.default_source_id().unwrap();
    let a = font.glyph_id_by_name("A").unwrap();
    font.kerning_mut().set_value(
        regular,
        KerningPair::new(
            KerningSide::Glyph(a),
            KerningSide::Glyph(crate::GlyphId::from_raw("gone")),
        ),
        -30.0,
    );

    assert!(checks(&font).contains(&Check::UnresolvedKerning));
}

#[test]
fn reports_an_open_contour_and_a_degenerate_one() {
    let mut font = sample_variable_font();
    edit_layer(&mut font, "Regular", |layer| {
        first_contour(layer).open();
        let mut stub = Contour::new();
        stub.add_point(0.0, 0.0, PointType::OnCurve, false);
        stub.add_point(10.0, 0.0, PointType::OnCurve, false);
        stub.close();
        layer.add_contour(stub);
    });

    let found = glyph_a_findings(&font);
    assert!(found.contains(&Check::OpenContour));
    assert!(found.contains(&Check::DegenerateContour));
}

#[test]
fn reports_a_counter_that_winds_like_its_outer_contour() {
    let mut font = sample_variable_font();
    edit_layer(&mut font, "Regular", |layer| {
        layer.clear_contours();
        layer.add_contour(square(0.0, 0.0, 400.0));
        layer.add_contour(square(100.0, 100.0, 100.0));
    });

    assert!(glyph_a_findings(&font).contains(&Check::ContourDirection));
}

#[test]
fn reports_a_negative_advance() {
    let mut font = sample_variable_font();
    edit_layer(&mut font, "Regular", |layer| layer.set_width(-10.0));

    assert!(glyph_a_findings(&font).contains(&Check::InvalidAdvance));
}

#[test]
fn reports_an_encoded_glyph_that_draws_nothing() {
    let mut font = sample_variable_font();
    edit_layer(&mut font, "Regular", GlyphLayer::clear_contours);

    assert!(glyph_a_findings(&font).contains(&Check::EmptyOutline));
}

#[test]
fn a_required_character_the_font_lacks_is_reported_only_when_asked() {
    let font = sample_variable_font();
    let options = CheckOptions {
        charset: Some(Charset::new(vec![0x41, 0x42])),
        ..CheckOptions::default()
    };

    let with = check_font_with(&font, &options).unwrap();
    assert!(
        with.iter()
            .any(|finding| finding.check == Check::CharsetMissingGlyph
                && finding.message.contains("U+0042"))
    );
    assert!(!checks(&font).contains(&Check::CharsetMissingGlyph));
}

#[test]
fn a_glyph_off_the_monospace_cell_is_reported() {
    let font = sample_variable_font();
    let options = CheckOptions {
        monospace: Some(Some(500.0)),
        ..CheckOptions::default()
    };

    let found = check_font_with(&font, &options).unwrap();
    assert!(
        found
            .iter()
            .any(|finding| finding.check == Check::MonoWidthMismatch)
    );
}

#[test]
fn a_master_drawing_outlines_where_another_uses_a_component_is_a_warning() {
    let mut font = sample_variable_font();
    let a = font.glyph_id_by_name("A").unwrap();
    let a_glyph = font.glyph(&a).unwrap().clone();
    let mut b = crate::Glyph::new("B");
    for source in ["Regular", "Bold"] {
        let source_id = source_named(&font, source);
        let a_layer = a_glyph.layer_for_source(&source_id).unwrap();
        let mut layer = GlyphLayer::with_width(crate::LayerId::new(), source_id, a_layer.width());
        if source == "Regular" {
            layer.add_component(crate::Component::new(a.clone(), "A"));
        } else {
            for contour in a_layer.contours_iter() {
                let points = contour
                    .points()
                    .iter()
                    .map(|point| crate::Point::on_curve(point.x(), point.y()))
                    .collect();
                layer.add_contour(Contour::from_points(points, contour.is_closed()));
            }
        }
        b.set_layer(layer);
    }
    let b = font.insert_glyph(b).unwrap();

    let found = check_glyph(&font, &b)
        .unwrap()
        .into_iter()
        .map(|finding| finding.check)
        .collect::<Vec<_>>();
    assert!(found.contains(&Check::MixedComponents));
    assert!(!found.contains(&Check::IncompatibleMaster));
}

#[test]
fn a_round_contour_starting_elsewhere_is_not_reported_when_it_keeps_its_shape() {
    // An octagon whose Bold copy starts one point later: halfway, each point
    // sits between two neighbours, so the shape stays an octagon.
    let octagon = |offset: usize| {
        let mut contour = Contour::new();
        for step in 0..8 {
            let angle = std::f64::consts::TAU * ((step + offset) % 8) as f64 / 8.0;
            contour.add_point(
                300.0 + 200.0 * libm::cos(angle),
                300.0 + 200.0 * libm::sin(angle),
                PointType::OnCurve,
                false,
            );
        }
        contour.close();
        contour
    };
    let mut font = sample_variable_font();
    for (source, offset) in [("Regular", 0), ("Bold", 1)] {
        edit_layer(&mut font, source, |layer| {
            layer.clear_contours();
            layer.add_contour(octagon(offset));
        });
    }

    assert!(!glyph_a_checks(&font).contains(&Check::WrongStartPoint));
}
