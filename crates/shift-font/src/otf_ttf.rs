use std::collections::HashMap;

use crate::{
    contour::{Contour, ContourPoint, PointType},
    font::{Font, FontMetadata, Metrics},
    font_service::FontAdaptor,
    glyph::Glyph,
};
use skrifa::{
    FontRef, MetadataProvider,
    outline::{DrawSettings, OutlinePen},
    prelude::{LocationRef, Size},
    raw::TableProvider,
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
            .add_point(ContourPoint::new(
                x as f64,
                y as f64,
                PointType::OnCurve,
                false,
            ));
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.contours
            .last_mut()
            .unwrap()
            .add_point(ContourPoint::new(
                x as f64,
                y as f64,
                PointType::OnCurve,
                false,
            ));
    }

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.contours
            .last_mut()
            .unwrap()
            .add_point(ContourPoint::new(
                cx0 as f64,
                cy0 as f64,
                PointType::OffCurve,
                false,
            ));

        self.contours
            .last_mut()
            .unwrap()
            .add_point(ContourPoint::new(
                x as f64,
                y as f64,
                PointType::OnCurve,
                false,
            ));
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.contours
            .last_mut()
            .unwrap()
            .add_point(ContourPoint::new(
                cx0 as f64,
                cy0 as f64,
                PointType::OffCurve,
                false,
            ));

        self.contours
            .last_mut()
            .unwrap()
            .add_point(ContourPoint::new(
                cx1 as f64,
                cy1 as f64,
                PointType::OffCurve,
                false,
            ));

        self.contours
            .last_mut()
            .unwrap()
            .add_point(ContourPoint::new(
                x as f64,
                y as f64,
                PointType::OnCurve,
                false,
            ));
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

impl<'a> From<FontRef<'a>> for Font {
    fn from(font: FontRef) -> Self {
        let outlines = font.outline_glyphs();
        let char_map = font.charmap();

        let metrics = font.metrics(Size::unscaled(), LocationRef::default());
        let mut glyphs = HashMap::new();

        for (unicode, glyph_id) in char_map.mappings() {
            let outline = outlines.get(glyph_id).unwrap();
            let settings = DrawSettings::unhinted(Size::unscaled(), LocationRef::default());
            let mut pen = ShiftPen::default();
            outline.draw(settings, &mut pen).unwrap();

            let hmtx = font.hmtx().unwrap();
            let advance_width = hmtx.advance(glyph_id).unwrap();

            let glyph = Glyph::new(String::new(), unicode, pen.contours(), advance_width.into());
            glyphs.insert(unicode, glyph);
        }

        Font {
            metadata: FontMetadata {
                family: String::new(),
                style_name: String::new(),
                version: 1,
            },
            metrics: Metrics {
                units_per_em: metrics.units_per_em as f64,
                ascender: metrics.ascent as f64,
                descender: metrics.descent as f64,
                cap_height: metrics.cap_height.unwrap_or(0.0) as f64,
                x_height: metrics.x_height.unwrap_or(0.0) as f64,
            },
            glyphs,
        }
    }
}

pub struct BytesFontAdaptor;
impl FontAdaptor for BytesFontAdaptor {
    fn read_font(&self, path: &str) -> Result<Font, String> {
        let bytes = std::fs::read(path).unwrap();
        let font = FontRef::new(&bytes).unwrap();
        Ok(font.into())
    }

    fn write_font(&self, font: &Font, path: &str) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn can_load_font_from_file() {
        let font_bytes = std::fs::read("./src/fonts/Liverpool.ttf").unwrap();
        let font = FontRef::new(&font_bytes).unwrap();
        let glyphs = font.outline_glyphs();
    }
}
