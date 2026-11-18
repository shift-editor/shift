//! A drawing located off the font's masters, such as a Glyphs brace layer,
//! compiles as a glyph source at its own location: the glyph draws it
//! exactly there and interpolates through it, as the editor does.

mod compiled;

use compiled::Fixture;
use shift_backends::FontExporter;
use shift_font::test_support::sample_variable_font;
use shift_font::{
    Contour, DesignLocation, Font, Glyph, GlyphLayer, LayerId, LayerLocation, PointType, Source,
};

/// The codepoint of the glyph the fixture adds.
const BRACED: char = '\u{E001}';

/// Where the brace drawing sits, in the sample font's Weight design units.
/// The axis mapping puts it at user Weight 800.
const BRACE_WEIGHT: f64 = 700.0;

/// A triangle whose corner on the baseline is at x `corner`.
fn triangle(layer: &mut GlyphLayer, corner: f64) {
    let mut contour = Contour::new();
    contour.add_point(0.0, 0.0, PointType::OnCurve, false);
    contour.add_point(corner, 0.0, PointType::OnCurve, false);
    contour.add_point(0.0, 500.0, PointType::OnCurve, false);
    contour.close();
    layer.add_contour(contour);
}

/// The sample font (Weight masters at design 400 and 800) plus a triangle
/// whose corner is at x 100 on the default master and 200 on Bold, and a
/// brace drawing at `brace` with the corner at 300, off the line between.
fn font_with_brace(brace: impl FnOnce(&Font) -> Fixture<LayerLocation>) -> Fixture<Font> {
    let mut font = sample_variable_font();
    let mut glyph = Glyph::with_unicode("braced", u32::from(BRACED));
    let masters: Vec<_> = font
        .masters()
        .filter(|source| source.name() != "Medium")
        .map(Source::id)
        .collect();
    for (source_id, corner) in masters.into_iter().zip([100.0, 200.0]) {
        let mut layer = GlyphLayer::with_width(LayerId::new(), source_id, 600.0);
        triangle(&mut layer, corner);
        glyph.set_layer(layer);
    }
    let glyph_id = glyph.id();
    let location = brace(&font)?;
    font.insert_glyph(glyph)?;
    let mut layer = GlyphLayer::located(LayerId::new(), location);
    layer.set_width(600.0);
    triangle(&mut layer, 300.0);
    font.insert_glyph_layer(glyph_id, layer)?;
    Ok(font)
}

/// The brace on no source, placed by its Weight coordinate alone.
fn on_no_source(font: &Font) -> Fixture<LayerLocation> {
    let weight = font.axes().first().ok_or("no axis")?.id();
    Ok(LayerLocation::at(DesignLocation::from([(
        weight,
        BRACE_WEIGHT,
    )])))
}

/// The brace laid over the Bold master, moved to its Weight coordinate.
fn over_bold(font: &Font) -> Fixture<LayerLocation> {
    let weight = font.axes().first().ok_or("no axis")?.id();
    let bold = font
        .masters()
        .find(|source| source.name() == "Bold")
        .ok_or("no Bold")?
        .id();
    Ok(LayerLocation::new(
        Some(bold),
        DesignLocation::from([(weight, BRACE_WEIGHT)]),
    ))
}

/// The corner's x (the glyph's rightmost point) where the editor draws the glyph at design Weight `weight`.
fn editor_corner(font: &Font, weight: f64) -> Fixture<f64> {
    let glyph = font.glyph_by_name("braced").ok_or("no glyph")?;
    let axis = font.axes().first().ok_or("no axis")?.id();
    let interpolation = font
        .glyph_interpolation(glyph.id())?
        .ok_or("the glyph does not interpolate")?;
    let layer = interpolation.resolve(
        &DesignLocation::from([(axis, weight)]),
        &font.glyph_space_axes(glyph),
    )?;
    let points = layer.contours_iter().flat_map(Contour::points);
    Ok(points.map(shift_font::Point::x).fold(0.0, f64::max))
}

/// The corner's x where the compiled font draws the glyph: at the default
/// location, at the brace (user Weight 800) and halfway to it (design 550,
/// user 625), with the editor's x at that halfway point.
fn compiled_corners(
    brace: impl FnOnce(&Font) -> Fixture<LayerLocation>,
) -> Result<[f32; 4], String> {
    let corners = || -> Fixture<_> {
        let font = font_with_brace(brace)?;
        let binary = FontExporter::new().compile_ttf(&font)?;
        let corner =
            |points: Vec<(f32, f32)>| points.into_iter().map(|(x, _)| x).fold(0.0, f32::max);
        #[expect(
            clippy::cast_possible_truncation,
            reason = "a coordinate in font units is exact enough as f32"
        )]
        let editor = editor_corner(&font, 550.0)?.round() as f32;
        Ok([
            corner(compiled::on_curve_points(&binary, BRACED)?),
            corner(compiled::on_curve_points_at(
                &binary,
                BRACED,
                &[("wght", 800.0)],
            )?),
            corner(compiled::on_curve_points_at(
                &binary,
                BRACED,
                &[("wght", 625.0)],
            )?),
            editor,
        ])
    };
    corners().map_err(|error| error.to_string())
}

#[test]
fn a_brace_drawing_compiles_at_its_own_location() {
    // Halfway from the default (normalized 0) to the brace (0.75) the
    // corner is halfway to 300, at 200, as the editor draws it; a straight
    // blend of the masters alone would put it at 100 + 0.375 * 100 = 137.5.
    for brace in [on_no_source, over_bold] {
        assert_eq!(compiled_corners(brace), Ok([100.0, 300.0, 200.0, 200.0]));
    }
}
