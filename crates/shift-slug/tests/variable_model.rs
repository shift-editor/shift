use shift_font::{
    test_support::sample_variable_font, CurveSegment, CurveSegmentIter, DesignLocation, GlyphId,
};
use shift_slug::{AtlasBuilder, OutlineCommand, VariableAtlasBuilder};

#[test]
fn resident_two_source_model_matches_shift_projection_at_midpoint() {
    let font = sample_variable_font();
    let glyph_id = font.glyphs().next().expect("fixture has a glyph").id();
    let axis_id = font.axes()[0].id();
    let base = location(&axis_id, 400.0);
    let midpoint = location(&axis_id, 600.0);
    let source = location(&axis_id, 800.0);
    let base_commands = commands_at(&font, &glyph_id, &base);
    let source_commands = commands_at(&font, &glyph_id, &source);
    let midpoint_commands = commands_at(&font, &glyph_id, &midpoint);

    let mut variable_builder = VariableAtlasBuilder::default();
    variable_builder
        .add_glyph(base_commands, source_commands)
        .unwrap();
    let variable = variable_builder.finish();
    let resolved = variable.resolve_glyph(0, 0.5).unwrap();

    let mut expected_builder = AtlasBuilder::default();
    expected_builder.add_glyph(midpoint_commands).unwrap();
    let expected = expected_builder.finish();

    let maximum_error = resolved
        .iter()
        .zip(expected.curves())
        .flat_map(|(actual, expected)| {
            [
                (actual.p0.x - expected.p0.x).abs(),
                (actual.p0.y - expected.p0.y).abs(),
                (actual.p1.x - expected.p1.x).abs(),
                (actual.p1.y - expected.p1.y).abs(),
                (actual.p2.x - expected.p2.x).abs(),
                (actual.p2.y - expected.p2.y).abs(),
            ]
        })
        .fold(0.0_f32, f32::max);

    // Diagonal-line controls receive a direction-dependent 0.125-unit nudge.
    // Interpolating the already-converted controls differs slightly from
    // converting the interpolated line, but remains below the geometry gate.
    assert!(maximum_error <= 0.001, "maximum error was {maximum_error}");
}

fn commands_at(
    font: &shift_font::Font,
    glyph_id: &GlyphId,
    location: &DesignLocation,
) -> Vec<OutlineCommand<f32>> {
    let glyph = font
        .projection(location)
        .glyph(glyph_id)
        .unwrap()
        .expect("fixture glyph resolves");
    let mut commands = Vec::new();
    for contour in glyph.contours() {
        let Some(first) = contour.points.first() else {
            continue;
        };
        commands.push(OutlineCommand::Move {
            x: first.x() as f32,
            y: first.y() as f32,
        });
        for segment in CurveSegmentIter::new(&contour.points, contour.closed) {
            match segment {
                CurveSegment::Line(_, end) => commands.push(OutlineCommand::Line {
                    x: end.x() as f32,
                    y: end.y() as f32,
                }),
                CurveSegment::Quad(_, control, end) => commands.push(OutlineCommand::Quad {
                    cx: control.x() as f32,
                    cy: control.y() as f32,
                    x: end.x() as f32,
                    y: end.y() as f32,
                }),
                CurveSegment::Cubic(_, first, second, end) => {
                    commands.push(OutlineCommand::Cubic {
                        c1x: first.x() as f32,
                        c1y: first.y() as f32,
                        c2x: second.x() as f32,
                        c2y: second.y() as f32,
                        x: end.x() as f32,
                        y: end.y() as f32,
                    });
                }
            }
        }
        if contour.closed {
            commands.push(OutlineCommand::Close);
        }
    }
    commands
}

fn location(axis_id: &shift_font::AxisId, value: f64) -> DesignLocation {
    let mut location = DesignLocation::new();
    location.set(axis_id.clone(), value);
    location
}
