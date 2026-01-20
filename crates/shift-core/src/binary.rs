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
    let font = FontRef::new(font_bytes).expect("Failed to load font");
    Ok(font)
}

#[derive(Default)]
struct ShiftPen {
    contours: Vec<Contour>,
}

impl OutlinePen for ShiftPen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.contours.push(Contour::new());
        self.contours
            .last_mut()
            .unwrap()
            .add_point(x as f64, y as f64, PointType::OnCurve, false);
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.contours
            .last_mut()
            .unwrap()
            .add_point(x as f64, y as f64, PointType::OnCurve, false);
    }

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.contours.last_mut().unwrap().add_point(
            cx0 as f64,
            cy0 as f64,
            PointType::OffCurve,
            false,
        );

        self.contours
            .last_mut()
            .unwrap()
            .add_point(x as f64, y as f64, PointType::OnCurve, false);
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.contours.last_mut().unwrap().add_point(
            cx0 as f64,
            cy0 as f64,
            PointType::OffCurve,
            false,
        );

        self.contours.last_mut().unwrap().add_point(
            cx1 as f64,
            cy1 as f64,
            PointType::OffCurve,
            false,
        );

        self.contours
            .last_mut()
            .unwrap()
            .add_point(x as f64, y as f64, PointType::OnCurve, false);
    }

    fn close(&mut self) {
        if let Some(contour) = self.contours.last_mut() {
            contour.close();
        }
    }
}

impl ShiftPen {
    pub fn contours(self) -> Vec<Contour> {
        self.contours
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
        for contour in pen.contours() {
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
        let bytes = std::fs::read(path).unwrap();
        let font = FontRef::new(&bytes).unwrap();
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
    let exec_result = fontc::run(args, timer);
    if exec_result.is_err() {
        return Err(format!(
            "Failed to compile font: {}",
            exec_result.err().unwrap()
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {}
