//! Open corners are erased in the compiled font, as fontc erases them for a
//! Glyphs source, and only where every master can be erased alike.

mod compiled;

use compiled::Fixture;
use shift_backends::FontExporter;
use shift_font::test_support::{closed_contour, open_corner_contour, sample_variable_font};
use shift_font::{Contour, Font};

/// The sample font with `A` drawn as one contour per master, the default
/// master first.
fn font_with_a(mut contour_for: impl FnMut(usize) -> Contour) -> Fixture<Font> {
    let mut font = sample_variable_font();
    let default_source = font.default_source_id().ok_or("no default source")?;
    let glyph_id = font.glyph_id_by_name("A").ok_or("the sample has no A")?;
    let mut glyph = font.pop_glyph(glyph_id)?;
    let mut layers: Vec<_> = glyph
        .layers()
        .values()
        .map(|layer| (layer.source_id() != Some(default_source), layer.id()))
        .collect();
    layers.sort();
    for (index, (_, layer_id)) in layers.into_iter().enumerate() {
        let layer = glyph
            .layer_mut(layer_id)
            .ok_or("a layer of A went missing")?;
        layer.clear_contours();
        layer.add_contour(contour_for(index));
    }
    font.insert_glyph(glyph)?;
    Ok(font)
}

/// The on-curve points of `A` in the compiled font, or the reason it could not be read.
fn compiled_points(contour_for: impl FnMut(usize) -> Contour) -> Result<usize, String> {
    compiled_a_on_curve_points(&font_with_a(contour_for).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

fn compiled_a_on_curve_points(font: &Font) -> Fixture<usize> {
    let binary = FontExporter::new().compile_ttf(font)?;
    Ok(compiled::on_curve_points(&binary, 'A')?.len())
}

#[test]
fn a_corner_open_in_every_master_compiles_erased() {
    let points = compiled_points(|index| open_corner_contour(1.0 + 0.2 * index as f64));

    // Four authored points; the ear and its joining line are gone, leaving the triangle's three.
    assert_eq!(points, Ok(3));
}

#[test]
fn a_corner_open_in_only_one_master_compiles_as_authored() {
    let points = compiled_points(|index| match index {
        0 => open_corner_contour(1.0),
        // The corner closed by hand, with as many points as the open one so the masters
        // stay compatible.
        _ => closed_contour(&[(20.0, 0.0), (179.0, 0.0), (114.5, 191.2), (20.0, 0.0)]),
    });

    assert_eq!(points, Ok(4));
}
