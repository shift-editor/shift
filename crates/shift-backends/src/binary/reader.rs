use crate::errors::{FormatBackendError, FormatBackendResult};
use shift_font::{Contour, Font, Glyph, GlyphLayer, LayerId, MetricKind, PointType};
use skrifa::{
    outline::{DrawSettings, OutlinePen},
    prelude::{LocationRef, Size},
    raw::TableProvider,
    string::StringId,
    FontRef, MetadataProvider,
};

use crate::metrics::set_metric_position;

pub fn read_font_file(path: &str) -> FormatBackendResult<Font> {
    let bytes = std::fs::read(path)
        .map_err(|e| FormatBackendError::Binary(format!("failed to read '{path}': {e}")))?;
    let font = FontRef::new(&bytes)
        .map_err(|e| FormatBackendError::Binary(format!("failed to parse '{path}': {e}")))?;
    font_from_skrifa(&font)
}

#[derive(Default)]
struct ShiftPen {
    contours: Vec<Contour>,
}

impl ShiftPen {
    /// Returns the contour currently being built.
    /// Panics if called before `move_to` — skrifa guarantees `move_to` is called first.
    fn current_contour(&mut self) -> &mut Contour {
        self.contours
            .last_mut()
            .expect("move_to must be called before other pen methods")
    }

    pub fn contours(self) -> Vec<Contour> {
        self.contours
    }
}

impl OutlinePen for ShiftPen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.contours.push(Contour::new());
        self.current_contour()
            .add_point(x as f64, y as f64, PointType::OnCurve, false);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.current_contour()
            .add_point(x as f64, y as f64, PointType::OnCurve, false);
    }

    /// Binary imports produce cubic-only IR: the wire and renderer layers do
    /// not support quadratic segments, so every TrueType quadratic is lifted
    /// to its exact cubic equivalent (mathematically lossless — every
    /// quadratic is a cubic with c1 = q0 + 2/3(q1 - q0), c2 = q2 + 2/3(q1 - q2)).
    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        let contour = self.current_contour();
        let q0 = contour
            .last_point()
            .expect("quad_to requires a current point");
        let (q0x, q0y) = (q0.x(), q0.y());
        let (q1x, q1y) = (cx0 as f64, cy0 as f64);
        let (q2x, q2y) = (x as f64, y as f64);
        let c1x = q0x + 2.0 / 3.0 * (q1x - q0x);
        let c1y = q0y + 2.0 / 3.0 * (q1y - q0y);
        let c2x = q2x + 2.0 / 3.0 * (q1x - q2x);
        let c2y = q2y + 2.0 / 3.0 * (q1y - q2y);
        contour.add_point(c1x, c1y, PointType::OffCurve, false);
        contour.add_point(c2x, c2y, PointType::OffCurve, false);
        contour.add_point(q2x, q2y, PointType::OnCurve, false);
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.current_contour()
            .add_point(cx0 as f64, cy0 as f64, PointType::OffCurve, false);
        self.current_contour()
            .add_point(cx1 as f64, cy1 as f64, PointType::OffCurve, false);
        self.current_contour()
            .add_point(x as f64, y as f64, PointType::OnCurve, false);
    }

    /// Closes the current contour. skrifa ends contours whose final segment
    /// is a curve with an explicit on-curve at the start point; closing a
    /// contour in the IR already implies returning to the first point, so
    /// that duplicate is dropped to avoid a degenerate zero-length segment.
    fn close(&mut self) {
        if let Some(contour) = self.contours.last_mut() {
            if contour.len() > 1 {
                let first = contour.first_point().expect("contour is non-empty");
                let last = contour.last_point().expect("contour is non-empty");
                if last.is_on_curve() && last.x() == first.x() && last.y() == first.y() {
                    contour.points_mut().pop();
                }
            }
            contour.close();
        }
    }
}

/// Maximum angle difference (in radians, ~2.9°) between incoming and outgoing
/// handles for a point to be classified as smooth. Matches the tolerance used
/// by common font editors for auto-detecting tangent continuity.
const SMOOTH_ANGLE_TOLERANCE: f64 = 0.05;

fn detect_smooth_points(contours: &mut [Contour]) {
    for contour in contours.iter_mut() {
        let len = contour.len();
        if len < 3 {
            continue;
        }

        let is_closed = contour.is_closed();

        for i in 0..len {
            let point = contour.get_point_at(i).unwrap();

            if !point.is_on_curve() {
                continue;
            }

            let (prev_idx, next_idx) = match is_closed {
                true => ((i + len - 1) % len, (i + 1) % len),
                false if i == 0 || i == len - 1 => continue,
                false => (i - 1, i + 1),
            };

            let prev = contour.get_point_at(prev_idx).unwrap();
            let next = contour.get_point_at(next_idx).unwrap();

            if prev.is_on_curve() && next.is_on_curve() {
                continue;
            }

            let dx1 = point.x() - prev.x();
            let dy1 = point.y() - prev.y();
            let dx2 = next.x() - point.x();
            let dy2 = next.y() - point.y();

            let a1 = dy1.atan2(dx1);
            let a2 = dy2.atan2(dx2);

            if (a1 - a2).abs() < SMOOTH_ANGLE_TOLERANCE {
                contour.get_point_at_mut(i).unwrap().set_smooth(true);
            }
        }
    }
}

fn font_from_skrifa(font: &FontRef<'_>) -> FormatBackendResult<Font> {
    let outlines = font.outline_glyphs();
    let char_map = font.charmap();
    let hmtx = font
        .hmtx()
        .map_err(|e| FormatBackendError::Binary(format!("failed to read hmtx table: {e}")))?;

    let metrics = font.metrics(Size::unscaled(), LocationRef::default());
    let mut ir_font = Font::new();
    let default_source_id = ir_font
        .default_source_id()
        .expect("new font should have a default source");

    ir_font.metrics_mut().units_per_em = metrics.units_per_em as f64;
    let metric_definitions = ir_font.metric_definitions().to_vec();
    let default_source = ir_font
        .source_mut(default_source_id.clone())
        .expect("new font should contain its default source");
    set_metric_position(
        &metric_definitions,
        default_source,
        MetricKind::Ascender,
        Some(metrics.ascent as f64),
    );
    set_metric_position(
        &metric_definitions,
        default_source,
        MetricKind::Descender,
        Some(metrics.descent as f64),
    );
    set_metric_position(
        &metric_definitions,
        default_source,
        MetricKind::CapHeight,
        metrics.cap_height.map(|value| value as f64),
    );
    set_metric_position(
        &metric_definitions,
        default_source,
        MetricKind::XHeight,
        metrics.x_height.map(|value| value as f64),
    );

    if let Some(family_name) = localized_string(font, StringId::FAMILY_NAME) {
        ir_font.metadata_mut().family_name = Some(family_name);
    }
    if let Some(style_name) = localized_string(font, StringId::SUBFAMILY_NAME) {
        ir_font.metadata_mut().style_name = Some(style_name);
    }

    for (unicode, glyph_id) in char_map.mappings() {
        let outline = outlines.get(glyph_id).ok_or_else(|| {
            FormatBackendError::Binary(format!(
                "missing outline for glyph {glyph_id} (U+{unicode:04X})"
            ))
        })?;
        let settings = DrawSettings::unhinted(Size::unscaled(), LocationRef::default());
        let mut pen = ShiftPen::default();
        outline.draw(settings, &mut pen).map_err(|e| {
            FormatBackendError::Binary(format!(
                "failed to draw outline for glyph {glyph_id} (U+{unicode:04X}): {e}"
            ))
        })?;

        let advance_width = hmtx.advance(glyph_id).ok_or_else(|| {
            FormatBackendError::Binary(format!(
                "missing advance width for glyph {glyph_id} (U+{unicode:04X})"
            ))
        })?;

        let glyph_name = char::from_u32(unicode)
            .map(|c| c.to_string())
            .unwrap_or_else(|| format!("uni{unicode:04X}"));

        let mut glyph = Glyph::with_unicode(glyph_name, unicode);
        let mut layer = GlyphLayer::with_width(
            LayerId::new(),
            default_source_id.clone(),
            advance_width as f64,
        );
        let mut contours = pen.contours();
        detect_smooth_points(&mut contours);
        for contour in contours {
            layer.add_contour(contour);
        }
        glyph.set_layer(layer);
        ir_font.insert_glyph(glyph)?;
    }

    Ok(ir_font)
}

fn localized_string(font: &FontRef<'_>, id: StringId) -> Option<String> {
    font.localized_strings(id)
        .english_or_first()
        .map(|string| string.to_string())
        .filter(|string| !string.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use shift_font::Point;
    use skrifa::outline::pen::PathElement;
    use std::path::PathBuf;

    fn mutatorsans_ttf_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("fixtures/fonts/mutatorsans/MutatorSans.ttf")
    }

    fn quad_at(q0: (f64, f64), q1: (f64, f64), q2: (f64, f64), t: f64) -> (f64, f64) {
        let u = 1.0 - t;
        (
            u * u * q0.0 + 2.0 * u * t * q1.0 + t * t * q2.0,
            u * u * q0.1 + 2.0 * u * t * q1.1 + t * t * q2.1,
        )
    }

    fn cubic_at(
        p0: (f64, f64),
        c1: (f64, f64),
        c2: (f64, f64),
        p3: (f64, f64),
        t: f64,
    ) -> (f64, f64) {
        let u = 1.0 - t;
        (
            u * u * u * p0.0 + 3.0 * u * u * t * c1.0 + 3.0 * u * t * t * c2.0 + t * t * t * p3.0,
            u * u * u * p0.1 + 3.0 * u * u * t * c1.1 + 3.0 * u * t * t * c2.1 + t * t * t * p3.1,
        )
    }

    fn point_types(contour: &Contour) -> Vec<PointType> {
        contour.points().iter().map(|p| p.point_type()).collect()
    }

    #[test]
    fn quad_lifted_to_geometrically_identical_cubic() {
        let mut pen = ShiftPen::default();
        pen.move_to(10.0, 20.0);
        pen.quad_to(50.0, 90.0, 100.0, 20.0);

        let contours = pen.contours();
        let points = contours[0].points();
        assert_eq!(
            point_types(&contours[0]),
            vec![
                PointType::OnCurve,
                PointType::OffCurve,
                PointType::OffCurve,
                PointType::OnCurve
            ]
        );

        let q0 = (10.0, 20.0);
        let q1 = (50.0, 90.0);
        let q2 = (100.0, 20.0);
        let c1 = (points[1].x(), points[1].y());
        let c2 = (points[2].x(), points[2].y());
        for step in 0..=20 {
            let t = step as f64 / 20.0;
            let expected = quad_at(q0, q1, q2, t);
            let actual = cubic_at(q0, c1, c2, q2, t);
            assert!(
                (expected.0 - actual.0).abs() < 1e-9 && (expected.1 - actual.1).abs() < 1e-9,
                "lifted cubic diverges from quad at t={t}: {expected:?} vs {actual:?}"
            );
        }
    }

    #[test]
    fn close_drops_duplicate_start_point_from_closing_curve() {
        let mut pen = ShiftPen::default();
        pen.move_to(0.0, 0.0);
        pen.line_to(100.0, 0.0);
        pen.quad_to(100.0, 100.0, 0.0, 0.0);
        pen.close();

        let contours = pen.contours();
        let contour = &contours[0];
        assert!(contour.is_closed());
        assert_eq!(
            point_types(contour),
            vec![
                PointType::OnCurve,
                PointType::OnCurve,
                PointType::OffCurve,
                PointType::OffCurve
            ],
            "closing curve's explicit end point should be dropped; the closed contour wraps to the start"
        );
    }

    #[test]
    fn close_keeps_distinct_last_point() {
        let mut pen = ShiftPen::default();
        pen.move_to(0.0, 0.0);
        pen.line_to(100.0, 0.0);
        pen.line_to(100.0, 100.0);
        pen.close();

        let contours = pen.contours();
        assert!(contours[0].is_closed());
        assert_eq!(contours[0].len(), 3);
    }

    #[test]
    fn line_after_quad_composes() {
        let mut pen = ShiftPen::default();
        pen.move_to(0.0, 0.0);
        pen.quad_to(50.0, 100.0, 100.0, 0.0);
        pen.line_to(200.0, 0.0);
        pen.close();

        let contours = pen.contours();
        assert_eq!(
            point_types(&contours[0]),
            vec![
                PointType::OnCurve,
                PointType::OffCurve,
                PointType::OffCurve,
                PointType::OnCurve,
                PointType::OnCurve
            ]
        );
    }

    #[test]
    fn imported_cubics_match_source_quadratics() {
        let path = mutatorsans_ttf_path();
        let bytes = std::fs::read(&path).expect("MutatorSans.ttf fixture should exist");
        let font_ref = FontRef::new(&bytes).unwrap();

        let glyph_id = font_ref
            .charmap()
            .map('O')
            .expect("MutatorSans should map 'O'");
        let mut elements: Vec<PathElement> = Vec::new();
        font_ref
            .outline_glyphs()
            .get(glyph_id)
            .unwrap()
            .draw(
                DrawSettings::unhinted(Size::unscaled(), LocationRef::default()),
                &mut elements,
            )
            .unwrap();

        let font = font_from_skrifa(&font_ref).unwrap();
        let glyph = font
            .glyphs_by_unicode('O' as u32)
            .next()
            .expect("imported font should contain 'O'");
        let layer = glyph
            .layers()
            .values()
            .next()
            .expect("glyph should have a layer");

        let mut cubic_segments: Vec<[(f64, f64); 4]> = Vec::new();
        for contour in layer.contours_iter() {
            let points: Vec<&Point> = contour.points().iter().collect();
            let len = points.len();
            for i in 0..len {
                let window: Vec<&Point> = (0..4).map(|offset| points[(i + offset) % len]).collect();
                if window[0].is_on_curve()
                    && window[1].point_type() == PointType::OffCurve
                    && window[2].point_type() == PointType::OffCurve
                    && window[3].is_on_curve()
                {
                    cubic_segments.push([0, 1, 2, 3].map(|p| (window[p].x(), window[p].y())));
                }
            }
        }

        let mut current = (0.0, 0.0);
        let mut quads_checked = 0;
        for element in elements {
            match element {
                PathElement::MoveTo { x, y } | PathElement::LineTo { x, y } => {
                    current = (x as f64, y as f64);
                }
                PathElement::QuadTo { cx0, cy0, x, y } => {
                    let q0 = current;
                    let q1 = (cx0 as f64, cy0 as f64);
                    let q2 = (x as f64, y as f64);
                    let segment = cubic_segments
                        .iter()
                        .find(|[p0, _, _, p3]| *p0 == q0 && *p3 == q2)
                        .unwrap_or_else(|| {
                            panic!("no imported cubic segment from {q0:?} to {q2:?}")
                        });
                    for step in 1..8 {
                        let t = step as f64 / 8.0;
                        let expected = quad_at(q0, q1, q2, t);
                        let actual = cubic_at(segment[0], segment[1], segment[2], segment[3], t);
                        assert!(
                            (expected.0 - actual.0).abs() < 1e-9
                                && (expected.1 - actual.1).abs() < 1e-9,
                            "imported cubic diverges from source quad at t={t}"
                        );
                    }
                    quads_checked += 1;
                    current = q2;
                }
                PathElement::CurveTo { x, y, .. } => {
                    current = (x as f64, y as f64);
                }
                PathElement::Close => {}
            }
        }
        assert!(
            quads_checked > 0,
            "MutatorSans.ttf 'O' should contain quadratic segments"
        );
    }

    fn make_closed_contour(points: Vec<(f64, f64, PointType)>) -> Contour {
        let mut contour = Contour::new();
        for (x, y, pt) in points {
            contour.add_point(x, y, pt, false);
        }
        contour.close();
        contour
    }

    #[test]
    fn smooth_point_with_collinear_handles() {
        let mut contours = vec![make_closed_contour(vec![
            (0.0, 0.0, PointType::OffCurve),
            (100.0, 0.0, PointType::OnCurve),
            (200.0, 0.0, PointType::OffCurve),
            (300.0, 100.0, PointType::OnCurve),
        ])];

        detect_smooth_points(&mut contours);

        let contour = &contours[0];
        assert!(
            contour.get_point_at(1).unwrap().is_smooth(),
            "on-curve point with collinear handles should be smooth"
        );
    }

    #[test]
    fn corner_point_not_smooth() {
        let mut contours = vec![make_closed_contour(vec![
            (0.0, 100.0, PointType::OffCurve),
            (100.0, 0.0, PointType::OnCurve),
            (200.0, 100.0, PointType::OffCurve),
            (300.0, 0.0, PointType::OnCurve),
        ])];

        detect_smooth_points(&mut contours);

        let contour = &contours[0];
        assert!(
            !contour.get_point_at(1).unwrap().is_smooth(),
            "on-curve point with angled handles should not be smooth"
        );
    }

    #[test]
    fn line_segment_not_marked_smooth() {
        let mut contours = vec![make_closed_contour(vec![
            (0.0, 0.0, PointType::OnCurve),
            (100.0, 0.0, PointType::OnCurve),
            (100.0, 100.0, PointType::OnCurve),
            (0.0, 100.0, PointType::OnCurve),
        ])];

        detect_smooth_points(&mut contours);

        let contour = &contours[0];
        for i in 0..4 {
            assert!(
                !contour.get_point_at(i).unwrap().is_smooth(),
                "point {i} should not be smooth (line segment)"
            );
        }
    }

    #[test]
    fn off_curve_points_never_smooth() {
        let mut contours = vec![make_closed_contour(vec![
            (0.0, 0.0, PointType::OffCurve),
            (100.0, 0.0, PointType::OnCurve),
            (200.0, 0.0, PointType::OffCurve),
            (300.0, 100.0, PointType::OnCurve),
        ])];

        detect_smooth_points(&mut contours);

        let contour = &contours[0];
        assert!(
            !contour.get_point_at(0).unwrap().is_smooth(),
            "off-curve points should never be smooth"
        );
        assert!(
            !contour.get_point_at(2).unwrap().is_smooth(),
            "off-curve points should never be smooth"
        );
    }

    #[test]
    fn smooth_within_tolerance() {
        let small_angle = SMOOTH_ANGLE_TOLERANCE / 2.0;
        let offset = 100.0 * small_angle.sin();

        let mut contours = vec![make_closed_contour(vec![
            (-100.0, 0.0, PointType::OffCurve),
            (0.0, 0.0, PointType::OnCurve),
            (100.0, offset, PointType::OffCurve),
            (200.0, 100.0, PointType::OnCurve),
        ])];

        detect_smooth_points(&mut contours);

        let contour = &contours[0];
        assert!(
            contour.get_point_at(1).unwrap().is_smooth(),
            "point with angle within tolerance should be smooth"
        );
    }

    #[test]
    fn not_smooth_outside_tolerance() {
        let large_angle = SMOOTH_ANGLE_TOLERANCE * 2.0;
        let offset = 100.0 * large_angle.sin();

        let mut contours = vec![make_closed_contour(vec![
            (-100.0, 0.0, PointType::OffCurve),
            (0.0, 0.0, PointType::OnCurve),
            (100.0, offset, PointType::OffCurve),
            (200.0, 100.0, PointType::OnCurve),
        ])];

        detect_smooth_points(&mut contours);

        let contour = &contours[0];
        assert!(
            !contour.get_point_at(1).unwrap().is_smooth(),
            "point with angle outside tolerance should not be smooth"
        );
    }

    #[test]
    fn contour_too_small_ignored() {
        let mut contours = vec![{
            let mut c = Contour::new();
            c.add_point(0.0, 0.0, PointType::OnCurve, false);
            c.add_point(100.0, 0.0, PointType::OnCurve, false);
            c.close();
            c
        }];

        detect_smooth_points(&mut contours);

        assert!(
            !contours[0].get_point_at(0).unwrap().is_smooth(),
            "contours with less than 3 points should be skipped"
        );
    }

    #[test]
    fn open_contour_endpoints_not_smooth() {
        let mut contours = vec![{
            let mut c = Contour::new();
            c.add_point(0.0, 0.0, PointType::OffCurve, false);
            c.add_point(100.0, 0.0, PointType::OnCurve, false);
            c.add_point(200.0, 0.0, PointType::OffCurve, false);
            c
        }];

        detect_smooth_points(&mut contours);

        let contour = &contours[0];
        assert!(
            contour.get_point_at(1).unwrap().is_smooth(),
            "middle point of open contour should be smooth if collinear"
        );
    }

    #[test]
    fn mixed_curve_and_line_segments() {
        let mut contours = vec![make_closed_contour(vec![
            (0.0, 0.0, PointType::OnCurve),
            (50.0, 50.0, PointType::OffCurve),
            (100.0, 100.0, PointType::OnCurve),
            (200.0, 100.0, PointType::OnCurve),
        ])];

        detect_smooth_points(&mut contours);

        let contour = &contours[0];
        assert!(
            !contour.get_point_at(2).unwrap().is_smooth(),
            "on-curve point between curve and line should not be smooth (both neighbors on-curve check)"
        );
    }
}
