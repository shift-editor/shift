//! A glyph's own axes compile to hidden axes shared across glyphs by
//! position, and a component that sets its base glyph's axes draws the base
//! there: in a `VARC` table, or decomposed into outlines, as the editor
//! draws it either way.

mod compiled;
mod outlines;

use compiled::Fixture;
use outlines::{Outline, outline_distance};
use shift_backends::{FontExporter, VariableComponents};
use shift_font::kurbo::BezPath;
use shift_font::{
    Axis, AxisId, Component, Contour, DesignLocation, Font, Glyph, GlyphAxis, GlyphId, GlyphLayer,
    LayerId, LayerLocation, PointType, Source, SourceId,
};
use skrifa::FontRef;
use skrifa::raw::TableProvider;

/// Solenoid's `H` on its 9 x 7 half-step grid.
const H_GRID: [&str; 7] = [
    "#.......#",
    "#.......#",
    "#.......#",
    "#.#.#.#.#",
    "#.......#",
    "#.......#",
    "#.......#",
];
const ROW_PITCH: f64 = 100.0;
const HALF_STEP: f64 = 60.0;
const LEFT: f64 = 120.0;
const BOTTOM: f64 = 50.0;
const ADVANCE: f64 = 720.0;

/// A dot where strokes meet (three or more neighbours) pools to Spread 60
/// on the masters and 90 on `H`'s brace drawing at Bleed 50.
const JUNCTION_SPREAD: f64 = 60.0;
const BRACE_SPREAD: f64 = 90.0;
const BRACE_BLEED: f64 = 50.0;

/// An ellipse centred on the origin, as four cubic quarter-arcs.
fn ellipse(rx: f64, ry: f64) -> Contour {
    let (kx, ky) = (rx * 0.552_284_75, ry * 0.552_284_75);
    let mut contour = Contour::new();
    let points = [
        (rx, 0.0),
        (rx, ky),
        (kx, ry),
        (0.0, ry),
        (-kx, ry),
        (-rx, ky),
        (-rx, 0.0),
        (-rx, -ky),
        (-kx, -ry),
        (0.0, -ry),
        (kx, -ry),
        (rx, -ky),
    ];
    for (index, (x, y)) in points.into_iter().enumerate() {
        let kind = if index % 3 == 0 {
            PointType::OnCurve
        } else {
            PointType::OffCurve
        };
        contour.add_point(x, y, kind, kind == PointType::OnCurve);
    }
    contour.close();
    contour
}

/// A layer drawing an `rx` by `ry` ellipse with no advance.
fn dot_drawing(layer: GlyphLayer, rx: f64, ry: f64) -> GlyphLayer {
    let mut layer = layer;
    layer.add_contour(ellipse(rx, ry));
    layer
}

/// The grid cells `H` has dots in, with whether each is a junction.
fn h_cells() -> Vec<(f64, f64, bool)> {
    let filled = |row: isize, column: isize| {
        let (Ok(row), Ok(column)) = (usize::try_from(row), usize::try_from(column)) else {
            return false;
        };
        H_GRID
            .get(row)
            .and_then(|line| line.as_bytes().get(column))
            .is_some_and(|cell| *cell == b'#')
    };
    let mut cells = Vec::new();
    for (row, line) in (0_isize..).zip(H_GRID) {
        for (column, cell) in (0_isize..).zip(line.bytes()) {
            if cell != b'#' {
                continue;
            }
            let neighbours = (-1..=1)
                .flat_map(|dr| (-2..=2).map(move |dc| (dr, dc)))
                .filter(|(dr, dc)| (*dr, *dc) != (0, 0) && filled(row + dr, column + dc))
                .count();
            #[expect(clippy::cast_precision_loss, reason = "grid indices are single digits")]
            let (x, y) = (
                LEFT + column as f64 * HALF_STEP,
                BOTTOM + (6 - row) as f64 * ROW_PITCH,
            );
            cells.push((x, y, neighbours >= 3));
        }
    }
    cells
}

/// `H`'s layer: a `dot` per cell, junctions at `junction_spread`.
fn h_drawing(layer: GlyphLayer, dot: GlyphId, spread: AxisId, junction_spread: f64) -> GlyphLayer {
    let mut layer = layer;
    for (x, y, junction) in h_cells() {
        let mut component = Component::new(dot, "dot");
        component.translate(x, y);
        if junction {
            component.set_location(DesignLocation::from([(spread, junction_spread)]));
        }
        layer.add_component(component);
    }
    layer
}

/// Solenoid B's `dot` and `H`, as `build.py` builds them, on a Bleed axis
/// tagged `bleed_tag`: `dot` drawn 55 wide on Regular and 70 on Bled, with
/// Spread (74 wide at 100) and Strike (66 by 46 at 100) of its own, and `H`
/// on both masters plus a brace at Bleed 50 whose junctions pool further.
fn dot_matrix_h(bleed_tag: &str) -> Fixture<Font> {
    let mut font = Font::new();
    let bleed = Axis::new(bleed_tag.to_owned(), "Bleed".to_owned(), 0.0, 0.0, 100.0);
    let bleed_id = bleed.id();
    font.add_axis(bleed)?;
    let regular = font.default_source_id().ok_or("no default source")?;
    font.source_mut(regular)
        .ok_or("no default source")?
        .set_location(DesignLocation::from([(bleed_id, 0.0)]));
    let bled = font.add_source(Source::new(
        "Bled".to_owned(),
        DesignLocation::from([(bleed_id, 100.0)]),
    ));
    let masters: [(SourceId, f64); 2] = [(regular, 55.0), (bled, 70.0)];

    let mut dot = Glyph::new("dot");
    for (source_id, radius) in masters {
        dot.set_layer(dot_drawing(
            GlyphLayer::with_width(LayerId::new(), source_id, 0.0),
            radius,
            radius,
        ));
    }
    let dot_id = font.insert_glyph(dot)?;
    let spread = font.add_glyph_axis(dot_id, GlyphAxis::new("Spread", 0.0, 0.0, 100.0))?;
    let strike = font.add_glyph_axis(dot_id, GlyphAxis::new("Strike", 0.0, 0.0, 100.0))?;
    for (axis, rx, ry) in [(spread, 74.0, 74.0), (strike, 66.0, 46.0)] {
        let location = LayerLocation::at(DesignLocation::from([(axis, 100.0)]));
        let layer = dot_drawing(GlyphLayer::located(LayerId::new(), location), rx, ry);
        font.insert_glyph_layer(dot_id, layer)?;
    }

    let mut h = Glyph::with_unicode("H", 0x48);
    for (source_id, _) in masters {
        let layer = GlyphLayer::with_width(LayerId::new(), source_id, ADVANCE);
        h.set_layer(h_drawing(layer, dot_id, spread, JUNCTION_SPREAD));
    }
    let h_id = font.insert_glyph(h)?;
    let brace = LayerLocation::at(DesignLocation::from([(bleed_id, BRACE_BLEED)]));
    let mut layer = GlyphLayer::located(LayerId::new(), brace);
    layer.set_width(ADVANCE);
    font.insert_glyph_layer(h_id, h_drawing(layer, dot_id, spread, BRACE_SPREAD))?;
    Ok(font)
}

fn compile_with(font: &Font, variable_components: VariableComponents) -> Fixture<Vec<u8>> {
    let exporter = FontExporter::new().with_variable_components(variable_components);
    Ok(exporter.compile_ttf(font)?)
}

/// The compiled font's `fvar` axis tags, with whether each is hidden, and
/// whether it has a `VARC` table.
fn compiled_axes(binary: &[u8]) -> Fixture<(Vec<(String, bool)>, bool)> {
    let compiled = FontRef::new(binary)?;
    let axes = compiled
        .fvar()?
        .axes()?
        .iter()
        .map(|axis| (axis.axis_tag().to_string(), axis.flags() & 1 == 1))
        .collect();
    Ok((axes, compiled.varc().is_ok()))
}

#[test]
fn glyph_axes_compile_to_hidden_axes_tagged_by_position() {
    // `dot`'s Spread and Strike are its first and second axes: V000 and V001.
    let axes = |bleed_tag: &str, variable_components| {
        let read = || {
            compiled_axes(&compile_with(
                &dot_matrix_h(bleed_tag)?,
                variable_components,
            )?)
        };
        read().map_err(|error| error.to_string())
    };
    let hidden = |tag: &str| (tag.to_owned(), true);
    let bleed = ("BLED".to_owned(), false);

    assert_eq!(
        axes("BLED", VariableComponents::Varc),
        Ok((vec![bleed.clone(), hidden("V000"), hidden("V001")], true)),
    );
    // Decomposed, the glyph axes leave no trace in fvar.
    assert_eq!(
        axes("BLED", VariableComponents::Decompose),
        Ok((vec![bleed], false)),
    );
    // A font axis that takes V000 moves the glyph axes to the next free tags.
    assert_eq!(
        axes("V000", VariableComponents::Varc),
        Ok((
            vec![("V000".to_owned(), false), hidden("V001"), hidden("V002")],
            true
        )),
    );
}

/// `H`'s outline in `binary` at user Bleed `bleed`.
fn compiled_h(binary: &[u8], bleed: f32) -> Fixture<BezPath> {
    let mut outline = Outline::default();
    compiled::draw_at(binary, 'H', &[("BLED", bleed)], &mut outline)?;
    Ok(outline.0)
}

/// `glyph_id`'s outline as the editor draws it at design `location`, its
/// components flattened.
fn editor_outline(font: &Font, glyph_id: GlyphId, location: &DesignLocation) -> Fixture<BezPath> {
    let glyph = font
        .projection(location)
        .glyph(glyph_id)?
        .ok_or("the editor does not draw the glyph")?;
    let mut path = BezPath::new();
    for contour in glyph.contours() {
        let contour = Contour::from_points(contour.points.clone(), contour.closed);
        path.extend(BezPath::from(&contour).elements().iter().copied());
    }
    Ok(path)
}

/// The farthest the compiled `H` lies from the editor's, over Bleed 0 to 100
/// in steps of 12.5, in font units.
fn worst_distance_from_editor(variable_components: VariableComponents) -> Fixture<f64> {
    let font = dot_matrix_h("BLED")?;
    let binary = compile_with(&font, variable_components)?;
    let bleed = font.axes().first().ok_or("no axis")?.id();
    let h = font.glyph_by_name("H").ok_or("no H")?.id();
    let mut worst: f64 = 0.0;
    for step in 0_u8..=8 {
        let value = f64::from(step) * 12.5;
        let editor = editor_outline(&font, h, &DesignLocation::from([(bleed, value)]))?;
        #[expect(
            clippy::cast_possible_truncation,
            reason = "a Bleed value in 0..=100 is exact as f32"
        )]
        let compiled = compiled_h(&binary, value as f32)?;
        worst = worst.max(outline_distance(&editor, &compiled));
    }
    Ok(worst)
}

#[test]
fn components_on_glyph_axes_compile_as_the_editor_draws_them() {
    // A junction pools to Spread 60 on the masters and 90 at the brace,
    // where the editor draws it with radius 62.5 + 0.9 * 19 = 79.6;
    // dropping the location would draw it at 62.5, 17 units off. TrueType quadratics
    // and whole-unit coordinates leave the compiled outline about a unit off.
    for variable_components in [VariableComponents::Varc, VariableComponents::Decompose] {
        let worst = worst_distance_from_editor(variable_components).map_err(|e| e.to_string());
        assert!(
            worst.as_ref().is_ok_and(|worst| *worst < 1.5),
            "{variable_components:?}: {worst:?}"
        );
    }
}

/// A `pair` of two dots with an axis of its own, Gap, moving the right dot
/// out at Gap 100, placed in a glyph at Gap 100. `pair`'s Gap and `dot`'s
/// Spread are both the first axis of their glyph, so both compile to V000.
fn font_with_nested_dots() -> Fixture<Font> {
    let mut font = dot_matrix_h("BLED")?;
    let regular = font.default_source_id().ok_or("no default source")?;
    let dot = font.glyph_by_name("dot").ok_or("no dot")?.id();
    let pair_drawing = |layer: GlyphLayer, gap: f64| {
        let mut layer = layer;
        layer.add_component(Component::new(dot, "dot"));
        let mut right = Component::new(dot, "dot");
        right.translate(200.0 + gap, 0.0);
        layer.add_component(right);
        layer
    };
    let mut pair = Glyph::new("pair");
    pair.set_layer(pair_drawing(
        GlyphLayer::with_width(LayerId::new(), regular, 0.0),
        0.0,
    ));
    let pair_id = font.insert_glyph(pair)?;
    let gap = font.add_glyph_axis(pair_id, GlyphAxis::new("Gap", 0.0, 0.0, 100.0))?;
    let at_gap = LayerLocation::at(DesignLocation::from([(gap, 100.0)]));
    font.insert_glyph_layer(
        pair_id,
        pair_drawing(GlyphLayer::located(LayerId::new(), at_gap), 100.0),
    )?;

    let mut glyph = Glyph::with_unicode("pairs", 0xE000);
    let mut layer = GlyphLayer::with_width(LayerId::new(), regular, 600.0);
    let mut component = Component::new(pair_id, "pair");
    component.set_location(DesignLocation::from([(gap, 100.0)]));
    layer.add_component(component);
    glyph.set_layer(layer);
    font.insert_glyph(glyph)?;
    Ok(font)
}

#[test]
fn a_dot_inside_a_glyph_with_its_own_axis_keeps_its_axes_at_their_defaults() {
    // `pairs` draws `pair` at Gap 100, which is V000 = 1. The dots inside
    // set no Spread, so they stay 55 wide, at Spread 0, rather than taking
    // V000 = 1 from `pair` (Spread 100, 74 wide).
    let widths = |variable_components| {
        let read = || -> Fixture<_> {
            let binary = compile_with(&font_with_nested_dots()?, variable_components)?;
            let xs = compiled::on_curve_points(&binary, '\u{E000}')?
                .into_iter()
                .map(|(x, _)| x);
            let bounds = xs.fold((f32::MAX, f32::MIN), |(min, max), x| {
                (min.min(x), max.max(x))
            });
            Ok(bounds)
        };
        read().map_err(|error| error.to_string())
    };
    for variable_components in [VariableComponents::Varc, VariableComponents::Decompose] {
        assert_eq!(widths(variable_components), Ok((-55.0, 355.0)));
    }
}
