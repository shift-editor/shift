use std::path::{Path, PathBuf};
use std::time::Instant;

use crate::font_loader::FontAdaptor;
use crate::{Contour, Font, GlyphLayer, PointType};
use fontc::JobTimer;
use shift_ir::Glyph;
use skrifa::{
    outline::{DrawSettings, OutlinePen},
    prelude::{LocationRef, Size},
    raw::TableProvider,
    FontRef, MetadataProvider,
};

pub fn load_font(font_bytes: &[u8]) -> Result<FontRef, String> {
    FontRef::new(font_bytes).map_err(|e| format!("Failed to load font: {e}"))
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

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.current_contour()
            .add_point(cx0 as f64, cy0 as f64, PointType::OffCurve, false);
        self.current_contour()
            .add_point(x as f64, y as f64, PointType::OnCurve, false);
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.current_contour()
            .add_point(cx0 as f64, cy0 as f64, PointType::OffCurve, false);
        self.current_contour()
            .add_point(cx1 as f64, cy1 as f64, PointType::OffCurve, false);
        self.current_contour()
            .add_point(x as f64, y as f64, PointType::OnCurve, false);
    }

    fn close(&mut self) {
        if let Some(contour) = self.contours.last_mut() {
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

fn font_from_skrifa(font: &FontRef) -> Font {
    let outlines = font.outline_glyphs();
    let char_map = font.charmap();

    let metrics = font.metrics(Size::unscaled(), LocationRef::default());
    let mut ir_font = Font::new();
    let default_layer_id = ir_font.default_layer_id();

    ir_font.metrics_mut().units_per_em = metrics.units_per_em as f64;
    ir_font.metrics_mut().ascender = metrics.ascent as f64;
    ir_font.metrics_mut().descender = metrics.descent as f64;
    ir_font.metrics_mut().cap_height = Some(metrics.cap_height.unwrap_or(0.0) as f64);
    ir_font.metrics_mut().x_height = Some(metrics.x_height.unwrap_or(0.0) as f64);

    for (unicode, glyph_id) in char_map.mappings() {
        let outline = outlines.get(glyph_id).unwrap();
        let settings = DrawSettings::unhinted(Size::unscaled(), LocationRef::default());
        let mut pen = ShiftPen::default();
        outline.draw(settings, &mut pen).unwrap();

        let hmtx = font.hmtx().unwrap();
        let advance_width = hmtx.advance(glyph_id).unwrap();

        let glyph_name = char::from_u32(unicode)
            .map(|c| c.to_string())
            .unwrap_or_else(|| format!("uni{unicode:04X}"));

        let mut glyph = Glyph::with_unicode(glyph_name, unicode);
        let mut layer = GlyphLayer::with_width(advance_width as f64);
        let mut contours = pen.contours();
        detect_smooth_points(&mut contours);
        for contour in contours {
            layer.add_contour(contour);
        }
        glyph.set_layer(default_layer_id, layer);
        ir_font.insert_glyph(glyph);
    }

    ir_font
}

pub struct BytesFontAdaptor;
impl FontAdaptor for BytesFontAdaptor {
    fn read_font(&self, path: &str) -> Result<Font, String> {
        let bytes =
            std::fs::read(path).map_err(|e| format!("Failed to read font file '{path}': {e}"))?;
        let font = FontRef::new(&bytes)
            .map_err(|e| format!("Failed to parse font data from '{path}': {e}"))?;
        Ok(font_from_skrifa(&font))
    }

    fn write_font(&self, _font: &Font, _path: &str) -> Result<(), String> {
        Ok(())
    }
}

pub fn compile_font(path: &str, build_dir: &Path, output_name: &str) -> Result<(), String> {
    let mut args = fontc::Args::new(build_dir, PathBuf::from(path));

    args.output_file = Some(PathBuf::from(output_name));
    let timer = JobTimer::new(Instant::now());
    fontc::run(args, timer).map_err(|e| format!("Failed to compile font: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
