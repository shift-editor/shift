//! Adapters from resolved `shift-font` geometry into codec-owned outline bytes.
//!
//! The codec deliberately knows nothing about authored points or contour
//! traversal. This transport-side adapter is the ownership boundary where
//! resolved curve segments become drawing commands.

use shift_font::{composite::ResolvedContour, CurveSegment, CurveSegmentIter, Point};
use shift_glyph_codec::{CodecError, OutlineCommand, OutlineEncoder, PackedGlyphOutline};

/// Packs root and flattened component contours into `shift.glyph-outline.v1`.
///
/// Contours without a drawable segment are omitted, matching the existing SVG
/// preview adapter. The incremental encoder avoids an intermediate command
/// object graph while still validating every f64-to-f32 conversion.
pub fn pack_resolved_contours(
    contours: &[ResolvedContour],
) -> Result<PackedGlyphOutline, CodecError> {
    let mut encoder = OutlineEncoder::new();

    for contour in contours {
        let mut segments = CurveSegmentIter::new(&contour.points, contour.closed);
        let Some(first) = segments.next() else {
            continue;
        };

        let start = segment_start(&first);
        encoder.push(OutlineCommand::Move {
            x: start.x(),
            y: start.y(),
        })?;
        push_segment(&mut encoder, first)?;
        for segment in segments {
            push_segment(&mut encoder, segment)?;
        }
        if contour.closed {
            encoder.push(OutlineCommand::Close)?;
        }
    }

    encoder.finish()
}

fn segment_start<'a>(segment: &CurveSegment<'a>) -> &'a Point {
    match segment {
        CurveSegment::Line(start, _)
        | CurveSegment::Quad(start, _, _)
        | CurveSegment::Cubic(start, _, _, _) => start,
    }
}

fn push_segment(encoder: &mut OutlineEncoder, segment: CurveSegment<'_>) -> Result<(), CodecError> {
    match segment {
        CurveSegment::Line(_, end) => encoder.push(OutlineCommand::Line {
            x: end.x(),
            y: end.y(),
        }),
        CurveSegment::Quad(_, control, end) => encoder.push(OutlineCommand::Quad {
            cx: control.x(),
            cy: control.y(),
            x: end.x(),
            y: end.y(),
        }),
        CurveSegment::Cubic(_, control_start, control_end, end) => {
            encoder.push(OutlineCommand::Cubic {
                c1x: control_start.x(),
                c1y: control_start.y(),
                c2x: control_end.x(),
                c2y: control_end.y(),
                x: end.x(),
                y: end.y(),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use shift_font::Point;
    use shift_glyph_codec::{decode_outline, OutlineCommand};

    fn contour(points: Vec<Point>, closed: bool) -> ResolvedContour {
        ResolvedContour { points, closed }
    }

    #[test]
    fn resolved_contours_pack_general_segments_and_skip_empty_contours() {
        let contours = vec![
            contour(vec![], true),
            contour(vec![Point::on_curve(99.0, 99.0)], false),
            contour(
                vec![Point::on_curve(0.0, 0.0), Point::on_curve(10.0, 20.0)],
                false,
            ),
            contour(
                vec![
                    Point::on_curve(30.0, 40.0),
                    Point::off_curve(50.0, 60.0),
                    Point::on_curve(70.0, 80.0),
                ],
                false,
            ),
            contour(
                vec![
                    Point::on_curve(100.0, 110.0),
                    Point::off_curve(120.0, 130.0),
                    Point::off_curve(140.0, 150.0),
                    Point::on_curve(160.0, 170.0),
                ],
                true,
            ),
        ];

        let packed = pack_resolved_contours(&contours).unwrap();
        let commands = decode_outline(packed.as_bytes())
            .unwrap()
            .commands()
            .collect::<Vec<_>>();

        assert_eq!(
            commands,
            vec![
                OutlineCommand::Move { x: 0.0, y: 0.0 },
                OutlineCommand::Line { x: 10.0, y: 20.0 },
                OutlineCommand::Move { x: 30.0, y: 40.0 },
                OutlineCommand::Quad {
                    cx: 50.0,
                    cy: 60.0,
                    x: 70.0,
                    y: 80.0,
                },
                OutlineCommand::Move { x: 100.0, y: 110.0 },
                OutlineCommand::Cubic {
                    c1x: 120.0,
                    c1y: 130.0,
                    c2x: 140.0,
                    c2y: 150.0,
                    x: 160.0,
                    y: 170.0,
                },
                OutlineCommand::Line { x: 100.0, y: 110.0 },
                OutlineCommand::Close,
            ]
        );
    }

    #[test]
    fn adapter_rejects_resolved_coordinates_outside_f32() {
        let contours = vec![contour(
            vec![Point::on_curve(0.0, 0.0), Point::on_curve(f64::MAX, 0.0)],
            false,
        )];

        assert!(pack_resolved_contours(&contours).is_err());
    }
}
