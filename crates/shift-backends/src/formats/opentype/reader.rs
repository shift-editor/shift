use std::{path::Path, sync::Arc};

use crate::{
    errors::{FormatBackendError, FormatBackendResult},
    font_source::{inferred_smooth_point_indices, FontSource, OpenTypeFont},
    import::{collect_streamed_font, GlyphDirectoryEntry, GlyphStream, ImportBatchLimit},
};
use rayon::prelude::*;
use shift_font::{
    Contour, ContourId, Font, Glyph, GlyphId as ShiftGlyphId, GlyphLayer, GlyphName, GlyphSource,
    LayerId, Location, PointId, PointType, SourceId,
};
use skrifa::{
    outline::{DrawSettings, OutlineGlyphCollection, OutlinePen},
    prelude::{LocationRef, Size},
    raw::{tables::hmtx::Hmtx, types::GlyphId, TableProvider},
    FontRef, MetadataProvider,
};

pub fn read_font_file(path: &str) -> FormatBackendResult<Font> {
    let (header, mut stream) = stream_font_file(path)?;
    collect_streamed_font(header, &mut stream)
}

struct ShiftPen {
    glyph_id: u32,
    next_contour_index: usize,
    next_point_index: usize,
    contours: Vec<Contour>,
}

impl ShiftPen {
    fn new(glyph_id: GlyphId) -> Self {
        Self {
            glyph_id: glyph_id.to_u32(),
            next_contour_index: 0,
            next_point_index: 0,
            contours: Vec::new(),
        }
    }

    fn next_contour_id(&mut self) -> ContourId {
        let index = self.next_contour_index;
        self.next_contour_index += 1;
        ContourId::from_raw(format!("b{:x}_{index:x}", self.glyph_id))
    }

    fn next_point_id(&mut self) -> PointId {
        let index = self.next_point_index;
        self.next_point_index += 1;
        PointId::from_raw(format!("b{:x}_{index:x}", self.glyph_id))
    }

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
        let contour_id = self.next_contour_id();
        self.contours.push(Contour::with_id(contour_id));
        let point_id = self.next_point_id();
        self.current_contour().add_point_with_id(
            point_id,
            x as f64,
            y as f64,
            PointType::OnCurve,
            false,
        );
    }

    fn line_to(&mut self, x: f32, y: f32) {
        let point_id = self.next_point_id();
        self.current_contour().add_point_with_id(
            point_id,
            x as f64,
            y as f64,
            PointType::OnCurve,
            false,
        );
    }

    /// Preserves the source quadratic as one control and one qcurve endpoint.
    /// The canonical layer codec retains this distinction; the wire projects
    /// the endpoint as on-curve, which still lets clients infer one-control
    /// quadratic segments without cubic expansion.
    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        let control_id = self.next_point_id();
        let endpoint_id = self.next_point_id();
        let contour = self.current_contour();
        contour.add_point_with_id(
            control_id,
            cx0 as f64,
            cy0 as f64,
            PointType::OffCurve,
            false,
        );
        contour.add_point_with_id(endpoint_id, x as f64, y as f64, PointType::QCurve, false);
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        let control_0_id = self.next_point_id();
        let control_1_id = self.next_point_id();
        let endpoint_id = self.next_point_id();
        let contour = self.current_contour();
        contour.add_point_with_id(
            control_0_id,
            cx0 as f64,
            cy0 as f64,
            PointType::OffCurve,
            false,
        );
        contour.add_point_with_id(
            control_1_id,
            cx1 as f64,
            cy1 as f64,
            PointType::OffCurve,
            false,
        );
        contour.add_point_with_id(endpoint_id, x as f64, y as f64, PointType::OnCurve, false);
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
                    let closes_quadratic = last.point_type() == PointType::QCurve;
                    contour.points_mut().pop();
                    if closes_quadratic {
                        contour.points_mut()[0].set_point_type(PointType::QCurve);
                    }
                }
            }
            contour.close();
        }
    }
}

fn detect_smooth_points(contours: &mut [Contour]) {
    for contour in contours {
        let smooth = inferred_smooth_point_indices(
            contour.points(),
            contour.is_closed(),
            |point| (point.x(), point.y()),
            |point| point.is_on_curve(),
        );
        for index in smooth {
            contour
                .get_point_at_mut(index)
                .expect("smooth point index came from this contour")
                .set_smooth(true);
        }
    }
}

#[derive(Clone)]
struct BinaryGlyphRecord {
    raw_id: GlyphId,
    shift_id: ShiftGlyphId,
    name: GlyphName,
    unicodes: Vec<u32>,
}

pub(crate) struct BinaryGlyphStream {
    font: Arc<OpenTypeFont>,
    source_id: SourceId,
    glyphs: Vec<BinaryGlyphRecord>,
    next_glyph: usize,
}

pub(crate) fn stream_font_file(path: &str) -> FormatBackendResult<(Font, BinaryGlyphStream)> {
    let retained = Arc::new(
        OpenTypeFont::open(Path::new(path))
            .map_err(|error| FormatBackendError::Binary(error.to_string()))?,
    );
    let header = retained.header.clone();
    let source_id = header.default_source_id().ok_or_else(|| {
        FormatBackendError::Binary("binary font header is missing its default source".into())
    })?;
    let glyphs = retained
        .directory()
        .glyphs
        .iter()
        .map(|glyph| BinaryGlyphRecord {
            raw_id: GlyphId::new(glyph.index.to_u32()),
            // Compiled fonts carry stable glyph order but no Shift IDs, so
            // deterministic GID-derived identities make re-import repeatable.
            // These identities are minted only when authored import begins.
            shift_id: ShiftGlyphId::from_raw(format!("binary{}", glyph.index.to_u32())),
            name: GlyphName::from(glyph.name.clone()),
            unicodes: glyph.unicodes.to_vec(),
        })
        .collect();

    Ok((
        header,
        BinaryGlyphStream {
            font: retained,
            source_id,
            glyphs,
            next_glyph: 0,
        },
    ))
}

impl GlyphStream for BinaryGlyphStream {
    fn directory(&self) -> Vec<GlyphDirectoryEntry> {
        self.glyphs
            .iter()
            .map(|glyph| GlyphDirectoryEntry {
                glyph_id: glyph.shift_id.clone(),
                name: glyph.name.clone(),
            })
            .collect()
    }

    fn glyph_count(&self) -> usize {
        self.glyphs.len()
    }

    fn next_batch(&mut self, limit: ImportBatchLimit) -> FormatBackendResult<Vec<Glyph>> {
        if self.next_glyph == self.glyphs.len() {
            return Ok(Vec::new());
        }

        let batch_glyphs = limit.max_glyphs().min(limit.max_layers());
        let end = self
            .next_glyph
            .saturating_add(batch_glyphs)
            .min(self.glyphs.len());
        let font = FontRef::new(self.font.bytes()).map_err(|error| {
            FormatBackendError::Binary(format!("failed to reopen retained font: {error}"))
        })?;
        let hmtx = font.hmtx().map_err(|error| {
            FormatBackendError::Binary(format!("failed to read hmtx table: {error}"))
        })?;
        let outlines = font.outline_glyphs();
        let source_id = &self.source_id;
        let glyphs = self.glyphs[self.next_glyph..end]
            .par_iter()
            .map(|record| glyph_from_skrifa(&hmtx, &outlines, source_id, record))
            .collect::<FormatBackendResult<Vec<_>>>()?;
        self.next_glyph = end;
        Ok(glyphs)
    }
}

fn glyph_from_skrifa(
    hmtx: &Hmtx<'_>,
    outlines: &OutlineGlyphCollection<'_>,
    source_id: &SourceId,
    record: &BinaryGlyphRecord,
) -> FormatBackendResult<Glyph> {
    let advance_width = hmtx.advance(record.raw_id).ok_or_else(|| {
        FormatBackendError::Binary(format!("missing advance width for glyph {}", record.raw_id))
    })?;
    let mut layer = GlyphLayer::with_width(
        LayerId::from_raw(format!("binary{}", record.raw_id.to_u32())),
        advance_width as f64,
    );

    if let Some(outline) = outlines.get(record.raw_id) {
        let settings = DrawSettings::unhinted(Size::unscaled(), LocationRef::default());
        let mut pen = ShiftPen::new(record.raw_id);
        outline.draw(settings, &mut pen).map_err(|error| {
            FormatBackendError::Binary(format!(
                "failed to draw outline for glyph {}: {error}",
                record.raw_id
            ))
        })?;
        let mut contours = pen.contours();
        detect_smooth_points(&mut contours);
        for contour in contours {
            layer.add_contour(contour);
        }
    }

    let glyph_source = GlyphSource::new(
        source_id.to_string(),
        layer.id(),
        Some(source_id.clone()),
        Location::new(),
    );
    let mut glyph = Glyph::with_id(record.shift_id.clone(), record.name.clone());
    glyph.set_unicodes(record.unicodes.clone());
    glyph.set_layer(layer);
    glyph.insert_default_source(glyph_source);
    Ok(glyph)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::font_source::geometry::SMOOTH_ANGLE_TOLERANCE;
    use shift_font::{CurveSegment, MetricKind};
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

    #[test]
    fn canonical_retained_directory_matches_authored_header_metadata() {
        let retained = OpenTypeFont::open(&mutatorsans_ttf_path()).unwrap();
        let directory = retained.directory();
        let header = retained.header.clone();
        let default_source_id = header.default_source_id().unwrap();
        let default_source = header
            .sources()
            .iter()
            .find(|source| source.id() == default_source_id)
            .expect("authored header should contain its default source");

        assert_eq!(header.metadata().family_name, directory.family_name);
        assert_eq!(header.metadata().style_name, directory.style_name);
        assert_eq!(
            header.metrics().units_per_em,
            directory.metrics.units_per_em
        );
        assert_eq!(header.axes().len(), directory.axes.len());
        assert_eq!(header.named_instances().len(), directory.instances.len());
        assert_eq!(default_source.line_gap(), Some(directory.metrics.line_gap));
        for (kind, expected) in [
            (MetricKind::Ascender, Some(directory.metrics.ascender)),
            (MetricKind::Descender, Some(directory.metrics.descender)),
            (MetricKind::CapHeight, directory.metrics.cap_height),
            (MetricKind::XHeight, directory.metrics.x_height),
        ] {
            assert_eq!(
                crate::metrics::metric_position(header.metric_definitions(), default_source, kind,),
                expected,
            );
        }
    }

    fn point_types(contour: &Contour) -> Vec<PointType> {
        contour.points().iter().map(|p| p.point_type()).collect()
    }

    fn deterministic_pen_contours() -> Vec<Contour> {
        let mut pen = ShiftPen::new(GlyphId::new(0x2a));
        pen.move_to(0.0, 0.0);
        pen.line_to(100.0, 0.0);
        pen.quad_to(100.0, 100.0, 0.0, 0.0);
        pen.close();
        pen.move_to(10.0, 20.0);
        pen.contours()
    }

    #[test]
    fn binary_pen_mints_deterministic_positional_ids() {
        let contours = deterministic_pen_contours();
        assert_eq!(contours, deterministic_pen_contours());
        assert_eq!(contours[0].id().as_str(), "contour_b2a_0");
        assert_eq!(contours[1].id().as_str(), "contour_b2a_1");
        assert_eq!(contours[0].points()[0].id().as_str(), "point_b2a_0");
        assert_eq!(contours[0].points()[1].id().as_str(), "point_b2a_1");
        assert_eq!(contours[0].points()[2].id().as_str(), "point_b2a_2");
        assert_eq!(
            contours[1].points()[0].id().as_str(),
            "point_b2a_4",
            "the removed closing endpoint keeps its consumed positional index"
        );
    }

    #[test]
    fn quad_preserves_control_and_endpoint() {
        let mut pen = ShiftPen::new(GlyphId::new(0x2a));
        pen.move_to(10.0, 20.0);
        pen.quad_to(50.0, 90.0, 100.0, 20.0);

        let contours = pen.contours();
        let points = contours[0].points();
        assert_eq!(
            point_types(&contours[0]),
            vec![PointType::OnCurve, PointType::OffCurve, PointType::QCurve]
        );
        assert_eq!((points[1].x(), points[1].y()), (50.0, 90.0));
        assert_eq!((points[2].x(), points[2].y()), (100.0, 20.0));
    }

    #[test]
    fn close_drops_duplicate_start_point_from_closing_curve() {
        let mut pen = ShiftPen::new(GlyphId::new(0x2a));
        pen.move_to(0.0, 0.0);
        pen.line_to(100.0, 0.0);
        pen.quad_to(100.0, 100.0, 0.0, 0.0);
        pen.close();

        let contours = pen.contours();
        let contour = &contours[0];
        assert!(contour.is_closed());
        assert_eq!(
            point_types(contour),
            vec![PointType::QCurve, PointType::OnCurve, PointType::OffCurve],
            "closing qcurve endpoint should move to the wrapped start point"
        );
    }

    #[test]
    fn close_keeps_distinct_last_point() {
        let mut pen = ShiftPen::new(GlyphId::new(0x2a));
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
        let mut pen = ShiftPen::new(GlyphId::new(0x2a));
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
                PointType::QCurve,
                PointType::OnCurve
            ]
        );
    }

    #[test]
    fn imported_quadratics_match_source_segments() {
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

        let font = read_font_file(path.to_str().unwrap()).unwrap();
        let glyph = font
            .glyphs_by_unicode('O' as u32)
            .next()
            .expect("imported font should contain 'O'");
        let layer = glyph
            .layers()
            .values()
            .next()
            .expect("glyph should have a layer");

        let quadratics = layer
            .contours_iter()
            .flat_map(|contour| contour.segments())
            .filter_map(|segment| match segment {
                CurveSegment::Quad(start, control, end) => Some([
                    (start.x(), start.y()),
                    (control.x(), control.y()),
                    (end.x(), end.y()),
                ]),
                CurveSegment::Line(..) | CurveSegment::Cubic(..) => None,
            })
            .collect::<Vec<_>>();

        let mut current = (0.0, 0.0);
        let mut quads_checked = 0;
        for element in elements {
            match element {
                PathElement::MoveTo { x, y } | PathElement::LineTo { x, y } => {
                    current = (x as f64, y as f64);
                }
                PathElement::QuadTo { cx0, cy0, x, y } => {
                    let expected = [current, (cx0 as f64, cy0 as f64), (x as f64, y as f64)];
                    assert!(
                        quadratics.contains(&expected),
                        "missing imported quadratic {expected:?}"
                    );
                    quads_checked += 1;
                    current = expected[2];
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
