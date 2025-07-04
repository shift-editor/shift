use std::{
  collections::HashMap,
  path::{Path, PathBuf},
  time::Instant,
};

use crate::{
  contour::Contour,
  font::{Font, FontMetadata, Metrics},
  font_loader::FontAdaptor,
  glyph::Glyph,
  point::PointType,
};
use fontc::JobTimer;
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
    self
      .contours
      .last_mut()
      .unwrap()
      .add_point(x as f64, y as f64, PointType::OFF_CURVE, false);
  }

  fn line_to(&mut self, x: f32, y: f32) {
    self
      .contours
      .last_mut()
      .unwrap()
      .add_point(x as f64, y as f64, PointType::ON_CURVE, false);
  }

  fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
    self.contours.last_mut().unwrap().add_point(
      cx0 as f64,
      cy0 as f64,
      PointType::OFF_CURVE,
      false,
    );

    self
      .contours
      .last_mut()
      .unwrap()
      .add_point(x as f64, y as f64, PointType::ON_CURVE, false);
  }

  fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
    self.contours.last_mut().unwrap().add_point(
      cx0 as f64,
      cy0 as f64,
      PointType::OFF_CURVE,
      false,
    );

    self.contours.last_mut().unwrap().add_point(
      cx1 as f64,
      cy1 as f64,
      PointType::OFF_CURVE,
      false,
    );

    self
      .contours
      .last_mut()
      .unwrap()
      .add_point(x as f64, y as f64, PointType::ON_CURVE, false);
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
mod tests {
  use super::*;
}
